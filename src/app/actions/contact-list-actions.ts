"use server";

import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import {
    upsertContactsFromRows,
    registerCustomFields,
    type ColumnRole,
    type UpsertedRow,
} from "@/app/actions/_helpers/contact-import";
import {
    CONTACT_IMPORTS_BUCKET,
    buildContactImportPath,
    deleteContactImportCsv,
    downloadContactImportCsv,
} from "@/app/actions/_helpers/contact-import-storage";
import { assignTagsToContacts } from "@/app/actions/contact-tag-actions";
import { enrollListInSequence } from "@/app/actions/sequence-actions";
import { MAX_IMPORT_ROWS } from "@/components/contacts/import/import-limits";

// Drop a CSV from the contact-imports bucket. Called from the wizard when
// the user replaces or clears their selected file so the previous upload
// doesn't orphan in Storage. Best-effort: never throws.
export async function deleteContactImportUpload(storagePath: string): Promise<{
    success: boolean;
}> {
    if (!storagePath) return { success: true };
    await deleteContactImportCsv(storagePath);
    return { success: true };
}

// Mints a pre-signed upload token so the browser can PUT a CSV directly to
// Supabase Storage, bypassing Vercel's 4.5 MB serverless body limit. The
// returned `storagePath` is then passed back to createListFromImport /
// importContactsWithoutList at submit time.
export async function getContactImportUploadUrl(
    clientId: string,
    fileName: string,
): Promise<{
    success: boolean;
    error?: string;
    data?: { storagePath: string; token: string };
}> {
    if (!clientId) return { success: false, error: "Missing clientId" };
    if (!fileName) return { success: false, error: "Missing fileName" };

    const storagePath = buildContactImportPath(clientId, fileName);

    const { data, error } = await supabase.storage
        .from(CONTACT_IMPORTS_BUCKET)
        .createSignedUploadUrl(storagePath);

    if (error || !data) {
        return { success: false, error: error?.message || "Failed to mint upload URL" };
    }

    return { success: true, data: { storagePath, token: data.token } };
}

// Same batching strategy used in _helpers/contact-import.ts. Avoids a single
// PostgREST request that bloats with `source_row` JSONB on large imports.
const MEMBERS_BATCH_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// Parse a CSV downloaded from Storage into the same row+column shape the
// browser produced. Pure wrapper around papaparse — keeps the parsing details
// out of the action body.
function parseCsvText(
    text: string,
): { columns: string[]; rows: Record<string, string>[]; error?: string } {
    const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
    });
    if (result.errors.length > 0) {
        return { columns: [], rows: [], error: `CSV parse error: ${result.errors[0].message}` };
    }
    const columns = result.meta.fields || [];
    const rows = (result.data as Record<string, string>[]).filter((r) =>
        Object.values(r).some((v) => (v || "").trim()),
    );
    return { columns, rows };
}

interface CreateListInput {
    clientId: string;
    listName: string;
    description?: string;
    sourceFilename?: string;
    storagePath: string;
    columnMapping: Record<string, ColumnRole>;
    customFieldDescriptions?: Record<string, { description: string; dirty: boolean }>;
    tagIds?: string[];
    enrollIntoSequenceId?: string;
}

