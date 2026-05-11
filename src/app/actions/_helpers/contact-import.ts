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

// Batch size for the bulk UPSERT chunks. Keeps each round-trip well under
// PostgREST's request size limits while amortising network latency across
// hundreds of rows. 500 was empirically the sweet spot — larger batches saw
// diminishing returns and risked PostgREST 413s.
const UPSERT_BATCH_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// Upsert contacts from CSV-style rows. Pure contact-side logic — no sequences,
// no enrollments. Dedupes by E.164 phone in-memory before DB writes (so a CSV
// with a duplicate phone resolves to one upsert, second occurrence wins).
//
// Performance notes:
//   - Existing contacts are fetched with ONE bulk SELECT (.in("phone", [...])).
//   - Inserts/updates run as batched UPSERTs (500 rows / round-trip) on the
//     (client_id, phone) unique index defined in supabase/contacts-schema.sql.
//   - This collapses what used to be 2N sequential round-trips into ~2 + N/500.
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

    // Phase 1: parse + normalise + in-memory dedupe.
    interface PreparedRow {
        phone: string;
        rowIndex: number;
        row: Record<string, string>;
        name: string | null;
        email: string;
        customFields: Record<string, string>;
        customVariables: Record<string, string>;
        sourceRow: Record<string, string>;
    }
    const dedupedByPhone = new Map<string, PreparedRow>();
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowIndex = i + 1;
        const rawPhone =
            (roleToColumns.phone || []).map((col) => row[col]?.trim()).find((v) => v) || "";
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
            (roleToColumns.email || []).map((col) => row[col]?.trim()).find((v) => v) || "";
        const firstName =
            (roleToColumns.first_name || []).map((col) => row[col]?.trim()).find((v) => v) || "";
        const lastName =
            (roleToColumns.last_name || []).map((col) => row[col]?.trim()).find((v) => v) || "";
        const company =
            (roleToColumns.company || []).map((col) => row[col]?.trim()).find((v) => v) || "";
        const nameParts = [firstName, lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(" ") : null;

        // Anti-cold-outreach: every row must have a name. Phone alone (or
        // phone + email) is not enough. This matches the Mapping step's
        // requirement that one of first_name/last_name be mapped.
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
            if (role !== "skip" && row[col]?.trim()) {
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
            row,
            name,
            email,
            customFields,
            customVariables,
            sourceRow,
        });
    }

    if (dedupedByPhone.size === 0) {
        return { upserted, errors, contactsCreated, contactsUpdated };
    }

    // Phase 2: ONE bulk SELECT to find every existing contact by phone.
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

    for (const batch of chunk(phones, 1000)) {
        const { data, error } = await supabase
            .from("contacts")
            .select("id, phone, name, email, custom_fields, opted_out_at")
            .eq("client_id", clientId)
            .in("phone", batch);
        if (error) {
            errors.push(`Failed to look up existing contacts: ${error.message}`);
            return { upserted, errors, contactsCreated, contactsUpdated };
        }
        for (const r of (data || []) as ExistingContact[]) existingByPhone.set(r.phone, r);
    }

    // Phase 3: build upsert payloads. Skip opted-out contacts entirely.
    interface UpsertPayload {
        client_id: string;
        phone: string;
        name: string | null;
        email: string | null;
        custom_fields: Record<string, unknown>;
        total_calls?: number;
    }
    const toUpsert: UpsertPayload[] = [];
    const willCreate: PreparedRow[] = [];
    const willUpdate: PreparedRow[] = [];

    for (const prepared of dedupedByPhone.values()) {
        const existing = existingByPhone.get(prepared.phone);

        if (existing?.opted_out_at) {
            errors.push(
                `Row ${prepared.rowIndex}: Contact (${prepared.phone}) is opted out — skipped.`,
            );
            continue;
        }

        if (existing) {
            // Merge: new non-empty wins, otherwise preserve existing.
            const mergedName = prepared.name || existing.name || null;
            const mergedEmail = prepared.email || existing.email || null;
            const mergedCustom = {
                ...(existing.custom_fields || {}),
                ...prepared.customFields,
            };
            toUpsert.push({
                client_id: clientId,
                phone: prepared.phone,
                name: mergedName,
                email: mergedEmail,
                custom_fields: mergedCustom,
            });
            willUpdate.push(prepared);
        } else {
            toUpsert.push({
                client_id: clientId,
                phone: prepared.phone,
                name: prepared.name,
                email: prepared.email || null,
                custom_fields: prepared.customFields,
                total_calls: 0,
            });
            willCreate.push(prepared);
        }
    }

    // Phase 4: batched UPSERT keyed on the (client_id, phone) unique index.
    // We need the inserted/updated ids back so we can build the UpsertedRow
    // results — onConflict + .select() returns ids for both branches.
    const idByPhone = new Map<string, string>();
    for (const batch of chunk(toUpsert, UPSERT_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("contacts")
            .upsert(batch, { onConflict: "client_id,phone" })
            .select("id, phone");
        if (error) {
            errors.push(`Bulk upsert failed: ${error.message}`);
            return { upserted, errors, contactsCreated, contactsUpdated };
        }
        for (const r of data || []) idByPhone.set(r.phone as string, r.id as string);
    }

    // Phase 5: assemble result rows, in original CSV order.
    contactsCreated = willCreate.length;
    contactsUpdated = willUpdate.length;

    const ordered = [...dedupedByPhone.values()].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const prepared of ordered) {
        const contactId = idByPhone.get(prepared.phone);
        if (!contactId) continue; // opted-out or upsert failure
        upserted.push({
            contactId,
            rowIndex: prepared.rowIndex,
            customVariables: prepared.customVariables,
            sourceRow: prepared.sourceRow,
            phone: prepared.phone,
            name: prepared.name,
            email: prepared.email || null,
        });
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
