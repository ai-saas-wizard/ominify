"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { EmailContent } from "../types";
import { VariableHelper } from "../variable-helper";

interface EmailContentEditorProps {
  content: { subject: string; body_html: string; body_text: string };
  onChange: (content: {
    subject: string;
    body_html: string;
    body_text: string;
  }) => void;
}

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

export function EmailContentEditor({
  content,
  onChange,
}: EmailContentEditorProps) {
  const [focusedField, setFocusedField] = useState<"subject" | "body_html">(
    "body_html"
  );

  const handleSubjectChange = (value: string) => {
    onChange({
      ...content,
      subject: value,
    });
  };

  const handleBodyHtmlChange = (value: string) => {
    onChange({
      ...content,
      body_html: value,
      body_text: stripHtml(value),
    });
  };

  const handleVariableInsert = (variable: string) => {
    const tag = `{{${variable}}}`;
    if (focusedField === "subject") {
      onChange({
        ...content,
        subject: content.subject + tag,
      });
    } else {
      const newHtml = content.body_html + tag;
      onChange({
        ...content,
        body_html: newHtml,
        body_text: stripHtml(newHtml),
      });
    }
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
          Subject
        </label>
        <input
          type="text"
          value={content.subject}
          onChange={(e) => handleSubjectChange(e.target.value)}
          onFocus={() => setFocusedField("subject")}
          className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          placeholder="Email subject line..."
        />
      </div>

      <VariableHelper onInsert={handleVariableInsert} />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Body (HTML)
        </label>
        <textarea
          rows={8}
          value={content.body_html}
          onChange={(e) => handleBodyHtmlChange(e.target.value)}
          onFocus={() => setFocusedField("body_html")}
          className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
          placeholder="Write your email body here..."
        />
        <p className="text-xs text-gray-400 mt-1">
          Plain text version will be auto-generated from HTML
        </p>
      </div>
    </motion.div>
  );
}