// Create a new contact list from a CSV-style row set. Upserts all contacts,
// registers any new custom fields (with descriptions when provided), then
// inserts the list + members. Optionally tags and enrolls into a sequence
// in the same call so the verify step is one server round-trip.
export async function createListFromImport(input: CreateListInput): Promise<{
    success: boolean;
    error?: string;
    data?: {
        listId: string;
        contactsCreated: number;
        contactsUpdated: number;
        errors: string[];
        enrolledCount?: number;
    };
}> {
    try {
        const {
            clientId,
            listName,
            description,
            sourceFilename,
            storagePath,
            columnMapping,
            customFieldDescriptions = {},
            tagIds = [],
            enrollIntoSequenceId,
        } = input;

        if (!listName?.trim()) {
            return { success: false, error: "List name is required" };
        }
        if (!storagePath) {
            return { success: false, error: "Missing uploaded CSV reference" };
        }
        if (!Object.values(columnMapping).includes("phone")) {
            return { success: false, error: "A phone column mapping is required" };
        }

        const downloaded = await downloadContactImportCsv(storagePath);
        if (!downloaded.success || !downloaded.text) {
            return { success: false, error: downloaded.error || "Failed to download CSV" };
        }
        const parsed = parseCsvText(downloaded.text);
        if (parsed.error) return { success: false, error: parsed.error };
        const csvRows = parsed.rows;
        if (csvRows.length === 0) {
            return { success: false, error: "No rows to import" };
        }
        if (csvRows.length > MAX_IMPORT_ROWS) {
            return {
                success: false,
                error: `Import limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows per file. Please split your list.`,
            };
        }

        await registerCustomFields(clientId, columnMapping, customFieldDescriptions);

        const upsertResult = await upsertContactsFromRows(clientId, csvRows, columnMapping);

        // Insert the list row.
        const { data: listRow, error: listErr } = await supabase
            .from("contact_lists")
            .insert({
                client_id: clientId,
                name: listName.trim(),
                description: description?.trim() || null,
                source: "csv",
                source_filename: sourceFilename || null,
                column_mapping: columnMapping,
                contact_count: 0,
            })
            .select("id")
            .single();

        if (listErr || !listRow) {
            return {
                success: false,
                error: listErr?.message || "Failed to create list",
            };
        }
        const listId = listRow.id as string;

        // Insert members in batched upserts, preserving each row's verbatim CSV
        // row for later replay during sequence enrollment. Batching is required
        // because `source_row` JSONB can be multi-KB per row — a single 10k-row
        // upsert would blow PostgREST's request size limit.
        if (upsertResult.upserted.length > 0) {
            const memberRows = upsertResult.upserted.map((u) => ({
                list_id: listId,
                contact_id: u.contactId,
                source_row: u.sourceRow,
                added_via: "csv",
            }));

            for (const batch of chunk(memberRows, MEMBERS_BATCH_SIZE)) {
                const { error: membersErr } = await supabase
                    .from("contact_list_members")
                    .upsert(batch, { onConflict: "list_id,contact_id" });

                if (membersErr) {
                    return {
                        success: false,
                        error: `List created but members failed: ${membersErr.message}`,
                    };
                }
            }

            await supabase
                .from("contact_lists")
                .update({ contact_count: upsertResult.upserted.length, updated_at: new Date().toISOString() })
                .eq("id", listId);
        }

        // Optional: tag every contact in this import with the picked tags.
        if (tagIds.length > 0 && upsertResult.upserted.length > 0) {
            const contactIds = upsertResult.upserted.map((u) => u.contactId);
            await assignTagsToContacts(tagIds, contactIds);
        }

        // Optional: auto-enroll the new list into a sequence.
        let enrolledCount: number | undefined;
        if (enrollIntoSequenceId && upsertResult.upserted.length > 0) {
            const enrollResult = await enrollListInSequence(enrollIntoSequenceId, listId);
            if (enrollResult.success && enrollResult.data) {
                enrolledCount = enrollResult.data.enrolled;
                upsertResult.errors.push(...enrollResult.data.errors);
            } else if (enrollResult.error) {
                upsertResult.errors.push(`Auto-enroll failed: ${enrollResult.error}`);
            }
        }

        revalidatePath(`/client/${clientId}/contacts`);
        revalidatePath(`/client/${clientId}/contacts/lists`);

        // Best-effort: drop the uploaded CSV now that it's been imported.
        await deleteContactImportCsv(storagePath);

        return {
            success: true,
            data: {
                listId,
                contactsCreated: upsertResult.contactsCreated,
                contactsUpdated: upsertResult.contactsUpdated,
                errors: upsertResult.errors,
                enrolledCount,
            },
        };
    } catch (e: any) {
        console.error("createListFromImport error:", e);
        return { success: false, error: e?.message || "Internal error" };
    }
}

