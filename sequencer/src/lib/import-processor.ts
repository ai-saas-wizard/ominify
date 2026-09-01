/**
 * Import Processor
 *
 * Executes `import_jobs` rows claimed by the import-worker: CSV contact
 * imports (with optional list creation, tags, and sequence enrollment) and
 * saved-list -> sequence enrollments.
 *
 * This is the server-side home of logic that used to live in the Next.js
 * server actions (src/app/actions/_helpers/contact-import.ts +
 * createListFromImport / enrollListInSequence / enrollUpsertedRows in
 * sequence-actions.ts). It was moved here so the work survives the user
 * closing the browser and is freed from Vercel's function timeout. The
 * Next.js side now only enqueues jobs (src/app/actions/import-job-actions.ts).
 *
 * Everything here is IDEMPOTENT so a retried job never duplicates work:
 *   - contacts upsert on the (client_id, phone) unique index
 *   - list members upsert on the (list_id, contact_id) primary key
 *   - list creation reuses an existing same-named active list
 *   - enrollment only touches contacts with NO enrollment or a 'failed' one;
 *     active/paused/completed/engaged enrollments are skipped (never reset),
 *     so re-uploading a list cannot re-contact anyone the sequence already
 *     touched.
 */

import Papa from 'papaparse';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { supabase } from './db.js';

export const CONTACT_IMPORTS_BUCKET = 'contact-imports';

// Mirrors src/components/contacts/import/import-limits.ts. Enforced here (the
// enqueue action can't cheaply count rows without downloading the CSV).
export const MAX_IMPORT_ROWS = 10_000;

// Same batching strategy as the old Next-side helpers: keeps each PostgREST
// round-trip well under request size limits (source_row JSONB can be multi-KB
// per row) while amortising latency.
const BATCH_SIZE = 500;
// Max ids per `.in()` filter. PostgREST puts these in the URL query string,
// which Supabase's gateway rejects past ~16 KB: 1000 UUIDs is a 400 Bad
// Request, 500 fails at the socket, 300 works. 200 keeps a wide margin for
// both UUIDs and phone numbers. Upserts are POST bodies and are unaffected.
const LOOKUP_CHUNK = 200;
// Supabase silently caps an un-paginated select at 1000 rows, so anything
// that reads "all members" must page with .range().
const PAGE_SIZE = 1000;
const MAX_STORED_ERRORS = 200;

type ColumnRole =
    | 'phone'
    | 'email'
    | 'first_name'
    | 'last_name'
    | 'company'
    | 'custom_variable'
    | 'skip';

export interface ContactImportPayload {
    storagePath: string;
    columnMapping: Record<string, ColumnRole>;
    customFieldDescriptions?: Record<string, { description: string; dirty: boolean }>;
    tagIds?: string[];
    createList?: boolean;
    listName?: string;
    description?: string;
    sourceFilename?: string;
    enrollIntoSequenceId?: string;
    isTest?: boolean;
}

export interface ListEnrollPayload {
    listId: string;
    sequenceId: string;
    isTest?: boolean;
}

export interface JobCounts {
    contactsCreated: number;
    contactsUpdated: number;
    enrolled: number;
    skipped: number;
}

export interface JobOutcome {
    counts: JobCounts;
    errors: string[];
    result: { listId?: string; sequenceId?: string };
    totalRows: number;
}

/** Progress callback — the worker persists these to the job row per batch. */
export type ProgressFn = (update: {
    totalRows?: number;
    processedRows?: number;
    counts?: Partial<JobCounts>;
}) => Promise<void>;

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

function toE164(raw: string): string | null {
    if (!raw) return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), 'US');
    return parsed && parsed.isValid() ? parsed.number : null;
}

/** Cap stored errors so a 10k-row disaster can't bloat the job row. */
export function capErrors(errors: string[]): string[] {
    if (errors.length <= MAX_STORED_ERRORS) return errors;
    return [
        ...errors.slice(0, MAX_STORED_ERRORS),
        `...and ${errors.length - MAX_STORED_ERRORS} more`,
    ];
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export async function downloadCsv(storagePath: string): Promise<string> {
    const { data, error } = await supabase.storage
        .from(CONTACT_IMPORTS_BUCKET)
        .download(storagePath);
    if (error || !data) {
        throw new Error(`Failed to download CSV: ${error?.message || 'no data'}`);
    }
    return await data.text();
}

export async function deleteCsv(storagePath: string): Promise<void> {
    if (!storagePath) return;
    const { error } = await supabase.storage
        .from(CONTACT_IMPORTS_BUCKET)
        .remove([storagePath]);
    if (error) console.warn('[IMPORT] deleteCsv:', error.message);
}

/** Mirror of parseCsvText in contact-list-actions.ts. */
export function parseCsvText(text: string): Record<string, string>[] {
    const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
    });
    if (result.errors.length > 0) {
        throw new Error(`CSV parse error: ${result.errors[0].message}`);
    }
    return (result.data as Record<string, string>[]).filter((r) =>
        Object.values(r).some((v) => (v || '').trim()),
    );
}

