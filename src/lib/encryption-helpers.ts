import "server-only";
import { encrypt, decrypt } from "@/lib/encryption";

// Ciphertext shape emitted by encrypt(): "ivBase64:authTagBase64:ciphertextBase64"
// Three base64 segments joined by colons.
const ENCRYPTED_SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

/**
 * Returns true if the value looks like output from encrypt().
 * Used to tell legacy plaintext rows apart from encrypted rows during migration.
 */
export function isEncrypted(value: string | null | undefined): boolean {
    return !!value && ENCRYPTED_SHAPE.test(value);
}

/**
 * Decrypt a column value, tolerating legacy plaintext rows.
 *
 * - null/undefined → null
 * - plaintext (legacy row) → returned as-is
 * - valid ciphertext → decrypted plaintext
 * - corrupted ciphertext → null (do not throw; callers treat as missing)
 *
 * Once the encryption migration script has run against all rows and the
 * overlap window is over, this should be replaced with a strict decrypt().
 */
export function safeDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!isEncrypted(value)) return value;
    try {
        return decrypt(value);
    } catch {
        return null;
    }
}

/**
 * Encrypt a value, or return null if the input is falsy.
 * Convenience wrapper so callers don't have to guard every insert.
 */
export function encryptOrNull(value: string | null | undefined): string | null {
    if (!value) return null;
    return encrypt(value);
}

/**
 * Return the last N characters of a secret without ever exposing the whole thing.
 * Used to display masked key previews (e.g. "••••last4") in admin UIs.
 * Safe to pass ciphertext — will decrypt first.
 */
export function secretLastChars(value: string | null | undefined, n = 4): string | null {
    const plaintext = safeDecrypt(value);
    if (!plaintext || plaintext.length < n) return null;
    return plaintext.slice(-n);
}
