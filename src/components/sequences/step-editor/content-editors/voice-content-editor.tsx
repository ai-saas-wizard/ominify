"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { VoiceContent } from "../types";
import { VariableHelper } from "../variable-helper";

interface VoiceContentEditorProps {
  content: {
    first_message: string;
    system_prompt: string;
    vapi_assistant_id?: string;
  };
  onChange: (content: {
    first_message: string;
    system_prompt: string;
    vapi_assistant_id?: string;
  }) => void;
}

export function VoiceContentEditor({
  content,
  onChange,
}: VoiceContentEditorProps) {
  const [focusedField, setFocusedField] = useState<
    "first_message" | "system_prompt"
  >("first_message");

  const handleVariableInsert = (variable: string) => {
    const tag = `{{${variable}}}`;
    onChange({
      ...content,
      [focusedField]: content[focusedField] + tag,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          First Message (greeting)
        </label>
        <textarea
          rows={3}
          value={content.first_message}
          onChange={(e) =>
            onChange({ ...content, first_message: e.target.value })
          }
          onFocus={() => setFocusedField("first_message")}
          className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
          placeholder="Hi, this is..."
        />
        <p className="text-xs text-gray-400 mt-1">Keep under 20 words</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          System Prompt (instructions)
        </label>
        <textarea
          rows={8}
          value={content.system_prompt}
          onChange={(e) =>
            onChange({ ...content, system_prompt: e.target.value })
          }
          onFocus={() => setFocusedField("system_prompt")}
          className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
          placeholder="You are a helpful assistant that..."
        />
      </div>

      <VariableHelper onInsert={handleVariableInsert} />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Voice Agent ID{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={content.vapi_assistant_id ?? ""}
          onChange={(e) =>
            onChange({
              ...content,
              vapi_assistant_id: e.target.value || undefined,
            })
          }
          className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          placeholder="Leave blank to use default"
        />
      </div>
    </motion.div>
  );
}
