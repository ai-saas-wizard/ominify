/**
 * Import Worker
 *
 * Claims and executes `import_jobs` rows enqueued by the Next.js app:
 * CSV contact imports (contacts + optional list/tags/enrollment) and
 * saved-list -> sequence enrollments.
 *
 * Why this exists: these used to run inside browser-tied Vercel server
 * actions, so closing the tab (or the 60s function timeout) killed an
 * import halfway. Here the work is durable — the browser only enqueues.
 *
 * Protocol:
 *   - Poll every 3s for the oldest 'pending' job; claim it with an
 *     optimistic UPDATE ... WHERE status='pending'.
 *   - Heartbeat via every progress write; jobs stuck in 'processing' with a
 *     heartbeat older than 3 min are reclaimed (crash recovery) until
 *     MAX_ATTEMPTS, then failed. Processing is idempotent, so a retry can
 *     never duplicate contacts or re-enroll leads.
 */

import 'dotenv/config';
import { supabase } from '../lib/db.js';
import {
    processContactImport,
    processListEnroll,
    capErrors,
    type ContactImportPayload,
    type ListEnrollPayload,
    type JobCounts,
    type ProgressFn,
} from '../lib/import-processor.js';

const POLL_INTERVAL_MS = 3000;
const STALE_PROCESSING_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 3;

interface ImportJobRow {
    id: string;
    client_id: string;
    kind: 'contact_import' | 'list_enroll';
    payload: Record<string, unknown>;
    attempts: number;
}

/** Reset crashed jobs (stale heartbeat) back to pending, or fail them out. */
async function reclaimStaleJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    const { data: stale } = await supabase
        .from('import_jobs')
        .select('id, attempts')
        .eq('status', 'processing')
        .lt('heartbeat_at', staleBefore);
    if (!stale || stale.length === 0) return;

    for (const job of stale) {
        if ((job.attempts as number) >= MAX_ATTEMPTS) {
            await supabase
                .from('import_jobs')
                .update({
                    status: 'failed',
                    error: 'Worker died repeatedly while processing this job.',
                    finished_at: new Date().toISOString(),
                })
                .eq('id', job.id)
                .eq('status', 'processing');
            console.warn(`[IMPORT] Job ${job.id} failed after ${job.attempts} attempts`);
        } else {
            await supabase
                .from('import_jobs')
                .update({ status: 'pending' })
                .eq('id', job.id)
                .eq('status', 'processing');
            console.warn(`[IMPORT] Reclaimed stale job ${job.id} (attempt ${job.attempts})`);
        }
    }
}

/** Claim the oldest pending job. Optimistic — returns null if raced/none. */
async function claimNextJob(): Promise<ImportJobRow | null> {
    const { data: candidates } = await supabase
        .from('import_jobs')
        .select('id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);
    if (!candidates || candidates.length === 0) return null;

    const now = new Date().toISOString();
    const { data: claimed, error } = await supabase
        .from('import_jobs')
        .update({
            status: 'processing',
            started_at: now,
            heartbeat_at: now,
        })
        .eq('id', candidates[0].id)
        .eq('status', 'pending')
        .select('id, client_id, kind, payload, attempts')
        .single();
    if (error || !claimed) return null;

    // Bump attempts separately (PostgREST can't do attempts = attempts + 1).
    await supabase
        .from('import_jobs')
        .update({ attempts: (claimed.attempts as number) + 1 })
        .eq('id', claimed.id);

    return claimed as ImportJobRow;
}

async function runJob(job: ImportJobRow): Promise<void> {
    console.log(`[IMPORT] Processing job ${job.id} (${job.kind}) for client ${job.client_id}`);
    const startTime = Date.now();

    // Accumulate counts across progress calls; every write doubles as a
    // heartbeat so the reclaimer knows we're alive.
    const counts: JobCounts = { contactsCreated: 0, contactsUpdated: 0, enrolled: 0, skipped: 0 };
    const onProgress: ProgressFn = async (update) => {
        Object.assign(counts, update.counts || {});
        const patch: Record<string, unknown> = {
            counts,
            heartbeat_at: new Date().toISOString(),
        };
        if (update.totalRows !== undefined) patch.total_rows = update.totalRows;
        if (update.processedRows !== undefined) patch.processed_rows = update.processedRows;
        await supabase.from('import_jobs').update(patch).eq('id', job.id);
    };

    try {
        const outcome =
            job.kind === 'contact_import'
                ? await processContactImport(
                      job.client_id,
                      job.payload as unknown as ContactImportPayload,
                      onProgress,
                  )
                : await processListEnroll(
                      job.client_id,
                      job.payload as unknown as ListEnrollPayload,
                      onProgress,
                  );

        await supabase
            .from('import_jobs')
            .update({
                status: 'completed',
                total_rows: outcome.totalRows,
                processed_rows: outcome.totalRows,
                counts: outcome.counts,
                errors: capErrors(outcome.errors),
                result: outcome.result,
                finished_at: new Date().toISOString(),
                heartbeat_at: new Date().toISOString(),
            })
            .eq('id', job.id);

        console.log(
            `[IMPORT] Job ${job.id} completed in ${Date.now() - startTime}ms — ` +
                `${outcome.counts.contactsCreated} created, ${outcome.counts.contactsUpdated} updated, ` +
                `${outcome.counts.enrolled} enrolled, ${outcome.counts.skipped} skipped, ` +
                `${outcome.errors.length} row errors`,
        );
    } catch (err: any) {
        const message = err?.message || 'Unknown import error';
        console.error(`[IMPORT] Job ${job.id} failed:`, message);
        await supabase
            .from('import_jobs')
            .update({
                status: 'failed',
                error: message,
                finished_at: new Date().toISOString(),
                heartbeat_at: new Date().toISOString(),
            })
            .eq('id', job.id);
    }
}

async function tick(): Promise<void> {
    try {
        await reclaimStaleJobs();
        // Drain: process jobs one at a time until the queue is empty, so a
        // burst of imports doesn't wait one poll interval per job.
        for (;;) {
            if (shuttingDown) return;
            const job = await claimNextJob();
            if (!job) return;
            await runJob(job);
        }
    } catch (error) {
        console.error('[IMPORT] Tick error:', error);
    }
}

let shuttingDown = false;
let inFlightTick: Promise<void> | null = null;

async function start(): Promise<void> {
    console.log('[IMPORT] Starting import worker...');
    console.log(`[IMPORT] Poll interval: ${POLL_INTERVAL_MS}ms`);

    // Recursive setTimeout (not setInterval) so a slow job can never overlap
    // the next tick — same pattern as the scheduler worker.
    const loop = async () => {
        if (shuttingDown) return;
        inFlightTick = tick();
        try {
            await inFlightTick;
        } catch (err) {
            console.error('[IMPORT] Unhandled tick error:', err);
        } finally {
            inFlightTick = null;
            if (!shuttingDown) setTimeout(loop, POLL_INTERVAL_MS);
        }
    };
    void loop();

    console.log('[IMPORT] Import worker running');
}

// Graceful shutdown: stop claiming, drain the in-flight job (all writes are
// idempotent, but finishing cleanly avoids a 3-minute reclaim delay for the
// user watching the progress bar), then exit.
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[IMPORT] Received ${signal}, draining in-flight job before exit...`);
    if (inFlightTick) {
        try {
            await inFlightTick;
        } catch (err) {
            console.error('[IMPORT] In-flight job errored during shutdown:', err);
        }
    }
    console.log('[IMPORT] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

start().catch((error) => {
    console.error('[IMPORT] Failed to start:', error);
    process.exit(1);
});
