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

export async function editPromptWithAI(
  currentPrompt: string,
  userMessage: string
): Promise<PromptEditorResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OpenRouter API key not configured" };
  }

  const systemPrompt = `You are an expert AI voice agent prompt engineer helping non-technical SaaS users improve their AI agent system prompts.

The user will describe what they want to change in plain English. Your job is to:
1. Rewrite the ENTIRE prompt incorporating their requested changes — keep everything that should stay the same
2. Return ONLY valid JSON in this exact format, nothing else, no markdown:
{
  "newPrompt": "<full rewritten prompt>",
  "changes": [
    { "type": "add|edit|remove", "description": "short description" }
  ]
}

Current prompt:
${currentPrompt}

User request: ${userMessage}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "z-ai/glm-4.7",
        max_tokens: 4096,
        messages: [
          { role: "user", content: systemPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenRouter API error:", errText);
      return { success: false, error: "AI service returned an error. Please try again." };
    }

    const json = await res.json();
    const rawText: string = json.choices?.[0]?.message?.content || "";

    // Strip markdown fences if present
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed: PromptEditResult = JSON.parse(cleaned);

    if (!parsed.newPrompt || !Array.isArray(parsed.changes)) {
      return { success: false, error: "AI returned an unexpected format. Please try again." };
    }

    return { success: true, data: parsed };
  } catch (err: any) {
    console.error("Prompt editor error:", err);
    if (err instanceof SyntaxError) {
      return { success: false, error: "Failed to parse AI response. Please try again." };
    }
    return { success: false, error: "Something went wrong. Please try again." };
  }
}
