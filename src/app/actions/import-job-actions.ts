"use server";

import { supabase } from "@/lib/supabase";
import type { ColumnRole } from "@/components/contacts/import/import-types";

// Server-side import jobs. These actions only ENQUEUE work into the
// `import_jobs` table (and let the UI poll progress) — the heavy lifting
// (CSV parse, contact upserts, list creation, sequence enrollment) runs in
// the sequencer's import-worker on EC2 (sequencer/src/workers/import-worker.ts
// + import-processor.ts). That's what lets an import or enrollment finish
// even if the user closes the browser tab mid-way, which the old inline
// server actions (createListFromImport / enrollListInSequence) could not
// survive: they died with the Vercel request.
//
// Everything the worker does is idempotent (contacts upsert on
// (client_id, phone), members on their PK, enrollment skips any contact the
// sequence already touched), so re-running a job — or re-uploading the same
// CSV — never duplicates contacts or re-contacts a lead.

export interface StartContactImportInput {
    clientId: string;
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

export interface ImportJobStatus {
    id: string;
    kind: "contact_import" | "list_enroll";
    status: "pending" | "processing" | "completed" | "failed";
    totalRows: number | null;
    processedRows: number;
    counts: {
        contactsCreated?: number;
        contactsUpdated?: number;
        enrolled?: number;
        skipped?: number;
    };
    errors: string[];
    result: { listId?: string; sequenceId?: string };
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
    /** Display label for banners: source filename or list name. */
    label: string | null;
}

function toStatus(row: any): ImportJobStatus {
    const payload = row.payload || {};
    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        totalRows: row.total_rows ?? null,
        processedRows: row.processed_rows ?? 0,
        counts: row.counts || {},
        errors: Array.isArray(row.errors) ? row.errors : [],
        result: row.result || {},
        error: row.error ?? null,
        createdAt: row.created_at,
        finishedAt: row.finished_at ?? null,
        label: payload.sourceFilename || payload.listName || null,
    };
}

// Enqueue a CSV contact import (the Imports wizard and the task dialog's CSV
// path). Validation here is only what's cheap without downloading the CSV —
// the worker re-validates everything, including the row cap.
export async function startContactImportJob(input: StartContactImportInput): Promise<{
    success: boolean;
    error?: string;
    data?: { jobId: string };
}> {
    try {
        const { clientId, storagePath, columnMapping } = input;
        if (!clientId) return { success: false, error: "Missing clientId" };
        if (!storagePath) {
            return { success: false, error: "Missing uploaded CSV reference" };
        }
        if (!Object.values(columnMapping || {}).includes("phone")) {
            return { success: false, error: "A phone column mapping is required" };
        }
        if (
            !Object.values(columnMapping).some(
                (r) => r === "first_name" || r === "last_name",
            )
        ) {
            return {
                success: false,
                error: "A name column mapping (first or last) is required to prevent cold outreach",
            };
        }
        if (input.createList && !input.listName?.trim()) {
            return { success: false, error: "List name is required" };
        }

        const { data, error } = await supabase
            .from("import_jobs")
            .insert({
                client_id: clientId,
                kind: "contact_import",
                payload: {
                    storagePath,
                    columnMapping,
                    customFieldDescriptions: input.customFieldDescriptions || {},
                    tagIds: input.tagIds || [],
                    createList: input.createList === true,
                    listName: input.listName?.trim() || null,
                    description: input.description?.trim() || null,
                    sourceFilename: input.sourceFilename || null,
                    enrollIntoSequenceId: input.enrollIntoSequenceId || null,
                    isTest: input.isTest === true,
                },
            })
            .select("id")
            .single();
        if (error || !data) {
            return { success: false, error: error?.message || "Failed to queue import" };
        }
        return { success: true, data: { jobId: data.id as string } };
    } catch (e: any) {
        console.error("startContactImportJob error:", e);
        return { success: false, error: e?.message || "Internal error" };
    }
}

// Enqueue enrolling a saved contact list into a sequence (sequence page's
// enroll card + the task dialog's saved-list path).
export async function startListEnrollJob(
    sequenceId: string,
    listId: string,
    options?: { isTest?: boolean },
): Promise<{ success: boolean; error?: string; data?: { jobId: string } }> {
    try {
        // Cheap preflight so the user gets instant feedback on dead selections;
        // the worker re-checks all of this.
        const { data: list, error: listErr } = await supabase
            .from("contact_lists")
            .select("id, client_id, column_mapping, archived_at")
            .eq("id", listId)
            .single();
        if (listErr || !list) return { success: false, error: "List not found" };
        if (list.archived_at) {
            return { success: false, error: "Cannot enroll an archived list" };
        }
        if (!Object.values((list.column_mapping || {}) as Record<string, string>).includes("phone")) {
            return {
                success: false,
                error: "List has no phone column mapping. Edit the list mapping before enrolling.",
            };
        }
        const { data: sequence } = await supabase
            .from("sequences")
            .select("id")
            .eq("id", sequenceId)
            .single();
        if (!sequence) return { success: false, error: "Sequence not found" };

        const { data, error } = await supabase
            .from("import_jobs")
            .insert({
                client_id: list.client_id,
                kind: "list_enroll",
                payload: { listId, sequenceId, isTest: options?.isTest === true },
            })
            .select("id")
            .single();
        if (error || !data) {
            return { success: false, error: error?.message || "Failed to queue enrollment" };
        }
        return { success: true, data: { jobId: data.id as string } };
    } catch (e: any) {
        console.error("startListEnrollJob error:", e);
        return { success: false, error: e?.message || "Internal error" };
    }
}

// Poll one job. The UI calls this every ~1.5s while a progress modal is open.
export async function getImportJobStatus(jobId: string): Promise<{
    success: boolean;
    error?: string;
    data?: ImportJobStatus;
}> {
    try {
        const { data, error } = await supabase
            .from("import_jobs")
            .select("*")
            .eq("id", jobId)
            .single();
        if (error || !data) return { success: false, error: "Job not found" };
        return { success: true, data: toStatus(data) };
    } catch (e: any) {
        return { success: false, error: e?.message || "Internal error" };
    }
}

// Jobs still running (or finished in the last 5 minutes) for the banner on
// the Contacts pages, so a user who closed the tab mid-import can still see
// where their upload got to.
export async function listActiveImportJobs(clientId: string): Promise<{
    success: boolean;
    error?: string;
    data: ImportJobStatus[];
}> {
    try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
        const { data, error } = await supabase
            .from("import_jobs")
            .select("*")
            .eq("client_id", clientId)
            .or(`status.in.(pending,processing),finished_at.gte.${fiveMinAgo}`)
            .order("created_at", { ascending: false })
            .limit(10);
        if (error) return { success: false, error: error.message, data: [] };
        return { success: true, data: (data || []).map(toStatus) };
    } catch (e: any) {
        return { success: false, error: e?.message || "Internal error", data: [] };
    }
}
