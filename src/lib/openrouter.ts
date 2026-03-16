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

export const SEQUENCE_MODEL = "z-ai/glm-5";
