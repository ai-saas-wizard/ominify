"use client";

import { motion } from "framer-motion";
import type { SmsContent } from "../types";
import { VariableHelper } from "../variable-helper";

interface SmsContentEditorProps {
  content: { body: string };
  onChange: (content: { body: string }) => void;
}

export function SmsContentEditor({ content, onChange }: SmsContentEditorProps) {
  const charCount = content.body.length;
  const charColor =
    charCount > 320
      ? "text-red-500"
      : charCount > 160
        ? "text-amber-500"
        : "text-gray-400";

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
          Message Body
        </label>
        <textarea
          rows={5}
          value={content.body}
          onChange={(e) => onChange({ body: e.target.value })}
          className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
          placeholder="Type your SMS message..."
        />
        <p className={`text-xs mt-1 ${charColor}`}>
          {charCount} / 160 characters
        </p>
      </div>

      <VariableHelper
        onInsert={(variable) =>
          onChange({ body: content.body + `{{${variable}}}` })
        }
      />
    </motion.div>
  );
}