// ─── Contact upsert (port of upsertContactsFromRows) ────────────────────────

interface PreparedRow {
    phone: string;
    rowIndex: number;
    name: string | null;
    email: string;
    customFields: Record<string, string>;
    customVariables: Record<string, string>;
    sourceRow: Record<string, string>;
}

interface UpsertedRow {
    contactId: string;
    rowIndex: number;
    phone: string;
    customVariables: Record<string, string>;
    sourceRow: Record<string, string>;
}

interface UpsertResult {
    upserted: UpsertedRow[];
    errors: string[];
    contactsCreated: number;
    contactsUpdated: number;
}

function buildRoleToColumns(columnMapping: Record<string, ColumnRole>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [col, role] of Object.entries(columnMapping)) {
        if (!out[role]) out[role] = [];
        out[role].push(col);
    }
    return out;
}

/**
 * Upsert contacts from CSV-style rows. Dedupes by E.164 phone in-memory
 * (second occurrence wins), skips opted-out contacts, merges non-empty new
 * values over existing ones. Same merge policy as the old Next-side helper.
 */
async function upsertContactsFromRows(
    clientId: string,
    rows: Record<string, string>[],
    columnMapping: Record<string, ColumnRole>,
    onProgress?: ProgressFn,
): Promise<UpsertResult> {
    const errors: string[] = [];
    const upserted: UpsertedRow[] = [];

    const roleToColumns = buildRoleToColumns(columnMapping);

    // Phase 1: parse + normalise + in-memory dedupe by phone.
    const dedupedByPhone = new Map<string, PreparedRow>();
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowIndex = i + 1;
        const rawPhone =
            (roleToColumns.phone || []).map((col) => row[col]?.trim()).find((v) => v) || '';
        const phone = toE164(rawPhone);
        if (rawPhone && !phone) {
            errors.push(`Row ${rowIndex}: Invalid phone number "${rawPhone}"`);
            continue;
        }
        if (!phone) {
            errors.push(`Row ${rowIndex}: Missing phone number`);
            continue;
        }

        const email =
            (roleToColumns.email || []).map((col) => row[col]?.trim()).find((v) => v) || '';
        const firstName =
            (roleToColumns.first_name || []).map((col) => row[col]?.trim()).find((v) => v) || '';
        const lastName =
            (roleToColumns.last_name || []).map((col) => row[col]?.trim()).find((v) => v) || '';
        const company =
            (roleToColumns.company || []).map((col) => row[col]?.trim()).find((v) => v) || '';
        const nameParts = [firstName, lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(' ') : null;

        // Anti-cold-outreach: every row must have a name.
        if (!name) {
            errors.push(`Row ${rowIndex}: Missing name — skipped to prevent cold outreach.`);
            continue;
        }

        const customFields: Record<string, string> = {};
        if (company) customFields.company = company;
        for (const col of roleToColumns.custom_variable || []) {
            const v = row[col]?.trim();
            if (v) customFields[col] = v;
        }

        const customVariables: Record<string, string> = {};
        for (const [col, role] of Object.entries(columnMapping)) {
            if (role !== 'skip' && row[col]?.trim()) {
                customVariables[col] = row[col].trim();
            }
        }

        const sourceRow: Record<string, string> = {};
        for (const [col, val] of Object.entries(row)) {
            if (val !== undefined && val !== null) sourceRow[col] = String(val);
        }

        dedupedByPhone.set(phone, {
            phone,
            rowIndex,
            name,
            email,
            customFields,
            customVariables,
            sourceRow,
        });
    }

    if (dedupedByPhone.size === 0) {
        return { upserted, errors, contactsCreated: 0, contactsUpdated: 0 };
    }

    // Phase 2: bulk SELECT existing contacts by phone.
    interface ExistingContact {
        id: string;
        phone: string;
        name: string | null;
        email: string | null;
        custom_fields: Record<string, unknown> | null;
        opted_out_at: string | null;
    }
    const phones = Array.from(dedupedByPhone.keys());
    const existingByPhone = new Map<string, ExistingContact>();
    for (const batch of chunk(phones, LOOKUP_CHUNK)) {
        const { data, error } = await supabase
            .from('contacts')
            .select('id, phone, name, email, custom_fields, opted_out_at')
            .eq('client_id', clientId)
            .in('phone', batch);
        if (error) throw new Error(`Failed to look up existing contacts: ${error.message}`);
        for (const r of (data || []) as ExistingContact[]) existingByPhone.set(r.phone, r);
    }

    // Phase 3: build payloads; skip opted-out contacts.
    const toUpsert: Record<string, unknown>[] = [];
    let contactsCreated = 0;
    let contactsUpdated = 0;

    for (const prepared of dedupedByPhone.values()) {
        const existing = existingByPhone.get(prepared.phone);
        if (existing?.opted_out_at) {
            errors.push(
                `Row ${prepared.rowIndex}: Contact (${prepared.phone}) is opted out — skipped.`,
            );
            continue;
        }
        if (existing) {
            toUpsert.push({
                client_id: clientId,
                phone: prepared.phone,
                name: prepared.name || existing.name || null,
                email: prepared.email || existing.email || null,
                custom_fields: { ...(existing.custom_fields || {}), ...prepared.customFields },
            });
            contactsUpdated++;
        } else {
            toUpsert.push({
                client_id: clientId,
                phone: prepared.phone,
                name: prepared.name,
                email: prepared.email || null,
                custom_fields: prepared.customFields,
                total_calls: 0,
            });
            contactsCreated++;
        }
    }

    // Phase 4: batched UPSERT on (client_id, phone), progress after each batch.
    const idByPhone = new Map<string, string>();
    let processed = 0;
    for (const batch of chunk(toUpsert, BATCH_SIZE)) {
        const { data, error } = await supabase
            .from('contacts')
            .upsert(batch, { onConflict: 'client_id,phone' })
            .select('id, phone');
        if (error) throw new Error(`Bulk contact upsert failed: ${error.message}`);
        for (const r of data || []) idByPhone.set(r.phone as string, r.id as string);
        processed += batch.length;
        await onProgress?.({
            processedRows: processed,
            counts: { contactsCreated, contactsUpdated },
        });
    }

    // Phase 5: assemble results in original CSV order.
    const ordered = [...dedupedByPhone.values()].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const prepared of ordered) {
        const contactId = idByPhone.get(prepared.phone);
        if (!contactId) continue; // opted-out
        upserted.push({
            contactId,
            rowIndex: prepared.rowIndex,
            phone: prepared.phone,
            customVariables: prepared.customVariables,
            sourceRow: prepared.sourceRow,
        });
    }

    return { upserted, errors, contactsCreated, contactsUpdated };
}

