"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function listContactTags(clientId: string) {
    try {
        const { data, error } = await supabase
            .from("contact_tags")
            .select("id, name, color, created_at")
            .eq("client_id", clientId)
            .order("name", { ascending: true });
        if (error) return { success: false, error: error.message, data: [] };
        return { success: true, data: data || [] };
    } catch (e: any) {
        return { success: false, error: e?.message, data: [] };
    }
}

export async function createContactTag(clientId: string, name: string, color?: string) {
    try {
        if (!name.trim()) return { success: false, error: "Tag name required" };

        const { data, error } = await supabase
            .from("contact_tags")
            .insert({
                client_id: clientId,
                name: name.trim(),
                color: color || null,
            })
            .select("id, name, color")
            .single();

        if (error) {
            // Surface duplicate name as a specific error.
            if (error.message?.includes("uq_contact_tags_client_name")) {
                return { success: false, error: "A tag with this name already exists" };
            }
            return { success: false, error: error.message };
        }
        revalidatePath(`/client/${clientId}/contacts`);
        return { success: true, data };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function deleteContactTag(tagId: string) {
    try {
        const { data: tag } = await supabase
            .from("contact_tags")
            .select("client_id")
            .eq("id", tagId)
            .single();
        const { error } = await supabase.from("contact_tags").delete().eq("id", tagId);
        if (error) return { success: false, error: error.message };
        if (tag?.client_id) revalidatePath(`/client/${tag.client_id}/contacts`);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function assignTagsToContacts(tagIds: string[], contactIds: string[]) {
    try {
        if (tagIds.length === 0 || contactIds.length === 0) {
            return { success: true, data: { assigned: 0 } };
        }
        const rows: { contact_id: string; tag_id: string }[] = [];
        for (const cid of contactIds) {
            for (const tid of tagIds) {
                rows.push({ contact_id: cid, tag_id: tid });
            }
        }
        const { error } = await supabase
            .from("contact_tag_assignments")
            .upsert(rows, { onConflict: "contact_id,tag_id" });
        if (error) return { success: false, error: error.message };
        return { success: true, data: { assigned: rows.length } };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

export async function removeTagsFromContacts(tagIds: string[], contactIds: string[]) {
    try {
        if (tagIds.length === 0 || contactIds.length === 0) {
            return { success: true, data: { removed: 0 } };
        }
        const { error, count } = await supabase
            .from("contact_tag_assignments")
            .delete({ count: "exact" })
            .in("tag_id", tagIds)
            .in("contact_id", contactIds);
        if (error) return { success: false, error: error.message };
        return { success: true, data: { removed: count || 0 } };
    } catch (e: any) {
        return { success: false, error: e?.message };
    }
}

// Get tags for a single contact (used in detail panels).
export async function getTagsForContact(contactId: string) {
    try {
        const { data, error } = await supabase
            .from("contact_tag_assignments")
            .select("tag_id, contact_tags(id, name, color)")
            .eq("contact_id", contactId);
        if (error) return { success: false, error: error.message, data: [] };
        const tags = (data || [])
            .map((r: any) => r.contact_tags)
            .filter((t: any) => t);
        return { success: true, data: tags };
    } catch (e: any) {
        return { success: false, error: e?.message, data: [] };
    }
}

// Get tags for many contacts at once. Returns map: contactId → tags[].
export async function getTagsForContacts(contactIds: string[]) {
    try {
        if (contactIds.length === 0) return { success: true, data: {} as Record<string, any[]> };
        const { data, error } = await supabase
            .from("contact_tag_assignments")
            .select("contact_id, tag_id, contact_tags(id, name, color)")
            .in("contact_id", contactIds);
        if (error) return { success: false, error: error.message, data: {} };
        const map: Record<string, any[]> = {};
        for (const r of data || []) {
            const cid = (r as any).contact_id;
            const tag = (r as any).contact_tags;
            if (!tag) continue;
            if (!map[cid]) map[cid] = [];
            map[cid].push(tag);
        }
        return { success: true, data: map };
    } catch (e: any) {
        return { success: false, error: e?.message, data: {} };
    }
}
