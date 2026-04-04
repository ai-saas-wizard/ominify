// ═══════════════════════════════════════════════════════════
// VOICE CONFIGURATION
// Single source of truth for all available voices.
// ═══════════════════════════════════════════════════════════

export interface VoiceOption {
    voiceId: string;
    name: string;
    description: string;
    previewUrl: string;
    provider: "11labs";
}

export const VOICES: VoiceOption[] = [
    {
        voiceId: "RXtWW6etvimS8QJ5nhVk",
        name: "Fiona",
        description: "Chill & Natural",
        previewUrl: "/audio/voices/fiona.mp3",
        provider: "11labs",
    },
    {
        voiceId: "ZRwrL4id6j1HPGFkeCzO",
        name: "Sam",
        description: "Relaxed, Light and Soothing",
        previewUrl: "/audio/voices/sam.mp3",
        provider: "11labs",
    },
    {
        voiceId: "bMxLr8fP6hzNRRi9nJxU",
        name: "Ivanna",
        description: "Candid, Peppy and Genuine",
        previewUrl: "/audio/voices/ivanna.mp3",
        provider: "11labs",
    },
    {
        voiceId: "uMM5TEnpKKgD758knVJO",
        name: "Liz",
        description: "CX Expert",
        previewUrl: "/audio/voices/liz.mp3",
        provider: "11labs",
    },
];

export const DEFAULT_VOICE = VOICES[0]; // Fiona
export const RE_DEFAULT_VOICE = VOICES[1]; // Sam

export function getVoiceById(voiceId: string): VoiceOption | undefined {
    return VOICES.find((v) => v.voiceId === voiceId);
}

export function getVoiceName(voiceId: string): string {
    return getVoiceById(voiceId)?.name ?? "Unknown";
}
