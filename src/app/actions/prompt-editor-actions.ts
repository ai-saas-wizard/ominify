"use server";

interface PromptEditResult {
  newPrompt: string;
  changes: { type: "add" | "edit" | "remove"; description: string }[];
}

interface PromptEditorResponse {
  success: boolean;
  data?: PromptEditResult;
  error?: string;
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
}

function extractJSON(text: string): string {
  // Find the outermost { ... } in the response
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

export async function editPromptWithAI(
  currentPrompt: string,
  userMessage: string,
  conversationHistory?: { role: "user" | "assistant"; content: string }[]
): Promise<PromptEditorResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OpenRouter API key not configured" };
  }

  const systemMessage = `You are an expert AI voice agent prompt engineer helping non-technical SaaS users improve their AI agent system prompts.

The user will describe what they want to change in plain English. Your job is to:
1. Rewrite the ENTIRE prompt incorporating their requested changes — keep everything that should stay the same
2. Return ONLY valid JSON in this exact format, nothing else, no markdown fences:
{
  "newPrompt": "<full rewritten prompt>",
  "changes": [
    { "type": "add|edit|remove", "description": "short description" }
  ]
}

IMPORTANT: Escape all special characters in JSON strings properly. Use \\n for newlines inside the newPrompt value. Make sure the JSON is complete and valid.

Current prompt:
${currentPrompt}`;

  // Build messages array with conversation history for context
  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemMessage },
  ];

  // Include recent conversation history (last 6 messages to avoid token bloat)
  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-6);
    for (const msg of recent) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add the current user message
  messages.push({ role: "user", content: userMessage });

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        max_tokens: 16384,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenRouter API error:", errText);
      return { success: false, error: "AI service returned an error. Please try again." };
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    const rawText: string = choice?.message?.content || "";

    // Detect truncated response
    if (choice?.finish_reason === "length") {
      console.error("OpenRouter response truncated (finish_reason: length)");
      return {
        success: false,
        error: "AI response was too long and got cut off. Try a more specific edit request.",
      };
    }

    if (!rawText.trim()) {
      return { success: false, error: "AI returned an empty response. Please try again." };
    }

    // Strip markdown fences and extract JSON
    const cleaned = extractJSON(stripMarkdownFences(rawText));

    const parsed: PromptEditResult = JSON.parse(cleaned);

    if (!parsed.newPrompt || !Array.isArray(parsed.changes)) {
      return { success: false, error: "AI returned an unexpected format. Please try again." };
    }

    return { success: true, data: parsed };
  } catch (err: any) {
    console.error("Prompt editor error:", err);
    if (err instanceof SyntaxError) {
      return {
        success: false,
        error: "Failed to parse AI response. The model may have returned malformed JSON. Please try again.",
      };
    }
    return { success: false, error: "Something went wrong. Please try again." };
  }
}
