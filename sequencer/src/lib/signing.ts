import crypto from 'crypto';

/**
 * HMAC signing for outward-facing URLs and timing-safe token compares.
 *
 * Used by email click-tracking: the redirect target is signed when the
 * email is rendered and verified at click time, so the tracking domain
 * cannot be used as an open redirector (review server I5).
 */

function signingSecret(): string {
    const secret = process.env.TRACKING_SIGNING_SECRET || process.env.ENCRYPTION_KEY;
    if (!secret) {
        throw new Error('TRACKING_SIGNING_SECRET or ENCRYPTION_KEY must be set for URL signing');
    }
    return secret;
}

export function signUrl(url: string): string {
    return crypto.createHmac('sha256', signingSecret()).update(url).digest('hex').slice(0, 32);
}

export function verifySignedUrl(url: string, signature: string | undefined): boolean {
    if (!signature) return false;
    return timingSafeEqualStr(signUrl(url), signature);
}

/** Constant-time string comparison for secrets/tokens. */
export function timingSafeEqualStr(a: string | undefined, b: string | undefined): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
