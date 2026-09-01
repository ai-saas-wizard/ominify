"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import {
    CONTACT_IMPORTS_BUCKET,
    buildContactImportPath,
    deleteContactImportCsv,
} from "@/app/actions/_helpers/contact-import-storage";

// NOTE: CSV processing (parse, contact upserts, list creation, tags,
// enrollment) no longer happens here. The wizard enqueues an import job via
// startContactImportJob (import-job-actions.ts) and the sequencer's
// import-worker executes it server-side, so imports survive the browser tab
// closing. This file keeps only upload-token minting and list CRUD.

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
// returned `storagePath` is then passed back to startContactImportJob at
// submit time.
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