// Standalone import: upsert contacts from a CSV without creating a list. Used
// when the user toggles "Create a list" off in the verify step.
export async function importContactsWithoutList(input: Omit<CreateListInput, "listName">): Promise<{
    success: boolean;
    error?: string;
    data?: { contactsCreated: number; contactsUpdated: number; errors: string[]; enrolledCount?: number };
}> {
    try {
        const {
            clientId,
            storagePath,
            columnMapping,
            customFieldDescriptions = {},
            tagIds = [],
            enrollIntoSequenceId,
        } = input;
        if (!storagePath) {
            return { success: false, error: "Missing uploaded CSV reference" };
        }
        if (!Object.values(columnMapping).includes("phone")) {
            return { success: false, error: "A phone column mapping is required" };
        }

        const downloaded = await downloadContactImportCsv(storagePath);
        if (!downloaded.success || !downloaded.text) {
            return { success: false, error: downloaded.error || "Failed to download CSV" };
        }
        const parsed = parseCsvText(downloaded.text);
        if (parsed.error) return { success: false, error: parsed.error };
        const csvRows = parsed.rows;
        if (csvRows.length === 0) {
            return { success: false, error: "No rows to import" };
        }
        if (csvRows.length > MAX_IMPORT_ROWS) {
            return {
                success: false,
                error: `Import limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows per file. Please split your list.`,
            };
        }

        await registerCustomFields(clientId, columnMapping, customFieldDescriptions);
        const upsertResult = await upsertContactsFromRows(clientId, csvRows, columnMapping);

        if (tagIds.length > 0 && upsertResult.upserted.length > 0) {
            const contactIds = upsertResult.upserted.map((u: UpsertedRow) => u.contactId);
            await assignTagsToContacts(tagIds, contactIds);
        }

        let enrolledCount: number | undefined;
        if (enrollIntoSequenceId && upsertResult.upserted.length > 0) {
            // Without a list, fall back to bulkEnrollFromCSV so the rows still flow
            // through the normal pacing path.
            const { bulkEnrollFromCSV } = await import("@/app/actions/sequence-actions");
            const r = await bulkEnrollFromCSV(
                enrollIntoSequenceId,
                clientId,
                csvRows,
                columnMapping,
            );
            if (r.success && r.data) {
                enrolledCount = r.data.enrolled;
                upsertResult.errors.push(...r.data.errors);
            } else if (r.error) {
                upsertResult.errors.push(`Auto-enroll failed: ${r.error}`);
            }
        }

        revalidatePath(`/client/${clientId}/contacts`);

        // Best-effort: drop the uploaded CSV now that it's been imported.
        await deleteContactImportCsv(storagePath);

        return {
            success: true,
            data: {
                contactsCreated: upsertResult.contactsCreated,
                contactsUpdated: upsertResult.contactsUpdated,
                errors: upsertResult.errors,
                enrolledCount,
            },
        };
    } catch (e: any) {
        console.error("importContactsWithoutList error:", e);
        return { success: false, error: e?.message || "Internal error" };
    }
}

export async function listContactLists(
    clientId: string,
    opts?: { includeArchived?: boolean },
) {
    try {
        let q = supabase
            .from("contact_lists")
            .select("id, name, description, source, source_filename, contact_count, archived_at, created_at, updated_at")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false });

        if (!opts?.includeArchived) q = q.is("archived_at", null);

        const { data, error } = await q;
        if (error) return { success: false, error: error.message, data: [] };
        return { success: true, data: data || [] };
    } catch (e: any) {
        return { success: false, error: e?.message, data: [] };
    }
}

export async function getContactList(listId: string) {
    try {
        const { data, error } = await supabase
            .from("contact_lists")
            .select("*")
            .eq("id", listId)
            .single();
        if (error) return { success: false, error: error.message, data: null };
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e?.message, data: null };
    }
}

export async function getListMembers(
    listId: string,
    params?: { limit?: number; offset?: number; search?: string },
) {
    try {
        const limit = params?.limit ?? 50;
        const offset = params?.offset ?? 0;

        let q = supabase
            .from("contact_list_members")
            .select(
                "contact_id, added_at, source_row, contacts(id, name, phone, email, custom_fields, total_calls, last_call_at, created_at)",
                { count: "exact" },
            )
            .eq("list_id", listId)
            .order("added_at", { ascending: false })
            .range(offset, offset + limit - 1);

        const { data, error, count } = await q;
        if (error) return { success: false, error: error.message, data: { rows: [], total: 0 } };

        const rows = (data || []).map((m: any) => ({
            ...m.contacts,
            source_row: m.source_row,
            added_at: m.added_at,
        }));
        return { success: true, data: { rows, total: count || 0 } };
    } catch (e: any) {
        return { success: false, error: e?.message, data: { rows: [], total: 0 } };
    }
}