// ─── Custom fields (port of registerCustomFields) ───────────────────────────

async function registerCustomFields(
    clientId: string,
    columnMapping: Record<string, ColumnRole>,
    descriptions: Record<string, { description: string; dirty: boolean }> = {},
): Promise<void> {
    const customCols = Object.entries(columnMapping)
        .filter(([, role]) => role === 'custom_variable')
        .map(([col]) => col);
    if (customCols.length === 0) return;

    const { data: existing } = await supabase
        .from('contact_fields')
        .select('id, field_key, description')
        .eq('client_id', clientId)
        .in('field_key', customCols);
    const existingByKey = new Map(
        (existing || []).map((r: any) => [r.field_key as string, r]),
    );

    const nextOrderQuery = await supabase
        .from('contact_fields')
        .select('display_order')
        .eq('client_id', clientId)
        .order('display_order', { ascending: false })
        .limit(1);
    let nextOrder = (nextOrderQuery.data?.[0]?.display_order ?? -1) + 1;

    for (const col of customCols) {
        const desc = descriptions[col];
        const existingDef = existingByKey.get(col);
        if (!existingDef) {
            const friendlyName = col
                .replace(/[_-]+/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase());
            await supabase.from('contact_fields').insert({
                client_id: clientId,
                name: friendlyName,
                field_key: col,
                field_type: 'text',
                description: desc?.description?.trim() || null,
                display_order: nextOrder++,
            });
        } else if (desc?.dirty) {
            // Only overwrite a description the user re-typed this import.
            await supabase
                .from('contact_fields')
                .update({ description: desc.description?.trim() || null })
                .eq('id', existingDef.id);
        }
    }
}

