#!/usr/bin/env node
/**
 * Backfill: re-classify stored call dispositions that were recorded as
 * "answered" when the transcript shows a voicemail box or an empty line.
 *
 * The webhook fix (fix(sequencer): stop recording voicemail pickups as
 * answered calls) only corrects calls from here on. Rows already written keep
 * telling conversation memory the lead answered, and — because steps can be
 * configured `skip_if: contact_answered_call` — keep those leads out of the
 * follow-ups they should be getting.
 *
 * Columns corrected (all derived from the same disposition):
 *   contact_interactions.call_disposition
 *   contact_interactions.outcome
 *   sequence_execution_log.call_status
 *   sequence_enrollments.contact_answered_call   (only true -> false)
 *
 * Deliberately NOT touched: contacts.pipeline_stage_id. Phantom answers
 * auto-advanced some contacts to "Engaged", but stages also move by hand and
 * by later real events; rolling them back could destroy the user's own work.
 *
 * Usage:
 *   node scripts/backfill-call-dispositions.mjs            # dry run
 *   node scripts/backfill-call-dispositions.mjs --apply
 *   node scripts/backfill-call-dispositions.mjs --apply --client <uuid>
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { refineDisposition } from '../dist/lib/call-classification.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const clientArg = process.argv.indexOf('--client');
const ONLY_CLIENT = clientArg > -1 ? process.argv[clientArg + 1] : null;

function loadEnv() {
    for (const p of [path.join(__dirname, '../.env'), path.join(__dirname, '../../.env.local')]) {
        if (!fs.existsSync(p)) continue;
        const env = {};
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            if (!line.includes('=') || line.trim().startsWith('#')) continue;
            const i = line.indexOf('=');
            env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
        const url = env.SUPABASE_URL;
        const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
        if (url && key) return { url, key, from: p };
    }
    throw new Error('No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY found in sequencer/.env or .env.local');
}

const { url, key, from } = loadEnv();
const sb = createClient(url, key);

/** PostgREST caps responses at 1000 rows; page until short. */
async function pageAll(build) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await build().range(offset, offset + 999);
        if (error) throw new Error(error.message);
        out.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) return out;
    }
}

const ANSWERED = new Set(['answered', 'completed', 'transferred']);

async function main() {
    console.log(`[BACKFILL] ${APPLY ? 'APPLY' : 'DRY RUN'} — credentials from ${from}\n`);

    let clients;
    if (ONLY_CLIENT) {
        clients = [{ id: ONLY_CLIENT, name: ONLY_CLIENT }];
    } else {
        const { data, error } = await sb.from('clients').select('id, name');
        if (error) throw new Error(error.message);
        clients = data ?? [];
    }

    const totals = { interactions: 0, logs: 0, enrollments: 0, activeResumed: 0 };

    for (const client of clients) {
        const voice = await pageAll(() =>
            sb
                .from('contact_interactions')
                .select('id, contact_id, provider_id, call_disposition, outcome, content_body, call_duration_seconds')
                .eq('client_id', client.id)
                .eq('channel', 'voice')
                .order('created_at', { ascending: false })
        );
        if (voice.length === 0) continue;

        // Richer transcripts live on `calls`; fall back to the interaction body.
        const calls = await pageAll(() =>
            sb
                .from('calls')
                .select('vapi_call_id, transcript, duration_seconds')
                .eq('client_id', client.id)
                .order('created_at', { ascending: false })
        );
        const callById = new Map(calls.map((c) => [c.vapi_call_id, c]));

        const changes = [];
        for (const row of voice) {
            const call = row.provider_id ? callById.get(row.provider_id) : null;
            const transcript = call?.transcript || row.content_body;
            const duration = row.call_duration_seconds ?? call?.duration_seconds;
            const before = row.call_disposition;
            if (!before) continue;
            const after = refineDisposition(before, transcript, duration);
            if (after !== before) changes.push({ row, before, after });
        }

        // Which contacts still have a genuinely answered call after correction?
        const finalByContact = new Map();
        const changedIds = new Map(changes.map((c) => [c.row.id, c.after]));
        for (const row of voice) {
            const final = changedIds.get(row.id) ?? row.call_disposition;
            if (!row.contact_id) continue;
            if (ANSWERED.has(final)) finalByContact.set(row.contact_id, true);
            else if (!finalByContact.has(row.contact_id)) finalByContact.set(row.contact_id, false);
        }

        const enrollments = await pageAll(() =>
            sb
                .from('sequence_enrollments')
                .select('id, contact_id, status, contact_answered_call')
                .eq('tenant_id', client.id)
                .eq('contact_answered_call', true)
                .order('enrolled_at', { ascending: false })
        );
        // Only ever clear a flag we can prove wrong; never set one.
        const staleFlags = enrollments.filter(
            (e) => finalByContact.has(e.contact_id) && finalByContact.get(e.contact_id) === false
        );
        const activeStale = staleFlags.filter((e) => ['active', 'awaiting_outcome', 'generating_next_step'].includes(e.status));

        if (changes.length === 0 && staleFlags.length === 0) continue;

        const breakdown = {};
        for (const c of changes) breakdown[`${c.before} → ${c.after}`] = (breakdown[`${c.before} → ${c.after}`] ?? 0) + 1;
        console.log(`${client.name ?? client.id}`);
        console.log(`  voice interactions: ${voice.length}, corrections: ${changes.length}`);
        for (const [k, v] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(4)}  ${k}`);
        console.log(`  enrollments wrongly flagged contact_answered_call: ${staleFlags.length} (${activeStale.length} still active — these resume skipped steps)`);

        totals.interactions += changes.length;
        totals.enrollments += staleFlags.length;
        totals.activeResumed += activeStale.length;

        if (!APPLY) {
            const providerIds = changes.map((c) => c.row.provider_id).filter(Boolean);
            totals.logs += providerIds.length;
            continue;
        }

        for (const { row, after } of changes) {
            const { error } = await sb
                .from('contact_interactions')
                .update({ call_disposition: after, outcome: after })
                .eq('id', row.id);
            if (error) console.error(`  !! interaction ${row.id}: ${error.message}`);

            if (row.provider_id) {
                const { error: logErr, count } = await sb
                    .from('sequence_execution_log')
                    .update({ call_status: after }, { count: 'exact' })
                    .eq('provider_id', row.provider_id);
                if (logErr) console.error(`  !! execution log ${row.provider_id}: ${logErr.message}`);
                else totals.logs += count ?? 0;
            }
        }

        for (const e of staleFlags) {
            const { error } = await sb
                .from('sequence_enrollments')
                .update({ contact_answered_call: false })
                .eq('id', e.id);
            if (error) console.error(`  !! enrollment ${e.id}: ${error.message}`);
        }
        console.log('  applied.');
    }

    console.log(
        `\n[BACKFILL] ${APPLY ? 'applied' : 'would change'}: ` +
            `${totals.interactions} interactions, ${totals.logs} execution-log rows, ` +
            `${totals.enrollments} enrollment flags (${totals.activeResumed} on active enrollments).`
    );
    if (!APPLY) console.log('[BACKFILL] Dry run only. Re-run with --apply to write.');
}

main().catch((err) => {
    console.error('[BACKFILL] failed:', err);
    process.exit(1);
});
