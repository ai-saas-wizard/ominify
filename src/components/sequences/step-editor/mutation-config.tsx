"use client";

import { Sparkles } from "lucide-react";

interface MutationConfigProps {
  channel: string;
  enabled: boolean;
  instructions: string;
  onEnabledChange: (enabled: boolean) => void;
  onInstructionsChange: (instructions: string) => void;
}

export default function MutationConfig({
  channel,
  enabled,
  instructions,
  onEnabledChange,
  onInstructionsChange,
}: MutationConfigProps) {
  if (channel !== "sms" && channel !== "email" && channel !== "voice") {
    return null;
  }

  return (
    <div className="space-y-3 p-4 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <span className="text-sm font-medium text-gray-700">AI Adaptive Mutation</span>
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? "bg-emerald-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <p className="text-xs text-gray-500">
        When enabled, AI will automatically adapt the message content for each contact based on context and prior interactions.
      </p>

      {enabled && (
        <textarea
          rows={2}
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          placeholder="Instructions for AI mutation (e.g., personalize tone, adjust urgency level...)"
          className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
      )}
    </div>
  );
}
