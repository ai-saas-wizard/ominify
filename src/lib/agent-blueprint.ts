/**
 * Agent Blueprint Builder
 *
 * Utilities for:
 * 1. Parsing a system prompt into named sections
 * 2. Building an AgentBlueprint from a VAPI assistant payload
 * 3. Assembling a final system prompt from sections + overrides
 *
 * Used by:
 * - assistant-creation-actions.ts (onboarding)
 * - agent-deployment-actions.ts (V2 deployment)
 * - sequencer scheduler-worker (dispatch-time assembly)
 */

// ═══════════════════════════════════════════════════════════════════
// Types (mirrored from sequencer for webapp usage — sequencer imports its own)
// ═══════════════════════════════════════════════════════════════════

export interface PromptSections {
    identity: string;
    business_context: string;
    conversation_flow: string;
    qualification: string;
    brand_voice: string;
    closing: string;
    [key: string]: string;
}

export interface AgentBlueprint {
    version: '1.0';
    prompt_sections: PromptSections;
    first_message: string;
    model: {
        provider: string;
        model: string;
        temperature: number;
    };
    voice: {
        provider: string;
        voiceId: string;
        voiceName?: string;
    };
    transcriber: {
        provider: string;
        model: string;
        language: string;
    };
    tools: any[];
    tool_names: string[];
    settings: {
        maxDurationSeconds: number;
        backgroundSound?: string;
        voicemailMessage?: string;
        endCallMessage?: string;
        voicemailDetection?: any;
        serverUrl?: string;
    };
}

// ═══════════════════════════════════════════════════════════════════
// Section Parser
// ═══════════════════════════════════════════════════════════════════

/**
 * Section markers used in our prompt templates.
 * Maps bracket-header names to section keys.
 */
const SECTION_MARKERS: Record<string, keyof PromptSections> = {
    'Identity': 'identity',
    'Style': 'brand_voice',
    'Context': 'business_context',
    'Response Guidelines': 'qualification',
    'Task': 'conversation_flow',
    'Tool Instructions': 'closing',
    'Conversation Memory': 'closing',
    'Dynamic Variables': 'closing',
    'Error Handling': 'closing',
    'Voicemail Instructions': 'closing',
};

/**
 * Parse a system prompt into named sections.
 *
 * The prompt templates use `[SectionName]` headers. This parser splits on those
 * headers and maps each block to a canonical section key.
 *
 * Sections that don't map to a known key get folded into 'closing'.
 * Multiple sections mapping to the same key get concatenated.
 */
export function parsePromptSections(systemPrompt: string): PromptSections {
    const sections: PromptSections = {
        identity: '',
        business_context: '',
        conversation_flow: '',
        qualification: '',
        brand_voice: '',
        closing: '',
    };

    // Split on [Header] patterns
    const sectionRegex = /\[([^\]]+)\]/g;
    const matches: Array<{ name: string; start: number }> = [];

    let match;
    while ((match = sectionRegex.exec(systemPrompt)) !== null) {
        matches.push({ name: match[1], start: match.index });
    }

    if (matches.length === 0) {
        // No section headers found — put entire prompt in identity
        sections.identity = systemPrompt.trim();
        return sections;
    }

    // Extract text between section headers
    for (let i = 0; i < matches.length; i++) {
        const headerEnd = systemPrompt.indexOf(']', matches[i].start) + 1;
        const nextStart = i + 1 < matches.length ? matches[i + 1].start : systemPrompt.length;
        const content = systemPrompt.slice(headerEnd, nextStart).trim();
        const sectionName = matches[i].name;

        // Map to canonical section key
        const key = SECTION_MARKERS[sectionName] || 'closing';

        if (sections[key]) {
            sections[key] += '\n\n' + content;
        } else {
            sections[key] = content;
        }
    }

    // Capture any text before the first section header as identity preamble
    const preHeader = systemPrompt.slice(0, matches[0].start).trim();
    if (preHeader) {
        sections.identity = preHeader + (sections.identity ? '\n\n' + sections.identity : '');
    }

    return sections;
}

/**
 * Assemble a full system prompt from sections, applying overrides and injections.
 *
 * @param baseSections - The base prompt sections from the blueprint
 * @param overrides - Section overrides (replaces matching sections)
 * @param injections - Additional sections to append (e.g., conversation_history, tone_directive)
 */
