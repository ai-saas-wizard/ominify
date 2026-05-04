import "server-only";

export interface VapiErrorInfo {
    status: number;
    body: string;
}

const KEY_PATTERN = /sk_(live|test)_[A-Za-z0-9]+/g;
const MAX_LEN = 500;

/**
 * Convert a VAPI API error into a single user-facing string.
 *
 * VAPI's standard error envelope is `{ message: string | string[], error,
 * statusCode }`. We extract `message` if parseable, redact key-shaped tokens,
 * and truncate. UUIDs are kept — they identify the structured-output / tool /
 * assistant the user (or we) need to look up to debug.
 */
export function formatVapiError(error?: VapiErrorInfo): string {
    if (!error) return "VAPI rejected the request (no response body)";

    if (error.status === 0) {
        return `VAPI request failed (network error): ${truncate(redact(error.body))}`;
    }

    let message = error.body;
    try {
        const parsed = JSON.parse(error.body);
        const raw = parsed?.message;
        if (Array.isArray(raw)) {
            message = raw.join("; ");
        } else if (typeof raw === "string") {
            message = raw;
        }
    } catch {
        // not JSON — fall through with raw body
    }

    return `VAPI ${error.status}: ${truncate(redact(message))}`;
}

function redact(s: string): string {
    return s.replace(KEY_PATTERN, "[redacted-key]");
}

function truncate(s: string): string {
    if (s.length <= MAX_LEN) return s;
    return s.slice(0, MAX_LEN) + "…";
}
