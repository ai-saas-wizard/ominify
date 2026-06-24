import "server-only";
import { supabase } from "@/lib/supabase";
import { parsePhoneNumberFromString } from "libphonenumber-js";

// Normalize phone input to E.164 (matches toE164 in sequence-actions.ts).
function toE164(raw: string, defaultCountry: "US" = "US"): string | null {
    if (!raw) return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    return parsed && parsed.isValid() ? parsed.number : null;
}

export interface ResolveContactInput {
    contactId?: string;
    phone?: string;
    name?: string;
    email?: string;
}

/**
 * Resolve an enrollable contact: use contactId if given, else find-or-create by
 * phone (normalized to E.164). Lets the MCP enroll "this lead" by phone without
 * the caller first knowing an internal contact id.
 */
export async function resolveOrCreateContact(
    clientId: string,
    input: ResolveContactInput
): Promise<{ contactId?: string; created?: boolean; error?: string }> {
    if (input.contactId) return { contactId: input.contactId };
    if (!input.phone) return { error: "Provide either contactId or phone" };

    const phone = toE164(input.phone);
    if (!phone) return { error: `Invalid phone number: ${input.phone}` };

    const { data: existing } = await supabase
        .from("contacts")
        .select("id")
        .eq("client_id", clientId)
        .eq("phone", phone)
        .maybeSingle();

    if (existing) return { contactId: existing.id, created: false };

    const { data: created, error } = await supabase
        .from("contacts")
        .insert({
            client_id: clientId,
            phone,
            name: input.name || null,
            email: input.email || null,
        })
        .select("id")
        .single();

    if (error) return { error: error.message };
    return { contactId: created?.id, created: true };
}
