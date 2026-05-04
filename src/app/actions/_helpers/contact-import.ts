// Shared helpers for CSV-driven contact import flows.
// Used by:
//   - bulkEnrollFromCSV (sequence-actions.ts) — task dialog enrollment
//   - createListFromImport (contact-list-actions.ts) — Imports wizard
//   - enrollListInSequence (sequence-actions.ts) — re-enrolling a saved list
//
// These helpers are pure contact-side logic; they do not know about sequences
// or enrollments. The enrollment loop stays in sequence-actions.ts.

import { supabase } from "@/lib/supabase";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export type ColumnRole =
    | "phone"
    | "email"
    | "first_name"
    | "last_name"
    | "company"
    | "custom_variable"
    | "skip";

export interface UpsertedRow {
    contactId: string;
    rowIndex: number;
    customVariables: Record<string, string>;
    sourceRow: Record<string, string>;
    phone: string;
    name: string | null;
    email: string | null;
}

export interface UpsertResult {
    upserted: UpsertedRow[];
    errors: string[];
    contactsCreated: number;
    contactsUpdated: number;
}

export function toE164(raw: string, defaultCountry: "US" = "US"): string | null {
    if (!raw) return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    return parsed && parsed.isValid() ? parsed.number : null;
}

function buildRoleToColumns(columnMapping: Record<string, ColumnRole>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [col, role] of Object.entries(columnMapping)) {
        if (!out[role]) out[role] = [];
        out[role].push(col);
    }
    return out;
}

// Upsert contacts from CSV-style rows. Pure contact-side logic — no sequences,
// no enrollments. Dedupes by E.164 phone in-memory before DB writes (so a CSV
// with a duplicate phone resolves to one upsert, second occurrence wins).
//
// Merge policy on existing contacts:
//   - NEW non-empty values win (name, email, custom_field values).
//   - OLD values preserved when incoming is empty/missing.
// Opted-out contacts are returned in `errors` and excluded from `upserted`.
export async function upsertContactsFromRows(
    clientId: string,
    rows: Record<string, string>[],
    columnMapping: Record<string, ColumnRole>,
): Promise<UpsertResult> {
    const errors: string[] = [];
    const upserted: UpsertedRow[] = [];
    let contactsCreated = 0;
    let contactsUpdated = 0;

    if (!rows || rows.length === 0) {
        return { upserted, errors, contactsCreated, contactsUpdated };
    }

    const hasPhone = Object.values(columnMapping).includes("phone");
    if (!hasPhone) {
        errors.push("A phone column mapping is required.");
        return { upserted, errors, contactsCreated, contactsUpdated };
    }

    const roleToColumns = buildRoleToColumns(columnMapping);

    // In-memory dedupe: if a CSV has the same phone twice, keep the LAST occurrence.
    const dedupedByPhone = new Map<string, { row: Record<string, string>; rowIndex: number }>();
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowIndex = i + 1;
        const rawPhone = (roleToColumns.phone || [])
            .map((col) => row[col]?.trim())
            .find((v) => v) || "";
        const phone = toE164(rawPhone);
        if (rawPhone && !phone) {
            errors.push(`Row ${rowIndex}: Invalid phone number "${rawPhone}"`);
            continue;
        }
        if (!phone) {
            errors.push(`Row ${rowIndex}: Missing phone number`);
            continue;
        }
        dedupedByPhone.set(phone, { row, rowIndex });
    }

    for (const [phone, { row, rowIndex }] of dedupedByPhone) {
        try {
            const email = (roleToColumns.email || [])
                .map((col) => row[col]?.trim())
                .find((v) => v) || "";
            const firstName = (roleToColumns.first_name || [])
                .map((col) => row[col]?.trim())
                .find((v) => v) || "";
            const lastName = (roleToColumns.last_name || [])
                .map((col) => row[col]?.trim())
                .find((v) => v) || "";
            const company = (roleToColumns.company || [])
                .map((col) => row[col]?.trim())
                .find((v) => v) || "";

            const nameParts = [firstName, lastName].filter(Boolean);
            const name = nameParts.length > 0 ? nameParts.join(" ") : null;

            const customFields: Record<string, string> = {};
            if (company) customFields.company = company;
            for (const col of roleToColumns.custom_variable || []) {
                const v = row[col]?.trim();
                if (v) customFields[col] = v;
            }

            const customVariables: Record<string, string> = {};
            for (const [col, role] of Object.entries(columnMapping)) {
                if (role !== "skip" && row[col]?.trim()) {
                    customVariables[col] = row[col].trim();
                }
            }

            // Verbatim CSV row (all original headers preserved) — stored on
            // contact_list_members.source_row so we can replay enrollment vars.
            const sourceRow: Record<string, string> = {};
            for (const [col, val] of Object.entries(row)) {
                if (val !== undefined && val !== null) sourceRow[col] = String(val);
            }

            const { data: existingContact } = await supabase
                .from("contacts")
                .select("id, name, email, custom_fields, opted_out_at")
                .eq("client_id", clientId)
                .eq("phone", phone)
                .maybeSingle();

            if (existingContact?.opted_out_at) {
                errors.push(`Row ${rowIndex}: Contact (${phone}) is opted out — skipped.`);
                continue;
            }

            let contactId: string;
            if (existingContact) {
                contactId = existingContact.id;
                const updateData: Record<string, any> = {};
                if (name) updateData.name = name;
                if (email) updateData.email = email;
                if (Object.keys(customFields).length > 0) {
                    updateData.custom_fields = {
                        ...(existingContact.custom_fields || {}),
                        ...customFields,
                    };
                }
                if (Object.keys(updateData).length > 0) {
                    const { error: updErr } = await supabase
                        .from("contacts")
                        .update(updateData)
                        .eq("id", contactId);
                    if (updErr) {
                        errors.push(`Row ${rowIndex}: Failed to update contact — ${updErr.message}`);
                        continue;
                    }
                    contactsUpdated++;
                }
            } else {
                const { data: newContact, error: insertErr } = await supabase
                    .from("contacts")
                    .insert({
                        client_id: clientId,
                        phone,
                        name: name || null,
                        email: email || null,
                        custom_fields: Object.keys(customFields).length > 0 ? customFields : {},
                        total_calls: 0,
                    })
                    .select("id")
                    .single();
                if (insertErr || !newContact) {
                    errors.push(
                        `Row ${rowIndex}: Failed to create contact — ${insertErr?.message || "unknown error"}`,
                    );
                    continue;
                }
                contactId = newContact.id;
                contactsCreated++;
            }

            upserted.push({
                contactId,
                rowIndex,
                customVariables,
                sourceRow,
                phone,
                name,
                email: email || null,
            });
        } catch (rowError: any) {
            errors.push(`Row ${rowIndex}: ${rowError?.message || "Unknown error"}`);
        }
    }

    return { upserted, errors, contactsCreated, contactsUpdated };
}

