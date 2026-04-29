/**
 * Format a phone number for spoken digit-by-digit reading.
 * "6158634486" → "6-1-5-8-6-3-4-4-8-6"
 */
export function formatPhoneForSpeech(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    return digits.split("").join("-");
}
