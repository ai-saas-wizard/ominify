import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

/**
 * Phone normalization (review I10). Twilio webhooks deliver E.164; lead
 * sources deliver anything ("(555) 123-4567"). All storage and lookups
 * must go through normalizePhone so replies and STOPs match the stored
 * contact.
 */
export function normalizePhone(
    raw: string | null | undefined,
    defaultCountry: CountryCode = 'US'
): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number; // E.164
}

/**
 * Candidate values to match a phone against legacy rows that were stored
 * un-normalized: the E.164 form plus the raw input.
 */
export function phoneLookupCandidates(raw: string | null | undefined): string[] {
    const candidates = new Set<string>();
    if (raw && typeof raw === 'string' && raw.trim()) candidates.add(raw.trim());
    const normalized = normalizePhone(raw);
    if (normalized) candidates.add(normalized);
    return [...candidates];
}
