#!/usr/bin/env node
/**
 * READ-ONLY probe for the Calendly booked-meeting check.
 *
 * Replicates exactly what sequencer/src/lib/calendly-booking-check.ts does
 * (minus the Redis cache) so the query can be exercised against a real
 * tenant + email without deploying.
 *
 * Usage (from sequencer/):
 *   node scripts/test-calendly-booked-check.mjs --tenant <uuid> --email <addr> [--since <ISO date>]
 *
 * Expected:
 *   - email that booked on the tenant's Calendly   → BOOKED (lists events)
 *   - email with no booking                        → NOT BOOKED
 *   - tenant without an active Calendly connection → UNAVAILABLE
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const tenantId = opt('tenant', null);
const email = (opt('email', '') || '').trim().toLowerCase();
const since = opt('since', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

if (!tenantId || !email) {
    console.error('Usage: node scripts/test-calendly-booked-check.mjs --tenant <uuid> --email <addr> [--since <ISO>]');
    process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

function decrypt(enc) {
    const SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
    if (!SHAPE.test(enc)) return enc; // legacy plaintext passthrough (mirrors encryption.ts)
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const [iv, tag, ct] = enc.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return d.update(ct, 'base64', 'utf8') + d.final('utf8');
}

const { data: conn, error } = await sb
    .from('tenant_calendly')
    .select('calendly_pat_encrypted, calendly_user_uri, calendly_user_email')
    .eq('client_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();

if (error) { console.error('DB error:', error.message); process.exit(1); }
if (!conn?.calendly_pat_encrypted || !conn.calendly_user_uri) {
    console.log('RESULT: UNAVAILABLE (no active Calendly connection for this tenant)');
    process.exit(0);
}

const pat = decrypt(conn.calendly_pat_encrypted);
console.log(`Calendly account: ${conn.calendly_user_email}  (user ${conn.calendly_user_uri})`);
console.log(`Checking invitee_email=${email} min_start_time=${since}\n`);

const params = new URLSearchParams({
    user: conn.calendly_user_uri,
    invitee_email: email,
    status: 'active',
    min_start_time: new Date(since).toISOString(),
    count: '5',
});
const res = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${pat}` },
});
if (!res.ok) {
    console.error(`Calendly API ${res.status}:`, (await res.text()).slice(0, 300));
    console.log('RESULT: UNAVAILABLE (sequencer would fail open — send proceeds)');
    process.exit(0);
}
const body = await res.json();
const events = body.collection || [];
if (events.length === 0) {
    console.log('RESULT: NOT BOOKED (follow-ups would proceed)');
} else {
    console.log(`RESULT: BOOKED — ${events.length} event(s); enrollment would stop:`);
    for (const ev of events) {
        console.log(`  - ${ev.name || '(unnamed)'} @ ${ev.start_time} [${ev.status}]`);
    }
}
