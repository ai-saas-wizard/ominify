import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment
 * Must be 32 bytes (64 hex characters)
 */
function getEncryptionKey(): Buffer {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns: iv:authTag:ciphertext (all base64)
 */
export function encrypt(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

// Output of encrypt(): three base64 segments joined by colons.
const ENCRYPTED_SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

/**
 * Decrypt a string encrypted with encrypt().
 * Tolerates legacy plaintext rows (returns as-is) so the sequencer doesn't
 * crash on rows written before the encryption rollout — mirrors
 * src/lib/encryption-helpers.ts:safeDecrypt on the Vercel side.
 */
export function decrypt(encryptedData: string): string {
    if (!ENCRYPTED_SHAPE.test(encryptedData)) {
        // Looks like plaintext — return as-is. Caller treats this the same
        // way Vercel's safeDecrypt does: an unencrypted legacy value is
        // passed through to the API consumer.
        return encryptedData;
    }

    const key = getEncryptionKey();

    const parts = encryptedData.split(':');
    const [ivBase64, authTagBase64, ciphertext] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Generate a new random encryption key (for setup)
 */
export function generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a value (for non-reversible operations like API key fingerprints)
 */
export function hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