export function assemblePromptFromSections(
    baseSections: PromptSections,
    overrides?: Record<string, string>,
    injections?: Record<string, string>
): string {
    // Merge base with overrides
    const merged = { ...baseSections };
    if (overrides) {
        for (const [key, value] of Object.entries(overrides)) {
            if (value) merged[key] = value;
        }
    }

    // Build the prompt in canonical section order
    const orderedKeys = ['identity', 'brand_voice', 'business_context', 'qualification', 'conversation_flow', 'closing'];
    const parts: string[] = [];

    for (const key of orderedKeys) {
        if (merged[key]) {
            parts.push(merged[key]);
        }
    }

    // Add any extra sections not in the canonical order
    for (const [key, value] of Object.entries(merged)) {
        if (!orderedKeys.includes(key) && value) {
            parts.push(value);
        }
    }

    // Append injections
    if (injections) {
        for (const [_key, value] of Object.entries(injections)) {
            if (value) parts.push(value);
        }
    }

    return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════
// Blueprint Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract tool names from a VAPI tools array.
 */
function extractToolNames(tools: any[]): string[] {
    const names: string[] = [];
    for (const tool of tools) {
        if (tool.type === 'function' && tool.function?.name) {
            names.push(tool.function.name);
        } else if (tool.type === 'endCall') {
            names.push('endCall');
        } else if (tool.type === 'transferCall') {
            names.push('transferCall');
        }
    }
    return names;
}

/**
 * Build an AgentBlueprint from the data available at agent creation time.
 *
 * This captures the full VAPI agent config so the sequencer can reconstruct
 * an inline agent at dispatch time without calling VAPI's API.
 */
export function buildAgentBlueprint(params: {
    systemPrompt: string;
    firstMessage: string;
    model: { provider: string; model: string; temperature: number };
    voice: { provider: string; voiceId: string; voiceName?: string };
    transcriber?: { provider: string; model: string; language: string };
    tools: any[];
    settings: {
        maxDurationSeconds?: number;
        backgroundSound?: string;
        voicemailMessage?: string;
        endCallMessage?: string;
        voicemailDetection?: any;
        serverUrl?: string;
    };
}): AgentBlueprint {
    return {
        version: '1.0',
        prompt_sections: parsePromptSections(params.systemPrompt),
        first_message: params.firstMessage,
        model: {
            provider: params.model.provider,
            model: params.model.model,
            temperature: params.model.temperature,
        },
        voice: {
            provider: params.voice.provider,
            voiceId: params.voice.voiceId,
            voiceName: params.voice.voiceName,
        },
        transcriber: params.transcriber || {
            provider: 'deepgram',
            model: 'nova-2',
            language: 'en',
        },
        tools: params.tools,
        tool_names: extractToolNames(params.tools),
        settings: {
            maxDurationSeconds: params.settings.maxDurationSeconds || 300,
            backgroundSound: params.settings.backgroundSound,
            voicemailMessage: params.settings.voicemailMessage,
            endCallMessage: params.settings.endCallMessage,
            voicemailDetection: params.settings.voicemailDetection,
            serverUrl: params.settings.serverUrl,
        },
    };
}

/**
 * Apply tool overrides (add/remove) to a base tool set.
 * Returns the modified tools array.
 */
export function applyToolOverrides(
    baseTools: any[],
    baseToolNames: string[],
    overrides?: { add?: string[]; remove?: string[] }
): any[] {
    if (!overrides) return baseTools;

    let tools = [...baseTools];

    // Remove tools
    if (overrides.remove && overrides.remove.length > 0) {
        const removeSet = new Set(overrides.remove);
        tools = tools.filter((tool) => {
            const name = tool.type === 'function' ? tool.function?.name : tool.type;
            return !removeSet.has(name);
        });
    }

    // Add tools — for now, only support adding endCall and transferCall by name.
    // Custom function tools would need full schemas (future: resolve from a registry).
    if (overrides.add && overrides.add.length > 0) {
        const existingNames = new Set(extractToolNames(tools));
        for (const name of overrides.add) {
            if (existingNames.has(name)) continue;
            if (name === 'endCall') {
                tools.push({ type: 'endCall' });
            } else if (name === 'transferCall') {
                tools.push({ type: 'transferCall', destinations: [] });
            }
            // Custom function tools: skip for now — they need full schemas
        }
    }

    return tools;
}