// Register custom_field definitions for any column mapped to `custom_variable`.
// - Inserts new contact_fields rows for unknown field_keys.
// - UPDATEs description ONLY when descriptions[col].dirty === true. This avoids
//   overwriting a description that the user previously edited via the contacts
//   UI when they re-import a CSV without re-typing the description.
export async function registerCustomFields(
    clientId: string,
    columnMapping: Record<string, ColumnRole>,
    descriptions: Record<string, { description: string; dirty: boolean }> = {},
): Promise<void> {
    const customCols = Object.entries(columnMapping)
        .filter(([_, role]) => role === "custom_variable")
        .map(([col]) => col);

    if (customCols.length === 0) return;

    // Load existing field defs for these keys.
    const { data: existing } = await supabase
        .from("contact_fields")
        .select("id, field_key, description")
        .eq("client_id", clientId)
        .in("field_key", customCols);

    const existingByKey = new Map(
        (existing || []).map((r: any) => [r.field_key as string, r as { id: string; description: string | null }]),
    );

    const nextOrderQuery = await supabase
        .from("contact_fields")
        .select("display_order")
        .eq("client_id", clientId)
        .order("display_order", { ascending: false })
        .limit(1);
    let nextOrder = (nextOrderQuery.data?.[0]?.display_order ?? -1) + 1;

    for (const col of customCols) {
        const desc = descriptions[col];
        const existingDef = existingByKey.get(col);

        if (!existingDef) {
            const friendlyName = col
                .replace(/[_-]+/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
            await supabase.from("contact_fields").insert({
                client_id: clientId,
                name: friendlyName,
                field_key: col,
                field_type: "text",
                description: desc?.description?.trim() || null,
                display_order: nextOrder++,
            });
        } else if (desc?.dirty) {
            await supabase
                .from("contact_fields")
                .update({ description: desc.description?.trim() || null })
                .eq("id", existingDef.id);
        }
    }
}

// Build a verbatim CSV-like row Record from a contact's core fields.
// Used by enrollListInSequence when a member was added manually (no source_row).
export function syntheticRowFromContact(contact: {
    phone: string;
    name?: string | null;
    email?: string | null;
    custom_fields?: Record<string, any> | null;
}): Record<string, string> {
    const row: Record<string, string> = { phone: contact.phone };
    if (contact.name) {
        const parts = contact.name.split(" ");
        row.first_name = parts[0] || "";
        row.last_name = parts.slice(1).join(" ");
    }
    if (contact.email) row.email = contact.email;
    if (contact.custom_fields) {
        for (const [k, v] of Object.entries(contact.custom_fields)) {
            if (v !== null && v !== undefined) row[k] = String(v);
        }
    }
    return row;
}
