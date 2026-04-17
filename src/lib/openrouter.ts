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