// ─── List creation ──────────────────────────────────────────────────────────

/**
 * Create the contact list, or REUSE an existing active list with the same
 * name (case-insensitive — matches the uq_contact_lists_client_name_active
 * index). Reuse is what makes a re-run of the same import land members in the
 * same list instead of dying on the unique index.
 */
async function ensureList(
    clientId: string,
    payload: ContactImportPayload,
): Promise<string> {
    const name = (payload.listName || '').trim();
    // ilike pattern-escape so a list name containing % or _ matches literally.
    const escaped = name.replace(/([\\%_])/g, '\\$1');
    const { data: existing } = await supabase
        .from('contact_lists')
        .select('id')
        .eq('client_id', clientId)
        .ilike('name', escaped)
        .is('archived_at', null)
        .limit(1);
    if (existing && existing.length > 0) return existing[0].id as string;

    const { data: listRow, error } = await supabase
        .from('contact_lists')
        .insert({
            client_id: clientId,
            name,
            description: payload.description?.trim() || null,
            source: 'csv',
            source_filename: payload.sourceFilename || null,
            column_mapping: payload.columnMapping,
            contact_count: 0,
        })
        .select('id')
        .single();
    if (error || !listRow) throw new Error(`Failed to create list: ${error?.message}`);
    return listRow.id as string;
}

