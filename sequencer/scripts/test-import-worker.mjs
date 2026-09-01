#!/usr/bin/env node
/**
 * Live E2E test for the import-worker (import_jobs pipeline) against the
 * E2E test tenant. ZERO outreach risk: the enrollment tests use a sequence
 * created with is_active=false (the scheduler never dispatches inactive
 * sequences) and everything is deleted at the end.
 *
 * What it proves, in order:
 *   1. contact_import job: CSV in Storage -> contacts + list + members,
 *      invalid rows reported, progress counters written.
 *   2. Re-running the SAME import is idempotent: 0 created, N updated,
 *      member count unchanged (the "re-upload doesn't duplicate" guarantee).
 *   3. list_enroll job: enrolls every member once.
 *   4. Re-running the enroll skips everyone already enrolled.
 *   5. Flipping one enrollment to 'failed' and re-running re-enrolls exactly
 *      that one.
 *   6. SCALE: a 1,200-row import + enroll, which crosses both the 200-id
 *      `.in()` chunk boundary (PostgREST URL limit — 1000 ids was a 400) and
 *      Supabase's silent 1000-row select cap on list members.
 *
 * Spawns `node dist/workers/import-worker.js` as a child for the duration,
 * so the claim/heartbeat/complete protocol is exercised for real.
 *
 * Usage (from sequencer/, AFTER 20260901-import-jobs.sql has been applied):
 *   node scripts/test-import-worker.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TENANT = '36b43327-ea8c-4432-90fc-0ddca6b17498'; // E2E test client
const LIST_NAME = 'E2E Import Worker Test';
const SEQ_NAME = 'E2E Import Worker Seq';
const PHONES = ['+17753805644', '+17753805645']; // E2E harness range
const CSV = [
    'first_name,last_name,email,company,phone,deal_size,property_address',
    'ImportE2E,One,e2e.one@example.com,Acme Roofing,7753805644,12000,"123 Main St, Reno NV"',
    'ImportE2E,Two,e2e.two@example.com,Beta Homes,7753805645,9500,"456 Oak Ave, Sparks NV"',
    'ImportE2E,BadPhone,,,notaphone,1,nowhere',
].join('\n');
const BUCKET = 'contact-imports';
const STORAGE_PATH = `${TENANT}/${Date.now()}-e2e-import-worker.csv`;

// Scale phase: 1,200 fictional-but-format-valid numbers (555-01xx across 12
// area codes). Cleanup is by EXACT phone match on this list, never a prefix,
// so it cannot touch real contacts; the phase aborts if any already exist.
const SCALE_LIST = 'E2E Import Worker Scale';
const SCALE_SEQ = 'E2E Import Worker Scale Seq';
const SCALE_PATH = `${TENANT}/${Date.now()}-e2e-scale.csv`;
const SCALE_ROWS = 1200;
const SCALE_AREA_CODES = ['775', '702', '530', '916', '415', '408', '619', '858', '650', '925', '510', '707'];
const SCALE_PHONES = [];
for (const ac of SCALE_AREA_CODES) {
    for (let i = 0; i < 100; i++) SCALE_PHONES.push(`+1${ac}5550${String(i).padStart(3, '0')}`);
}
const SCALE_CSV = ['first_name,last_name,phone,deal_size']
    .concat(SCALE_PHONES.map((ph, i) => `ScaleE2E,Row${i},${ph.slice(2)},${i * 10}`))
    .join('\n');

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

let failures = 0;
function check(label, ok, detail = '') {
    console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

// Only jobs THIS run enqueued get deleted in cleanup — the tenant is a real
// account and may have genuine job history worth keeping.
const enqueuedJobIds = [];
async function enqueue(kind, payload) {
    const { data, error } = await sb
        .from('import_jobs')
        .insert({ client_id: TENANT, kind, payload })
        .select('id')
        .single();
    if (error) throw new Error(`enqueue failed: ${error.message}`);
    enqueuedJobIds.push(data.id);
    return data.id;
}

async function awaitJob(jobId, timeoutMs = 60_000) {
    const start = Date.now();
    for (;;) {
        const { data } = await sb.from('import_jobs').select('*').eq('id', jobId).single();
        if (data && (data.status === 'completed' || data.status === 'failed')) return data;
        if (Date.now() - start > timeoutMs) throw new Error(`job ${jobId} timed out (status: ${data?.status})`);
        await new Promise((r) => setTimeout(r, 1000));
    }
}

async function cleanup() {
    console.log('\nCleaning up…');
    const { data: seqs } = await sb.from('sequences').select('id').eq('client_id', TENANT).eq('name', SEQ_NAME);
    for (const s of seqs || []) {
        await sb.from('sequence_enrollments').delete().eq('sequence_id', s.id);
        await sb.from('sequences').delete().eq('id', s.id);
    }
    const { data: lists } = await sb.from('contact_lists').select('id').eq('client_id', TENANT).eq('name', LIST_NAME);
    for (const l of lists || []) {
        await sb.from('contact_list_members').delete().eq('list_id', l.id);
        await sb.from('contact_lists').delete().eq('id', l.id);
    }
    const { data: contacts } = await sb.from('contacts').select('id').eq('client_id', TENANT).in('phone', PHONES);
    const ids = (contacts || []).map((c) => c.id);
    if (ids.length) {
        await sb.from('pipeline_contact_history').delete().in(
            'pipeline_contact_id',
            (await sb.from('pipeline_contacts').select('id').in('contact_id', ids)).data?.map((r) => r.id) || ['00000000-0000-0000-0000-000000000000'],
        );
        await sb.from('pipeline_contacts').delete().in('contact_id', ids);
        await sb.from('contacts').delete().in('id', ids);
    }
    // Scale artifacts (exact-phone match, chunked to stay under the URL limit).
    for (const name of [SCALE_SEQ]) {
        const { data: ss } = await sb.from('sequences').select('id').eq('client_id', TENANT).eq('name', name);
        for (const s of ss || []) {
            await sb.from('sequence_enrollments').delete().eq('sequence_id', s.id);
            await sb.from('sequences').delete().eq('id', s.id);
        }
    }
    const { data: slists } = await sb.from('contact_lists').select('id').eq('client_id', TENANT).eq('name', SCALE_LIST);
    for (const l of slists || []) {
        await sb.from('contact_list_members').delete().eq('list_id', l.id);
        await sb.from('contact_lists').delete().eq('id', l.id);
    }
    for (const phones of chunk(SCALE_PHONES, 200)) {
        const { data: cs } = await sb.from('contacts').select('id').eq('client_id', TENANT).in('phone', phones);
        const cids = (cs || []).map((c) => c.id);
        if (!cids.length) continue;
        const { data: pcs } = await sb.from('pipeline_contacts').select('id').in('contact_id', cids);
        const pcIds = (pcs || []).map((r) => r.id);
        if (pcIds.length) await sb.from('pipeline_contact_history').delete().in('pipeline_contact_id', pcIds);
        await sb.from('pipeline_contacts').delete().in('contact_id', cids);
        await sb.from('contacts').delete().in('id', cids);
    }
    if (enqueuedJobIds.length) await sb.from('import_jobs').delete().in('id', enqueuedJobIds);
    await sb.storage.from(BUCKET).remove([STORAGE_PATH, SCALE_PATH]);
    console.log('  cleaned.');
}

async function main() {
    // Preflight: table exists?
    const { error: tableErr } = await sb.from('import_jobs').select('id').limit(1);
    if (tableErr) {
        console.error(`import_jobs table not reachable: ${tableErr.message}`);
        console.error('Run supabase/migrations/20260901-import-jobs.sql first.');
        process.exit(1);
    }

    await cleanup(); // start from a clean slate

    console.log('\nUploading test CSV…');
    const { error: upErr } = await sb.storage.from(BUCKET).upload(STORAGE_PATH, CSV, { contentType: 'text/csv' });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    console.log('Starting import-worker child…');
    const worker = spawn('node', ['dist/workers/import-worker.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', (d) => process.stdout.write(`  [worker] ${d}`));
    worker.stderr.on('data', (d) => process.stdout.write(`  [worker!] ${d}`));

    try {
        const importPayload = {
            storagePath: STORAGE_PATH,
            columnMapping: {
                first_name: 'first_name',
                last_name: 'last_name',
                email: 'email',
                company: 'company',
                phone: 'phone',
                deal_size: 'custom_variable',
                property_address: 'custom_variable',
            },
            customFieldDescriptions: { deal_size: { description: 'Estimated deal value in USD', dirty: true } },
            createList: true,
            listName: LIST_NAME,
            sourceFilename: 'e2e-import-worker.csv',
        };

        console.log('\n— Test 1: contact_import creates contacts + list —');
        let job = await awaitJob(await enqueue('contact_import', importPayload));
        check('job completed', job.status === 'completed', job.error || '');
        check('2 contacts created', job.counts?.contactsCreated === 2, JSON.stringify(job.counts));
        check('bad phone reported', (job.errors || []).some((e) => e.includes('notaphone')), JSON.stringify(job.errors));
        check('total_rows = 3', job.total_rows === 3, String(job.total_rows));
        const listId = job.result?.listId;
        check('listId returned', !!listId);
        const { count: members1 } = await sb.from('contact_list_members').select('*', { count: 'exact', head: true }).eq('list_id', listId);
        check('list has 2 members', members1 === 2, String(members1));
        const { data: listRow } = await sb.from('contact_lists').select('contact_count').eq('id', listId).single();
        check('contact_count = 2', listRow?.contact_count === 2, String(listRow?.contact_count));

        console.log('\n— Test 1b: every mapped field survives the trip —');
        const { data: c1 } = await sb.from('contacts').select('name, email, custom_fields').eq('client_id', TENANT).eq('phone', PHONES[0]).single();
        check('name assembled', c1?.name === 'ImportE2E One', c1?.name);
        check('email stored', c1?.email === 'e2e.one@example.com', c1?.email || 'null');
        check('company -> custom_fields.company', c1?.custom_fields?.company === 'Acme Roofing', JSON.stringify(c1?.custom_fields));
        check('deal_size custom field stored', c1?.custom_fields?.deal_size === '12000', String(c1?.custom_fields?.deal_size));
        check('quoted-comma address intact', c1?.custom_fields?.property_address === '123 Main St, Reno NV', String(c1?.custom_fields?.property_address));
        const { data: fieldDefs } = await sb.from('contact_fields').select('field_key, description').eq('client_id', TENANT).in('field_key', ['deal_size', 'property_address']);
        check('both custom fields registered', (fieldDefs || []).length === 2, JSON.stringify(fieldDefs?.map((f) => f.field_key)));
        check('field description saved', (fieldDefs || []).some((f) => f.field_key === 'deal_size' && f.description === 'Estimated deal value in USD'), JSON.stringify(fieldDefs));
        const { data: mem } = await sb.from('contact_list_members').select('source_row, contacts(phone)').eq('list_id', listId);
        const memOne = (mem || []).find((m) => m.contacts?.phone === PHONES[0]);
        check('verbatim source_row kept on member', memOne?.source_row?.company === 'Acme Roofing' && memOne?.source_row?.deal_size === '12000', JSON.stringify(memOne?.source_row));

        console.log('\n— Test 2: re-running the SAME import duplicates nothing —');
        job = await awaitJob(await enqueue('contact_import', importPayload));
        check('job completed', job.status === 'completed', job.error || '');
        check('0 created / 2 updated', job.counts?.contactsCreated === 0 && job.counts?.contactsUpdated === 2, JSON.stringify(job.counts));
        check('same list reused', job.result?.listId === listId, `${job.result?.listId} vs ${listId}`);
        const { count: members2 } = await sb.from('contact_list_members').select('*', { count: 'exact', head: true }).eq('list_id', listId);
        check('still 2 members', members2 === 2, String(members2));
        const { count: contactCount } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('client_id', TENANT).in('phone', PHONES);
        check('still 2 contact rows', contactCount === 2, String(contactCount));

        console.log('\n— Test 3: list_enroll into an INACTIVE sequence —');
        const { data: seq, error: seqErr } = await sb
            .from('sequences')
            .insert({ client_id: TENANT, name: SEQ_NAME, is_active: false, trigger_type: 'manual' })
            .select('id')
            .single();
        if (seqErr) throw new Error(`sequence insert failed: ${seqErr.message}`);
        const enrollPayload = { listId, sequenceId: seq.id };
        job = await awaitJob(await enqueue('list_enroll', enrollPayload));
        check('job completed', job.status === 'completed', job.error || '');
        check('2 enrolled, 0 skipped', job.counts?.enrolled === 2 && (job.counts?.skipped ?? 0) === 0, JSON.stringify(job.counts));
        const { data: enr1 } = await sb.from('sequence_enrollments').select('id, status, contact_id, custom_variables, source_list_id, contacts(phone)').eq('sequence_id', seq.id);
        check('2 enrollment rows', (enr1 || []).length === 2, String(enr1?.length));
        const enrOne = (enr1 || []).find((e) => e.contacts?.phone === PHONES[0]);
        const vars = enrOne?.custom_variables || {};
        check(
            'enrollment custom_variables replay ALL mapped columns',
            vars.first_name === 'ImportE2E' && vars.company === 'Acme Roofing' && vars.deal_size === '12000' && vars.property_address === '123 Main St, Reno NV' && vars.email === 'e2e.one@example.com',
            JSON.stringify(vars),
        );
        check('source_list_id stamped', enrOne?.source_list_id === listId, String(enrOne?.source_list_id));

        console.log('\n— Test 4: re-enrolling skips everyone —');
        job = await awaitJob(await enqueue('list_enroll', enrollPayload));
        check('job completed', job.status === 'completed', job.error || '');
        check('0 enrolled, 2 skipped', job.counts?.enrolled === 0 && job.counts?.skipped === 2, JSON.stringify(job.counts));
        const { data: enr2 } = await sb.from('sequence_enrollments').select('id').eq('sequence_id', seq.id);
        check('still 2 enrollment rows', (enr2 || []).length === 2, String(enr2?.length));

        console.log("\n— Test 5: 'failed' enrollments are retried, others untouched —");
        // Park enrolled_at in the past so a re-enroll is provable by timestamp:
        // the scheduler can tick and 'complete' the (step-less) enrollment
        // within seconds, so status alone is racy.
        await sb.from('sequence_enrollments').update({ status: 'failed', enrolled_at: '2020-01-01T00:00:00Z' }).eq('id', enr1[0].id);
        job = await awaitJob(await enqueue('list_enroll', enrollPayload));
        check('1 enrolled (the failed one), 1 skipped', job.counts?.enrolled === 1 && job.counts?.skipped === 1, JSON.stringify(job.counts));
        const { data: revived } = await sb.from('sequence_enrollments').select('status, enrolled_at').eq('id', enr1[0].id).single();
        check('failed enrollment re-enrolled (fresh enrolled_at, no longer failed)', revived?.status !== 'failed' && new Date(revived?.enrolled_at).getFullYear() >= 2026, `${revived?.status} @ ${revived?.enrolled_at}`);

        console.log(`\n— Test 6: SCALE — ${SCALE_ROWS}-row import + enroll (chunk + pagination boundaries) —`);
        const allValid = SCALE_PHONES.every((ph) => parsePhoneNumberFromString(ph, 'US')?.isValid());
        check('synthetic phones are format-valid', allValid);
        let preexisting = 0;
        for (const phones of chunk(SCALE_PHONES, 200)) {
            const { count } = await sb.from('contacts').select('*', { count: 'exact', head: true }).eq('client_id', TENANT).in('phone', phones);
            preexisting += count || 0;
        }
        check('no real contacts share the synthetic range', preexisting === 0, String(preexisting));
        if (allValid && preexisting === 0) {
            const { error: sUp } = await sb.storage.from(BUCKET).upload(SCALE_PATH, SCALE_CSV, { contentType: 'text/csv' });
            if (sUp) throw new Error(`scale upload failed: ${sUp.message}`);
            const t0 = Date.now();
            job = await awaitJob(await enqueue('contact_import', {
                storagePath: SCALE_PATH,
                columnMapping: { first_name: 'first_name', last_name: 'last_name', phone: 'phone', deal_size: 'custom_variable' },
                createList: true,
                listName: SCALE_LIST,
                sourceFilename: 'e2e-scale.csv',
            }), 180_000);
            check('scale import completed', job.status === 'completed', job.error || `${Date.now() - t0}ms`);
            check(`${SCALE_ROWS} contacts created`, job.counts?.contactsCreated === SCALE_ROWS, JSON.stringify(job.counts));
            check('no row errors', (job.errors || []).length === 0, JSON.stringify((job.errors || []).slice(0, 3)));
            const scaleListId = job.result?.listId;
            const { count: sMembers } = await sb.from('contact_list_members').select('*', { count: 'exact', head: true }).eq('list_id', scaleListId);
            check(`list has ${SCALE_ROWS} members`, sMembers === SCALE_ROWS, String(sMembers));

            const { data: sseq, error: sseqErr } = await sb.from('sequences').insert({ client_id: TENANT, name: SCALE_SEQ, is_active: false, trigger_type: 'manual' }).select('id').single();
            if (sseqErr) throw new Error(`scale sequence insert failed: ${sseqErr.message}`);
            const t1 = Date.now();
            job = await awaitJob(await enqueue('list_enroll', { listId: scaleListId, sequenceId: sseq.id }), 180_000);
            check('scale enroll completed', job.status === 'completed', job.error || `${Date.now() - t1}ms`);
            check(`total_rows = ${SCALE_ROWS} (pagination past 1000)`, job.total_rows === SCALE_ROWS, String(job.total_rows));
            check(`${SCALE_ROWS} enrolled, 0 skipped`, job.counts?.enrolled === SCALE_ROWS && job.counts?.skipped === 0, JSON.stringify(job.counts));
            const { count: sEnr } = await sb.from('sequence_enrollments').select('*', { count: 'exact', head: true }).eq('sequence_id', sseq.id);
            check(`${SCALE_ROWS} enrollment rows`, sEnr === SCALE_ROWS, String(sEnr));
            job = await awaitJob(await enqueue('list_enroll', { listId: scaleListId, sequenceId: sseq.id }), 180_000);
            check(`re-enroll skips all ${SCALE_ROWS}`, job.counts?.enrolled === 0 && job.counts?.skipped === SCALE_ROWS, JSON.stringify(job.counts));
        }
    } finally {
        worker.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 1500));
        await cleanup();
    }

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
    console.error('\nFATAL:', e.message);
    try { await cleanup(); } catch {}
    process.exit(1);
});
