#!/usr/bin/env node
/**
 * Re-sync the umbrella-registered VAPI calendar tools to the canonical parameter
 * schemas in src/lib/verticals/real-estate-investor/tools.ts.
 *
 * Why a one-off script: for UMBRELLA tenants the 5 calendar tools are registered
 * ONCE per umbrella via VAPI's /tool API (src/app/actions/umbrella-tools-actions.ts)
 * and every assistant just references them by `model.toolIds`. `ensureUmbrellaCalendarTools`
 * only CREATES missing tools — it never updates one that already exists. So any
 * change to a tool's parameter schema (e.g. `book_appointment.customer_email`, which
 * the booking flow now needs in order to add the lead as a calendar attendee and
 * actually email them the invite) is invisible to already-registered umbrellas
 * until someone PATCHes them live. That's what this does.
 *
 * Only the `function` block (name / description / parameters) is PATCHed. The
 * tool's `server` URL and `messages` are left exactly as registered.
 *
 * Idempotent: any tool whose `function` block already deep-equals the canonical
 * one is skipped. DRY RUN by default; pass --apply to write to VAPI.
 * Reads secrets from sequencer/.env.production and NEVER prints them.
 *
 * USAGE (from sequencer/):
 *   node scripts/patch-calendar-tools.mjs                      # dry-run: every active umbrella
 *   node scripts/patch-calendar-tools.mjs --apply              # apply to every active umbrella
 *   node scripts/patch-calendar-tools.mjs --umbrella <uuid>    # one umbrella
 *   node scripts/patch-calendar-tools.mjs --tenant <uuid>      # the umbrella serving this client
 *
 * FLAGS:
 *   --umbrella <uuid>  target one vapi_umbrellas row
 *   --tenant <uuid>    target the umbrella assigned to this client
 *   --apply            actually PATCH VAPI (omit = dry run, GET + diff only)
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const CFG = {
    umbrellaId: opt('umbrella', null),
    tenantId: opt('tenant', null),
    apply: flag('apply'),
};

// ── canonical `function` blocks — kept identical to
//    buildCalendarToolDefinitions() in
//    src/lib/verticals/real-estate-investor/tools.ts ────────────────────────
const CANONICAL_FUNCTIONS = {
    check_availability: {
        name: 'check_availability',
        description:
            'Check available appointment slots, optionally filtered by day-part or time range. Call this when the customer wants to book or asks about availability.',
        parameters: {
            type: 'object',
            properties: {
                preferred_date: {
                    type: 'string',
                    description: 'Preferred date in YYYY-MM-DD format. Omit to check the next few business days.',
                },
                days_ahead: {
                    type: 'integer',
                    description: "How many days forward to scan. Use 7 for 'next week', 3 for 'next few days'.",
                },
                duration_minutes: {
                    type: 'integer',
                    description: 'Appointment length in minutes. Omit to use tenant default.',
                },
                time_of_day_preference: {
                    type: 'string',
                    enum: ['morning', 'afternoon', 'evening', 'any'],
                    description: 'Customer-stated day-part preference.',
                },
                earliest_time: {
                    type: 'string',
                    description: 'Earliest acceptable time in HH:MM (24h), tenant timezone.',
                },
                latest_time: {
                    type: 'string',
                    description: 'Latest acceptable time in HH:MM (24h), tenant timezone.',
                },
                service_type: { type: 'string', description: 'The type of service or appointment.' },
                address: { type: 'string', description: 'Full property address' },
                zip_code: { type: 'string', description: 'Property zip code' },
            },
        },
    },
    book_appointment: {
        name: 'book_appointment',
        description:
            'Book a confirmed appointment. Only call after the customer has picked a specific date and time.',
        parameters: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                time: { type: 'string', description: 'HH:MM 24-hour' },
                customer_name: { type: 'string', description: 'Full name' },
                customer_phone: { type: 'string', description: 'Phone; any format, will be normalized' },
                customer_email: { type: 'string', description: 'Email for calendar invite (optional)' },
                timezone: {
                    type: 'string',
                    description:
                        'IANA timezone if caller volunteered it (e.g. America/Chicago). Omit to use tenant default.',
                },
                service_type: { type: 'string' },
                notes: { type: 'string' },
            },
            required: ['date', 'time', 'customer_name', 'customer_phone'],
        },
    },
    lookup_appointment: {
        name: 'lookup_appointment',
        description:
            'Find existing appointments for a caller by phone number. Call when a returning caller asks about their booking.',
        parameters: {
            type: 'object',
            properties: { customer_phone: { type: 'string', description: 'Phone in any format' } },
            required: ['customer_phone'],
        },
    },
    reschedule_appointment: {
        name: 'reschedule_appointment',
        description:
            "Move a caller's existing appointment to a new date and time. Only call after the caller has agreed to a specific new slot.",
        parameters: {
            type: 'object',
            properties: {
                customer_phone: { type: 'string' },
                new_date: { type: 'string', description: 'YYYY-MM-DD' },
                new_time: { type: 'string', description: 'HH:MM 24-hour' },
                timezone: { type: 'string' },
            },
            required: ['customer_phone', 'new_date', 'new_time'],
        },
    },
    cancel_appointment: {
        name: 'cancel_appointment',
        description:
            "Cancel a caller's existing appointment. Only call after the caller has explicitly confirmed they want to cancel.",
        parameters: {
            type: 'object',
            properties: { customer_phone: { type: 'string' } },
            required: ['customer_phone'],
        },
    },
};

const CALENDAR_TOOL_NAMES = Object.keys(CANONICAL_FUNCTIONS);

// ── crypto (mirrors sequencer/src/lib/encryption.ts) ────────────────────────
function decrypt(enc) {
    const SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
    if (!SHAPE.test(enc)) return enc; // legacy plaintext passthrough
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const [iv, tag, ct] = enc.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return d.update(ct, 'base64', 'utf8') + d.final('utf8');
}

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// ── helpers ─────────────────────────────────────────────────────────────────
/** Order-insensitive structural comparison, so key ordering isn't a false diff. */
function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
        return Object.keys(v)
            .sort()
            .reduce((acc, k) => {
                if (v[k] !== undefined) acc[k] = stable(v[k]);
                return acc;
            }, {});
    }
    return v;
}