async function insertListMembers(listId: string, upserted: UpsertedRow[]): Promise<void> {
    const memberRows = upserted.map((u) => ({
        list_id: listId,
        contact_id: u.contactId,
        source_row: u.sourceRow,
        added_via: 'csv',
    }));
    for (const batch of chunk(memberRows, BATCH_SIZE)) {
        const { error } = await supabase
            .from('contact_list_members')
            .upsert(batch, { onConflict: 'list_id,contact_id' });
        if (error) throw new Error(`List members insert failed: ${error.message}`);
    }
    const { count } = await supabase
        .from('contact_list_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('list_id', listId);
    await supabase
        .from('contact_lists')
        .update({ contact_count: count || 0, updated_at: new Date().toISOString() })
        .eq('id', listId);
}

async function assignTags(tagIds: string[], contactIds: string[]): Promise<void> {
    if (tagIds.length === 0 || contactIds.length === 0) return;
    const rows: { contact_id: string; tag_id: string }[] = [];
    for (const cid of contactIds) {
        for (const tid of tagIds) rows.push({ contact_id: cid, tag_id: tid });
    }
    for (const batch of chunk(rows, BATCH_SIZE)) {
        const { error } = await supabase
            .from('contact_tag_assignments')
            .upsert(batch, { onConflict: 'contact_id,tag_id' });
        if (error) throw new Error(`Tag assignment failed: ${error.message}`);
    }
}

// ─── Enrollment (batched replacement for enrollUpsertedRows) ────────────────

// Statuses that block (re-)enrollment. Everything except 'failed': an active
// or paused enrollment is already in flight, a completed one already got the
// whole sequence, and the engaged statuses mean the lead responded. Only
// contacts with NO enrollment or a 'failed' one get (re-)enrolled — this is
// what makes re-uploading a list idempotent instead of re-dialing leads.
const SKIP_STATUSES = new Set([
    'active',
    'paused',
    'completed',
    'replied',
    'booked',
    'converted',
    'manual_stop',
    'unenrolled',
]);

async function enrollUpsertedRows(
    sequenceId: string,
    clientId: string,
    upserted: UpsertedRow[],
    options: { isTest?: boolean; sourceListId?: string | null; enrollmentSource?: string },
    onProgress?: ProgressFn,
): Promise<{ enrolled: number; skipped: number; errors: string[] }> {
    if (upserted.length === 0) return { enrolled: 0, skipped: 0, errors: [] };

    const isTest = options.isTest === true;
    const errors: string[] = [];

    const { data: sequenceRow, error: seqErr } = await supabase
        .from('sequences')
        .select('id, pacing_per_minute')
        .eq('id', sequenceId)
        .single();
    if (seqErr || !sequenceRow) throw new Error('Sequence not found');
    const pacingPerMinute = sequenceRow.pacing_per_minute as number | null;
    const pacingIntervalMs =
        pacingPerMinute && pacingPerMinute > 0 ? Math.floor(60_000 / pacingPerMinute) : 0;
    const baseTime = Date.now();

    // Bulk SELECT existing enrollments for every contact in one pass.
    const existingByContact = new Map<string, { id: string; status: string }>();
    const contactIds = upserted.map((u) => u.contactId);
    for (const batch of chunk(contactIds, LOOKUP_CHUNK)) {
        const { data, error } = await supabase
            .from('sequence_enrollments')
            .select('id, contact_id, status')
            .eq('sequence_id', sequenceId)
            .in('contact_id', batch);
        if (error) throw new Error(`Enrollment lookup failed: ${error.message}`);
        for (const r of data || []) {
            existingByContact.set(r.contact_id as string, {
                id: r.id as string,
                status: r.status as string,
            });
        }
    }

    // Partition: skip vs enroll. A CSV can contain the same contact twice
    // only pre-dedupe, so contactIds are unique here.
    const toEnroll: UpsertedRow[] = [];
    let skipped = 0;
    for (const row of upserted) {
        const existing = existingByContact.get(row.contactId);
        if (existing && SKIP_STATUSES.has(existing.status)) {
            skipped++;
            errors.push(
                `Row ${row.rowIndex}: Contact (${row.phone}) already ${existing.status} in this sequence — skipped.`,
            );
            continue;
        }
        toEnroll.push(row);
    }

    // Batched UPSERT on (sequence_id, contact_id). The only conflicting rows
    // left are 'failed' ones, which we deliberately reset to step 0.
    let enrolled = 0;
    const nowIso = new Date().toISOString();
    for (const batch of chunk(toEnroll, BATCH_SIZE)) {
        const payloads = batch.map((row, i) => ({
            sequence_id: sequenceId,
            contact_id: row.contactId,
            tenant_id: clientId,
            status: 'active',
            current_step_order: 0,
            enrollment_source: options.enrollmentSource ?? 'csv_upload',
            enrolled_at: nowIso,
            next_step_at: isTest
                ? nowIso
                : pacingIntervalMs
                  ? new Date(baseTime + (enrolled + i) * pacingIntervalMs).toISOString()
                  : nowIso,
            is_test: isTest,
            completed_at: null,
            sentiment_trend: 'stable',
            last_emotion: null,
            recommended_tone: null,
            is_hot_lead: false,
            is_at_risk: false,
            engagement_score: 50,
            needs_human_intervention: false,
            custom_variables: row.customVariables,
            source_list_id: options.sourceListId ?? null,
            contact_replied: false,
            contact_answered_call: false,
            appointment_booked: false,
            channel_overrides: {},
        }));
        const { error } = await supabase
            .from('sequence_enrollments')
            .upsert(payloads, { onConflict: 'sequence_id,contact_id' });
        if (error) throw new Error(`Enrollment upsert failed: ${error.message}`);
        enrolled += batch.length;
        await onProgress?.({ counts: { enrolled, skipped } });
    }

    // Pipeline advance for the newly enrolled contacts (New Lead -> Contacted),
    // batched — the old per-contact loop was 4 queries per row.
    try {
        await bulkAdvanceContacts(
            clientId,
            toEnroll.map((r) => r.contactId),
        );
    } catch (e: any) {
        // Same stance as the old .catch(() => {}): pipeline placement is
        // best-effort and never fails an enrollment.
        console.warn('[IMPORT] bulkAdvanceContacts failed:', e?.message);
    }

    return { enrolled, skipped, errors };
}

// ─── Batched pipeline advance ───────────────────────────────────────────────

/**
 * Batched port of autoAdvanceContactStage(contactId, clientId, "New Lead")
 * followed by ...("Contacted") from pipeline-actions.ts. Per pipeline the
 * combined effect is: advance to "Contacted" when that stage exists (else
 * "New Lead"), forward-only, skipping user-moved contacts; contacts in no
 * pipeline join the default pipeline at the target stage.
 */
async function bulkAdvanceContacts(clientId: string, contactIds: string[]): Promise<void> {
    if (contactIds.length === 0) return;

    const { data: pipelines } = await supabase
        .from('pipelines')
        .select('id, is_default')
        .eq('client_id', clientId);
    if (!pipelines || pipelines.length === 0) return;
    const pipelineIds = pipelines.map((p) => p.id as string);
    const defaultPipelineId =
        (pipelines.find((p) => p.is_default)?.id as string | undefined) ?? null;

    const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name, position, pipeline_id')
        .in('pipeline_id', pipelineIds)
        .order('position', { ascending: true });
    if (!stages || stages.length === 0) return;

    // Per pipeline: the stage we advance to, preferring "Contacted".
    const targetByPipeline = new Map<string, { id: string; position: number }>();
    const stagesByPipeline = new Map<string, { id: string; position: number }[]>();
    for (const s of stages) {
        const pid = s.pipeline_id as string;
        if (!stagesByPipeline.has(pid)) stagesByPipeline.set(pid, []);
        stagesByPipeline.get(pid)!.push({ id: s.id as string, position: s.position as number });
    }
    for (const pid of pipelineIds) {
        const contacted = stages.find(
            (s) => s.pipeline_id === pid && s.name === 'Contacted',
        );
        const newLead = stages.find(
            (s) => s.pipeline_id === pid && s.name === 'New Lead',
        );
        const target = contacted || newLead;
        if (target) {
            targetByPipeline.set(pid, {
                id: target.id as string,
                position: target.position as number,
            });
        }
    }
    if (targetByPipeline.size === 0) return;

    // Existing pipeline placements for these contacts.
    interface PcRow {
        id: string;
        pipeline_id: string;
        contact_id: string;
        stage_id: string | null;
        moved_by: string | null;
    }
    const pcs: PcRow[] = [];
    for (const batch of chunk(contactIds, LOOKUP_CHUNK)) {
        const { data } = await supabase
            .from('pipeline_contacts')
            .select('id, pipeline_id, contact_id, stage_id, moved_by')
            .in('contact_id', batch)
            .in('pipeline_id', pipelineIds);
        for (const r of (data || []) as PcRow[]) pcs.push(r);
    }
    const pcsByContact = new Map<string, PcRow[]>();
    for (const pc of pcs) {
        if (!pcsByContact.has(pc.contact_id)) pcsByContact.set(pc.contact_id, []);
        pcsByContact.get(pc.contact_id)!.push(pc);
    }

    const now = new Date().toISOString();
    const updates: { id: string; from: string | null; stageId: string; pipelineId: string; contactId: string }[] = [];
    const inserts: { pipeline_id: string; contact_id: string; stage_id: string; moved_at: string; moved_by: string }[] = [];

    for (const contactId of contactIds) {
        const placements = pcsByContact.get(contactId) || [];
        if (placements.length === 0) {
            // Not in any pipeline — join the default pipeline at target stage.
            if (!defaultPipelineId) continue;
            const target = targetByPipeline.get(defaultPipelineId);
            if (!target) continue;
            inserts.push({
                pipeline_id: defaultPipelineId,
                contact_id: contactId,
                stage_id: target.id,
                moved_at: now,
                moved_by: 'auto',
            });
            continue;
        }
        for (const pc of placements) {
            if (pc.moved_by === 'user') continue; // manual moves are sacred
            const target = targetByPipeline.get(pc.pipeline_id);
            if (!target) continue;
            const pipelineStages = stagesByPipeline.get(pc.pipeline_id) || [];
            const current = pc.stage_id
                ? pipelineStages.find((s) => s.id === pc.stage_id)
                : null;
            // Advance when there's no current stage, the stage was deleted,
            // or the target is strictly ahead (forward-only).
            if (!current || target.position > current.position) {
                updates.push({
                    id: pc.id,
                    from: pc.stage_id,
                    stageId: target.id,
                    pipelineId: pc.pipeline_id,
                    contactId,
                });
            }
        }
    }

    // Apply inserts (returning ids for history), then updates, then history.
    const historyRows: { pipeline_contact_id: string; from_stage_id: string | null; to_stage_id: string; moved_by: string; moved_at: string }[] = [];
    const defaultStageByContact = new Map<string, string>();

    for (const batch of chunk(inserts, BATCH_SIZE)) {
        const { data, error } = await supabase
            .from('pipeline_contacts')
            .upsert(batch, { onConflict: 'pipeline_id,contact_id', ignoreDuplicates: true })
            .select('id, contact_id, stage_id, pipeline_id');
        if (error) {
            console.warn('[IMPORT] pipeline_contacts insert failed:', error.message);
            continue;
        }
        for (const r of data || []) {
            historyRows.push({
                pipeline_contact_id: r.id as string,
                from_stage_id: null,
                to_stage_id: r.stage_id as string,
                moved_by: 'auto',
                moved_at: now,
            });
            if (r.pipeline_id === defaultPipelineId) {
                defaultStageByContact.set(r.contact_id as string, r.stage_id as string);
            }
        }
    }

    // Updates share the same target per pipeline, so group by (pipeline, stage)
    // and update by id list — one round trip per pipeline instead of per row.
    const updatesByStage = new Map<string, { stageId: string; ids: string[] }>();
    for (const u of updates) {
        const key = `${u.pipelineId}:${u.stageId}`;
        if (!updatesByStage.has(key)) updatesByStage.set(key, { stageId: u.stageId, ids: [] });
        updatesByStage.get(key)!.ids.push(u.id);
        historyRows.push({
            pipeline_contact_id: u.id,
            from_stage_id: u.from,
            to_stage_id: u.stageId,
            moved_by: 'auto',
            moved_at: now,
        });
        if (u.pipelineId === defaultPipelineId) {
            defaultStageByContact.set(u.contactId, u.stageId);
        }
    }
    for (const { stageId, ids } of updatesByStage.values()) {
        for (const batch of chunk(ids, LOOKUP_CHUNK)) {
            const { error } = await supabase
                .from('pipeline_contacts')
                .update({ stage_id: stageId, moved_at: now, moved_by: 'auto' })
                .in('id', batch);
            if (error) console.warn('[IMPORT] pipeline_contacts update failed:', error.message);
        }
    }

    for (const batch of chunk(historyRows, BATCH_SIZE)) {
        const { error } = await supabase.from('pipeline_contact_history').insert(batch);
        if (error) console.warn('[IMPORT] pipeline history insert failed:', error.message);
    }

    // Backward compat (mirrors moveContactToStage): default-pipeline moves
    // also stamp contacts.pipeline_stage_id. Group by stage for batching.
    const contactsByStage = new Map<string, string[]>();
    for (const [contactId, stageId] of defaultStageByContact) {
        if (!contactsByStage.has(stageId)) contactsByStage.set(stageId, []);
        contactsByStage.get(stageId)!.push(contactId);
    }
    for (const [stageId, ids] of contactsByStage) {
        for (const batch of chunk(ids, LOOKUP_CHUNK)) {
            const { error } = await supabase
                .from('contacts')
                .update({
                    pipeline_stage_id: stageId,
                    pipeline_stage_moved_at: now,
                    pipeline_stage_moved_by: 'auto',
                })
                .in('id', batch);
            if (error) console.warn('[IMPORT] contacts stage update failed:', error.message);
        }
    }
}

// ─── Job handlers ───────────────────────────────────────────────────────────

/** contact_import: CSV -> contacts (+ optional list, tags, enrollment). */
export async function processContactImport(
    clientId: string,
    payload: ContactImportPayload,
    onProgress: ProgressFn,
): Promise<JobOutcome> {
    const { storagePath, columnMapping } = payload;
    if (!storagePath) throw new Error('Missing uploaded CSV reference');
    if (!Object.values(columnMapping || {}).includes('phone')) {
        throw new Error('A phone column mapping is required');
    }
    if (
        !Object.values(columnMapping).some((r) => r === 'first_name' || r === 'last_name')
    ) {
        throw new Error('A name column mapping (first or last) is required to prevent cold outreach');
    }

    const text = await downloadCsv(storagePath);
    const rows = parseCsvText(text);
    if (rows.length === 0) throw new Error('No rows to import');
    if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error(
            `Import limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows per file. Please split your list.`,
        );
    }
    await onProgress({ totalRows: rows.length });

    await registerCustomFields(clientId, columnMapping, payload.customFieldDescriptions || {});
    const upsertResult = await upsertContactsFromRows(clientId, rows, columnMapping, onProgress);
    const errors = [...upsertResult.errors];
    const result: JobOutcome['result'] = {};

    let listId: string | null = null;
    if (payload.createList) {
        listId = await ensureList(clientId, payload);
        result.listId = listId;
        if (upsertResult.upserted.length > 0) {
            await insertListMembers(listId, upsertResult.upserted);
        }
    }

    if ((payload.tagIds?.length ?? 0) > 0 && upsertResult.upserted.length > 0) {
        await assignTags(payload.tagIds!, upsertResult.upserted.map((u) => u.contactId));
    }

    let enrolled = 0;
    let skipped = 0;
    if (payload.enrollIntoSequenceId && upsertResult.upserted.length > 0) {
        result.sequenceId = payload.enrollIntoSequenceId;
        const enrollRes = await enrollUpsertedRows(
            payload.enrollIntoSequenceId,
            clientId,
            upsertResult.upserted,
            {
                isTest: payload.isTest,
                sourceListId: listId,
                enrollmentSource: listId ? 'list_enrollment' : 'csv_upload',
            },
            onProgress,
        );
        enrolled = enrollRes.enrolled;
        skipped = enrollRes.skipped;
        errors.push(...enrollRes.errors);
    }

    // Only drop the CSV when every row landed cleanly — with errors we keep
    // it so a re-enqueue ("retry failed rows") can re-read the same file.
    if (errors.length === 0) await deleteCsv(storagePath);

    return {
        totalRows: rows.length,
        counts: {
            contactsCreated: upsertResult.contactsCreated,
            contactsUpdated: upsertResult.contactsUpdated,
            enrolled,
            skipped,
        },
        errors,
        result,
    };
}

