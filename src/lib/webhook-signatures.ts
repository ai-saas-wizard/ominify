import "server-only";
import crypto from "crypto";

/**
 * Verify a VAPI webhook authenticity header.
 *
 * Per VAPI docs (https://docs.vapi.ai/server-url/server-authentication), VAPI
 * sends the configured "Server URL Secret" as a PLAIN shared secret using one
 * of two header patterns:
 *
 *   1. Standard:  `Authorization: Bearer <secret>`
 *   2. Legacy:    `X-Vapi-Secret: <secret>`
 *
 * (HMAC-signed headers are supported as a separate "maximum security" mode
 * with a customizable header name — if you enable that in the VAPI dashboard,
 * extend this function with an HMAC branch.)
 *
 * Configure the same secret in both the VAPI dashboard ("Server URL Secret"
 * under Org Settings, phone number, or assistant) and the server's
 * `VAPI_WEBHOOK_SECRET` env var. Comparison is constant-time.
 */
export function verifyVapiSecret(
    authorizationHeader: string | null | undefined,
    secretHeader: string | null | undefined,
    expectedSecret: string | undefined
): boolean {
    if (!expectedSecret) return false;

    // Try both header patterns. Take the first one that's present.
    let presented: string | null = null;
    if (authorizationHeader) {
        const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
        if (m) presented = m[1].trim();
    }
    if (!presented && secretHeader) {
        presented = secretHeader.trim();
    }
    if (!presented) return false;

    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(expectedSecret, "utf8");
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

/**
 * Verify a Twilio webhook signature.
 *
 * Twilio's signing algorithm:
 *   1. Start with the full request URL (including query string, using the
 *      canonical public URL — NOT whatever the proxy rewrote it to).
 *   2. Append each POST parameter as `key + value` in lexicographic order by
 *      key. (Do not add any separators between them.)
 *   3. HMAC-SHA1 the resulting string with the account's auth token.
 *   4. Base64-encode the digest.
 *
 * Twilio sends the expected signature in the `x-twilio-signature` header.
 */
export function verifyTwilioSignature(
    twilioSignatureHeader: string | null | undefined,
    fullUrl: string,
    params: Record<string, string>,
    authToken: string | undefined
): boolean {
    if (!twilioSignatureHeader || !authToken) return false;
    const sortedKeys = Object.keys(params).sort();
    const data = sortedKeys.reduce((acc, k) => acc + k + params[k], fullUrl);
    const expected = crypto.createHmac("sha1", authToken).update(data).digest("base64");
    return timingSafeEqualBase64(expected, twilioSignatureHeader);
}

/**
 * Constant-time comparison for hex-encoded digests.
 * Returns false if the inputs are different lengths (rather than throwing).
 */
function timingSafeEqualHex(a: string, b: string): boolean {
    try {
        const bufA = Buffer.from(a, "hex");
        const bufB = Buffer.from(b, "hex");
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
}

/**
 * Constant-time comparison for base64-encoded digests.
 * Returns false if the inputs are different lengths.
 */
function timingSafeEqualBase64(a: string, b: string): boolean {
    try {
        const bufA = Buffer.from(a, "base64");
        const bufB = Buffer.from(b, "base64");
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
}
