-- Import jobs: durable server-side processing for CSV contact imports and
-- sequence enrollments. The Next.js app only ENQUEUES rows here (cheap insert
-- from a server action); the sequencer's import-worker on EC2 claims and
-- processes them. This is what lets an import/enroll survive the user closing
-- the browser tab — the work is no longer tied to a Vercel request.
--
-- Claiming protocol (import-worker.ts):
--   UPDATE ... SET status='processing', attempts=attempts+1, ...
--   WHERE id = $1 AND status = 'pending'  -- optimistic, single worker anyway
-- Stale jobs (processing + heartbeat older than 3 min) are reclaimed up to
-- 3 attempts, then marked failed. All processing is idempotent (contacts
-- upsert on (client_id, phone); enrollments skip anything already touched),
-- so a retried job never duplicates work.
--
-- RUN BY HAND on the prod database (standard procedure for this repo).

CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- 'contact_import': CSV in Storage -> contacts (+ optional list, tags, enroll)
    -- 'list_enroll':    saved contact list -> sequence enrollments
    kind TEXT NOT NULL CHECK (kind IN ('contact_import', 'list_enroll')),

    -- Kind-specific input, written once at enqueue time:
    --   contact_import: { storagePath, columnMapping, customFieldDescriptions,
    --                     tagIds, createList, listName, description,
    --                     sourceFilename, enrollIntoSequenceId?, isTest? }
    --   list_enroll:    { listId, sequenceId, isTest? }
    payload JSONB NOT NULL DEFAULT '{}',

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INT NOT NULL DEFAULT 0,

    -- Progress (updated by the worker after every batch so the UI can poll)
    total_rows INT,
    processed_rows INT NOT NULL DEFAULT 0,
    -- { contactsCreated, contactsUpdated, enrolled, skipped }
    counts JSONB NOT NULL DEFAULT '{}',
    -- Row-level errors/skips, capped at 200 entries + one overflow note
    errors JSONB NOT NULL DEFAULT '[]',
    -- { listId?, sequenceId? } — what the job produced/targeted
    result JSONB NOT NULL DEFAULT '{}',
    -- Fatal error message when status = 'failed'
    error TEXT,

    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Worker poll: oldest pending first / stale-processing reclaim.
CREATE INDEX IF NOT EXISTS idx_import_jobs_status_created
    ON import_jobs(status, created_at);
-- UI banner: this client's recent jobs.
CREATE INDEX IF NOT EXISTS idx_import_jobs_client_created
    ON import_jobs(client_id, created_at DESC);