/** list_enroll: saved contact list -> sequence enrollments. */
export async function processListEnroll(
    clientId: string,
    payload: ListEnrollPayload,
    onProgress: ProgressFn,
): Promise<JobOutcome> {
    const { listId, sequenceId } = payload;
    const { data: list, error: listErr } = await supabase
        .from('contact_lists')
        .select('id, client_id, column_mapping, archived_at')
        .eq('id', listId)
        .single();
    if (listErr || !list) throw new Error('List not found');
    if (list.archived_at) throw new Error('Cannot enroll an archived list');
    if (list.client_id !== clientId) throw new Error('List belongs to a different client');

    const columnMapping = (list.column_mapping || {}) as Record<string, ColumnRole>;
    if (!Object.values(columnMapping).includes('phone')) {
        throw new Error('List has no phone column mapping. Edit the list mapping before enrolling.');
    }

    // Page through members — a plain select silently stops at 1000 rows,
    // which would enroll only the first third of a 3000-contact list.
    const members: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: membersErr } = await supabase
            .from('contact_list_members')
            .select('contact_id, source_row, contacts(id, phone, name, email, custom_fields)')
            .eq('list_id', listId)
            .order('added_at', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        if (membersErr) throw new Error(`Failed to load members: ${membersErr.message}`);
        members.push(...(page || []));
        if (!page || page.length < PAGE_SIZE) break;
    }
    if (members.length === 0) {
        return {
            totalRows: 0,
            counts: { contactsCreated: 0, contactsUpdated: 0, enrolled: 0, skipped: 0 },
            errors: ['List has no members'],
            result: { listId, sequenceId },
        };
    }
    await onProgress({ totalRows: members.length });

    // Contacts already exist; replay each member's stored source_row through
    // the list's column_mapping so custom_variables match the original CSV.
    const upserted: UpsertedRow[] = [];
    const errors: string[] = [];
    for (let i = 0; i < members.length; i++) {
        const m: any = members[i];
        const contact = m.contacts;
        if (!contact) {
            errors.push(`Member ${i + 1}: contact missing`);
            continue;
        }
        const row: Record<string, string> = m.source_row || syntheticRowFromContact(contact);
        const customVariables: Record<string, string> = {};
        for (const [col, role] of Object.entries(columnMapping)) {
            if (role !== 'skip' && row[col] !== undefined && String(row[col]).trim()) {
                customVariables[col] = String(row[col]).trim();
            }
        }
        upserted.push({
            contactId: contact.id,
            rowIndex: i + 1,
            phone: contact.phone,
            customVariables,
            sourceRow: row,
        });
    }

    const enrollRes = await enrollUpsertedRows(
        sequenceId,
        clientId,
        upserted,
        { isTest: payload.isTest, sourceListId: listId, enrollmentSource: 'list_enrollment' },
        onProgress,
    );
    await onProgress({ processedRows: members.length });

    return {
        totalRows: members.length,
        counts: {
            contactsCreated: 0,
            contactsUpdated: 0,
            enrolled: enrollRes.enrolled,
            skipped: enrollRes.skipped,
        },
        errors: [...errors, ...enrollRes.errors],
        result: { listId, sequenceId },
    };
}

/** Mirror of syntheticRowFromContact for members added manually (no source_row). */
function syntheticRowFromContact(contact: {
    phone: string;
    name?: string | null;
    email?: string | null;
    custom_fields?: Record<string, any> | null;
}): Record<string, string> {
    const row: Record<string, string> = { phone: contact.phone };
    if (contact.name) {
        const parts = contact.name.split(' ');
        row.first_name = parts[0] || '';
        row.last_name = parts.slice(1).join(' ');
    }
    if (contact.email) row.email = contact.email;
    if (contact.custom_fields) {
        for (const [k, v] of Object.entries(contact.custom_fields)) {
            if (v !== null && v !== undefined) row[k] = String(v);
        }
    }
    return row;
}