const sameFunction = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** Property names present in canonical but missing on VAPI — the human-readable diff. */
function missingProps(canonical, live) {
    const want = Object.keys(canonical?.parameters?.properties || {});
    const have = Object.keys(live?.parameters?.properties || {});
    return want.filter((p) => !have.includes(p));
}

async function vapiGetTool(id, key) {
    const r = await fetch(`https://api.vapi.ai/tool/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`VAPI GET tool ${id} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
}

async function vapiPatchTool(id, key, fn) {
    const r = await fetch(`https://api.vapi.ai/tool/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ function: fn }),
    });
    if (!r.ok) throw new Error(`VAPI PATCH tool ${id} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
}

async function resolveUmbrellas() {
    if (CFG.umbrellaId) {
        const { data, error } = await sb
            .from('vapi_umbrellas')
            .select('id, name, vapi_api_key_encrypted, calendar_tool_ids')
            .eq('id', CFG.umbrellaId)
            .single();
        if (error || !data) throw new Error(`Umbrella ${CFG.umbrellaId} not found: ${error?.message || 'no row'}`);
        return [data];
    }

    if (CFG.tenantId) {
        const { data, error } = await sb
            .from('tenant_vapi_assignments')
            .select('umbrella_id')
            .eq('client_id', CFG.tenantId)
            .eq('is_active', true)
            .single();
        if (error || !data?.umbrella_id) {
            throw new Error(`No active VAPI umbrella for tenant ${CFG.tenantId}: ${error?.message || 'not found'}`);
        }
        const { data: u, error: uErr } = await sb
            .from('vapi_umbrellas')
            .select('id, name, vapi_api_key_encrypted, calendar_tool_ids')
            .eq('id', data.umbrella_id)
            .single();
        if (uErr || !u) throw new Error(`Umbrella ${data.umbrella_id} not found: ${uErr?.message || 'no row'}`);
        return [u];
    }

    const { data, error } = await sb
        .from('vapi_umbrellas')
        .select('id, name, vapi_api_key_encrypted, calendar_tool_ids')
        .eq('is_active', true);
    if (error) throw new Error(`umbrellas query: ${error.message}`);
    return data || [];
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\nPatch umbrella calendar tools — ${CFG.apply ? 'APPLY (writes to VAPI)' : 'DRY RUN (no writes)'}\n`);

    const umbrellas = await resolveUmbrellas();
    if (!umbrellas.length) {
        console.log('No umbrellas found.');
        process.exit(0);
    }

    let patched = 0, skipped = 0, failed = 0;

    for (const u of umbrellas) {
        const label = `${u.name || '(unnamed)'} [${u.id}]`;
        const toolIds = u.calendar_tool_ids || {};
        const registered = CALENDAR_TOOL_NAMES.filter((n) => toolIds[n]);

        if (!registered.length) {
            console.log(`  – ${label}: no registered calendar tools (nothing to patch)`);
            continue;
        }
        if (!u.vapi_api_key_encrypted) {
            console.log(`  ✗ ${label}: no VAPI API key on the umbrella`);
            failed++;
            continue;
        }

        console.log(`  ${label} — ${registered.length}/${CALENDAR_TOOL_NAMES.length} tools registered`);

        let key;
        try {
            key = decrypt(u.vapi_api_key_encrypted);
        } catch (err) {
            console.log(`  ✗ ${label}: failed to decrypt VAPI key (${err.message})`);
            failed++;
            continue;
        }

        for (const name of registered) {
            const id = toolIds[name];
            const canonical = CANONICAL_FUNCTIONS[name];
            try {
                const live = await vapiGetTool(id, key);
                const liveFn = live.function || {};

                if (sameFunction(liveFn, canonical)) {
                    console.log(`      ✓ ${name} [${id}]: already current — skipped`);
                    skipped++;
                    continue;
                }

                const added = missingProps(canonical, liveFn);
                console.log(
                    `      • ${name} [${id}]: schema differs${added.length ? ` — adds param(s): ${added.join(', ')}` : ''}`
                );

                if (!CFG.apply) {
                    patched++; // would-patch
                    continue;
                }

                await vapiPatchTool(id, key, canonical);
                console.log(`          ✓ PATCHed on VAPI`);
                patched++;
            } catch (err) {
                console.log(`      ✗ ${name} [${id}]: ${err.message}`);
                failed++;
            }
        }
    }

    console.log(`\n${CFG.apply ? 'Applied' : 'Would patch'}: ${patched} | skipped: ${skipped} | failed: ${failed}`);
    if (!CFG.apply && patched > 0) console.log('Re-run with --apply to write these to VAPI.');
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
