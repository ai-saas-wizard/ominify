import type { VerticalDefinition } from "./types";
import { reInvestorDefinition } from "./real-estate-investor/definition";

// ─── VERTICAL REGISTRY ───
// To add a new vertical:
// 1. Create a folder under src/lib/verticals/<vertical-name>/
// 2. Add definition.ts, prompts.ts, tools.ts
// 3. Import and add to VERTICAL_REGISTRY below

const VERTICAL_REGISTRY: Record<string, VerticalDefinition> = {
    real_estate_investor: reInvestorDefinition,
};

export function getVertical(id: string): VerticalDefinition | undefined {
    return VERTICAL_REGISTRY[id];
}

export function getAllVerticals(): VerticalDefinition[] {
    return Object.values(VERTICAL_REGISTRY);
}

export function getVerticalIds(): string[] {
    return Object.keys(VERTICAL_REGISTRY);
}
