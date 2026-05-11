// Render-only labels for vendor/model strings returned by VAPI.
// Never substitute these into payloads sent back to VAPI — these are
// for end-user UI display only, so users don't see "11labs" or "gpt-4o-mini".
// Admin views should continue to render the raw values directly.

const VOICE_LABEL = "Studio Voice";
const STANDARD_MODEL = "Standard";
const ADVANCED_MODEL = "Advanced";

const ADVANCED_MODELS = new Set([
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-4",
    "o1",
    "o1-preview",
    "claude-3-opus",
    "claude-3-5-sonnet",
    "claude-opus-4",
    "claude-sonnet-4",
]);

const STANDARD_MODELS = new Set([
    "gpt-4o-mini",
    "gpt-3.5-turbo",
    "o1-mini",
    "claude-3-haiku",
    "claude-haiku-4-5",
    "llama-3",
    "llama-3.1",
]);

export function getVoiceProviderLabel(_provider?: string | null): string {
    return VOICE_LABEL;
}

export function getModelLabel(model?: string | null): string {
    if (!model) return STANDARD_MODEL;

    // VAPI sometimes returns prefixed slugs like "openrouter/openai/gpt-4o-mini".
    const slug = model.toLowerCase().split("/").pop() ?? "";

    if (ADVANCED_MODELS.has(slug)) return ADVANCED_MODEL;
    if (STANDARD_MODELS.has(slug)) return STANDARD_MODEL;

    if (slug.includes("mini") || slug.includes("haiku")) return STANDARD_MODEL;
    if (slug.includes("opus") || slug.includes("sonnet") || slug.startsWith("gpt-4")) {
        return ADVANCED_MODEL;
    }

    return STANDARD_MODEL;
}
