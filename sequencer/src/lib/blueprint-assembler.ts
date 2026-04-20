/**
 * Blueprint Assembler (Sequencer Runtime)
 *
 * At dispatch time, takes an AgentBlueprint + step overrides + runtime injections
 * and assembles the final InlineVapiAgent payload.
 *
 * This is the core of the transient dispatch redesign:
 * - Base config comes from the blueprint (stored in DB)
 * - Step-level overrides surgically replace specific prompt sections
 * - Runtime injections add conversation memory and tone directives
 * - Tool overrides add/remove tools per step
 * - Result is always an inline/transient agent — never an assistantId
 */

import type {
    AgentBlueprint,
    PromptSections,
    InlineVapiAgent,
    VoiceContent,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// Prompt Assembly
// ═══════════════════════════════════════════════════════════════════

/**
 * Assemble a full system prompt from blueprint sections, applying overrides and injections.
 */
export function assemblePrompt(
    baseSections: PromptSections,
    overrides?: Record<string, string>,
    injections?: Record<string, string>
): string {
    // Merge base with overrides (overrides replace matching sections)
    const merged: Record<string, string> = { ...baseSections };
    if (overrides) {
        for (const [key, value] of Object.entries(overrides)) {
            if (value) merged[key] = value;
        }
    }

    // Build prompt in canonical section order
    const orderedKeys = ['identity', 'brand_voice', 'business_context', 'qualification', 'conversation_flow', 'closing'];
    const parts: string[] = [];

    for (const key of orderedKeys) {
        if (merged[key]) parts.push(merged[key]);
    }

    // Add any extra sections not in the canonical order
    for (const [key, value] of Object.entries(merged)) {
        if (!orderedKeys.includes(key) && value) {
            parts.push(value);
        }
    }

    // Append runtime injections (conversation history, tone directive)
    if (injections) {
        for (const [, value] of Object.entries(injections)) {
            if (value) parts.push(value);
        }
    }

    return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════
// Tool Override Application
// ═══════════════════════════════════════════════════════════════════

/**
 * Apply step-level tool overrides to the base tool set.
 */
export function applyToolOverrides(
    baseTools: any[],
    overrides?: { add?: string[]; remove?: string[] }
): any[] {
    if (!overrides) return baseTools;

    let tools = [...baseTools];

    // Remove tools by name
    if (overrides.remove && overrides.remove.length > 0) {
        const removeSet = new Set(overrides.remove);
        tools = tools.filter((tool) => {
            const name = tool.type === 'function' ? tool.function?.name : tool.type;
            return !removeSet.has(name);
        });
    }

    // Add tools by name (endCall, transferCall — custom functions need schemas)
    if (overrides.add && overrides.add.length > 0) {
        const existingNames = new Set(tools.map((t) =>
            t.type === 'function' ? t.function?.name : t.type
        ));
        for (const name of overrides.add) {
            if (existingNames.has(name)) continue;
            if (name === 'endCall') tools.push({ type: 'endCall' });
            else if (name === 'transferCall') tools.push({ type: 'transferCall', destinations: [] });
        }
    }

    return tools;
}

// ═══════════════════════════════════════════════════════════════════
// Inline Agent Assembly
// ═══════════════════════════════════════════════════════════════════

/**
 * Assemble a full InlineVapiAgent from a blueprint + step-level and runtime overrides.
 *
 * This is the main function called by the scheduler at dispatch time.
 */
export function assembleInlineAgent(params: {
    blueprint: AgentBlueprint;
    promptSectionOverrides?: Record<string, string>;
    promptInjections?: Record<string, string>;
    toolOverrides?: { add?: string[]; remove?: string[] };
    firstMessageOverride?: string;
    variableValues?: Record<string, string>;
}): InlineVapiAgent {
    const { blueprint, promptSectionOverrides, promptInjections, toolOverrides, firstMessageOverride, variableValues } = params;

    // 1. Assemble system prompt from sections
    const systemPrompt = assemblePrompt(
        blueprint.prompt_sections,
        promptSectionOverrides,
        promptInjections
    );

    // 2. Apply tool overrides
    const tools = applyToolOverrides(blueprint.tools, toolOverrides);

    // 3. Build the inline agent
    return {
        firstMessage: firstMessageOverride || blueprint.first_message,
        model: {
            provider: blueprint.model.provider,
            model: blueprint.model.model,
            systemPrompt,
            temperature: blueprint.model.temperature,
        },
        voice: {
            provider: blueprint.voice.provider,
            voiceId: blueprint.voice.voiceId,
        },
        transcriber: blueprint.transcriber ? {
            provider: blueprint.transcriber.provider,
            model: blueprint.transcriber.model,
            language: blueprint.transcriber.language,
        } : undefined,
        tools,
        maxDurationSeconds: blueprint.settings.maxDurationSeconds,
        backgroundSound: blueprint.settings.backgroundSound,
        endCallMessage: blueprint.settings.endCallMessage,
        voicemailMessage: blueprint.settings.voicemailMessage,
        voicemailDetection: blueprint.settings.voicemailDetection,
        serverUrl: blueprint.settings.serverUrl,
        variableValues,
    };
}

/**
 * Check if a blueprint is valid and has the required fields.
 */
export function isValidBlueprint(blueprint: any): blueprint is AgentBlueprint {
    return (
        blueprint &&
        blueprint.version === '1.0' &&
        blueprint.prompt_sections &&
        typeof blueprint.prompt_sections.identity === 'string' &&
        blueprint.model &&
        blueprint.voice &&
        Array.isArray(blueprint.tools)
    );
}