export async function archiveContactList(listId: string) {
    try {
        const { data: list } = await supabase
            .from("contact_lists")
            .select("client_id")
            .eq("id", listId)
            .single();
        const { error } = await supabase
            .from("contact_lists")
            .update({ archived_at: new Date().toISOString() })
            .eq("id", listId);
        if (error) return { success: false, error: error.message };
        if (list?.client_id) revalidatePath(`/client/${list.client_id}/contacts/lists`);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function restoreContactList(listId: string) {
    try {
        const { data: list } = await supabase
            .from("contact_lists")
            .select("client_id")
            .eq("id", listId)
            .single();
        const { error } = await supabase
            .from("contact_lists")
            .update({ archived_at: null })
            .eq("id", listId);
        if (error) return { success: false, error: error.message };
        if (list?.client_id) revalidatePath(`/client/${list.client_id}/contacts/lists`);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function renameContactList(
    listId: string,
    name: string,
    description?: string,
) {
    try {
        const { data: list } = await supabase
            .from("contact_lists")
            .select("client_id")
            .eq("id", listId)
            .single();
        const { error } = await supabase
            .from("contact_lists")
            .update({
                name: name.trim(),
                description: description?.trim() || null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", listId);
        if (error) return { success: false, error: error.message };
        if (list?.client_id) revalidatePath(`/client/${list.client_id}/contacts/lists`);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function addContactsToList(listId: string, contactIds: string[]) {
    try {
        if (contactIds.length === 0) return { success: true, data: { added: 0, alreadyMember: 0 } };

        const rows = contactIds.map((cid) => ({
            list_id: listId,
            contact_id: cid,
            added_via: "manual",
        }));

        const { data: existing } = await supabase
            .from("contact_list_members")
            .select("contact_id")
            .eq("list_id", listId)
            .in("contact_id", contactIds);

        const existingSet = new Set((existing || []).map((r: any) => r.contact_id));
        const alreadyMember = existingSet.size;
        const added = contactIds.length - alreadyMember;

        const { error } = await supabase
            .from("contact_list_members")
            .upsert(rows, { onConflict: "list_id,contact_id" });
        if (error) return { success: false, error: error.message };

        // Recompute count.
        const { count } = await supabase
            .from("contact_list_members")
            .select("contact_id", { count: "exact", head: true })
            .eq("list_id", listId);
        await supabase
            .from("contact_lists")
            .update({ contact_count: count || 0, updated_at: new Date().toISOString() })
            .eq("id", listId);

        const { data: list } = await supabase
            .from("contact_lists")
            .select("client_id")
            .eq("id", listId)
            .single();
        if (list?.client_id) {
            revalidatePath(`/client/${list.client_id}/contacts/lists`);
            revalidatePath(`/client/${list.client_id}/contacts/lists/${listId}`);
        }

        return { success: true, data: { added, alreadyMember } };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function removeContactsFromList(listId: string, contactIds: string[]) {
    try {
        if (contactIds.length === 0) return { success: true, data: { removed: 0 } };

        const { data: list } = await supabase
            .from("contact_lists")
            .select("client_id")
            .eq("id", listId)
            .single();

        const { error, count } = await supabase
            .from("contact_list_members")
            .delete({ count: "exact" })
            .eq("list_id", listId)
            .in("contact_id", contactIds);
        if (error) return { success: false, error: error.message };

        const { count: newCount } = await supabase
            .from("contact_list_members")
            .select("contact_id", { count: "exact", head: true })
            .eq("list_id", listId);
        await supabase
            .from("contact_lists")
            .update({ contact_count: newCount || 0, updated_at: new Date().toISOString() })
            .eq("id", listId);

        if (list?.client_id) {
            revalidatePath(`/client/${list.client_id}/contacts/lists`);
            revalidatePath(`/client/${list.client_id}/contacts/lists/${listId}`);
        }

        return { success: true, data: { removed: count || 0 } };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}
