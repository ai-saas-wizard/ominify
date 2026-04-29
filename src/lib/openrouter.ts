import "server-only";
import OpenAI from "openai";

export function getOpenRouterClient() {
    return new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        timeout: 45000,
        defaultHeaders: {
            "HTTP-Referer": "https://omnify.app",
            "X-OpenRouter-Title": "Omnify",
        },
    });
}

// GLM-5 for conversational reasoning (asking clarifying questions)
export const CONVERSATION_MODEL = "z-ai/glm-5";

// GPT-4o-mini for structured JSON generation (fast, cheap, reliable JSON output)
export const GENERATION_MODEL = "openai/gpt-4o-mini";

// Claude Sonnet 4.5 for authoring long, rules-heavy structured documents
// (e.g. VAPI voice-agent system prompts). Picked over GPT-4o because it
// adheres more tightly to multi-rule prompt-engineering instructions and
// produces cleaner long-form sectioned markdown. Swap to
// "anthropic/claude-opus-4.5" for top quality at ~5× cost, or
// "google/gemini-2.5-pro" for a cheaper alternative.
export const PROMPT_AUTHORING_MODEL = "anthropic/claude-sonnet-4.5";
