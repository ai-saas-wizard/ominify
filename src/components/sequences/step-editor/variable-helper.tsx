"use client";

import { TEMPLATE_VARIABLES } from "./types";

interface VariableHelperProps {
  onInsert: (variable: string) => void;
}

export function VariableHelper({ onInsert }: VariableHelperProps) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">Insert variable</p>
      <div className="flex flex-wrap gap-1.5 py-2">
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onInsert(`{{${v.key}}}`)}
            className="bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 text-xs px-2.5 py-1 font-mono rounded-full transition-colors cursor-pointer"
          >
            {v.key}
          </button>
        ))}
      </div>
    </div>
  );
}
