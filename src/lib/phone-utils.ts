// Shared E.164 phone helpers built on libphonenumber-js.
// VAPI rejects non-E.164 phone numbers when creating agents / dialing transfers,
// so every phone that flows into a VAPI payload must pass through normalizeToE164.

import {
    parsePhoneNumberFromString,
    type CountryCode,
} from "libphonenumber-js";

export const DEFAULT_PHONE_COUNTRY: CountryCode = "US";

/**
 * Best-effort normalization to E.164 (e.g. "+12125551212").
 * Returns null when the input cannot be parsed into a valid number — callers
 * should treat that as a validation failure and either reject or prompt the user.
 *
 * Accepts any human-typed format: "(212) 555-1212", "212.555.1212",
 * "+1 212 555 1212", "12125551212", etc.
 */
export function normalizeToE164(
    raw: string | null | undefined,
    defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY
): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
    return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * Convenience predicate. Mirrors normalizeToE164's parsing semantics so the
 * two never disagree on what counts as valid.
 */
export function isValidPhone(
    raw: string | null | undefined,
    defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY
): boolean {
    return normalizeToE164(raw, defaultCountry) !== null;
}

/**
 * Pretty national format for UI display (e.g. "(212) 555-1212").
 * Falls back to the original string if parsing fails so we never blank out
 * a field on the user mid-edit.
 */
export function formatPhoneForDisplay(
    raw: string | null | undefined,
    defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY
): string {
    if (!raw) return "";
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    if (!parsed || !parsed.isValid()) return raw;
    return parsed.country === defaultCountry
        ? parsed.formatNational()
        : parsed.formatInternational();
}

/**
 * Server-side guard: normalize or throw. Use at the boundary right before a
 * phone string is handed to VAPI — keeps the failure mode loud and local
 * rather than letting an invalid number reach the VAPI API and surface as
 * a cryptic 400 from their side.
 */
export function assertE164(
    raw: string | null | undefined,
    fieldLabel = "phone number",
    defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY
): string {
    const normalized = normalizeToE164(raw, defaultCountry);
    if (!normalized) {
        throw new Error(
            `Invalid ${fieldLabel}: "${raw ?? ""}" is not a valid phone number. Please enter a valid number including country code (e.g. +1 212 555 1212).`
        );
    }
    return normalized;
}
