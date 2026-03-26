"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, X, Wand2, MessageSquare, Phone, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { generateAIStepsForSequence } from "@/app/actions/ai-generate-sequence-actions";

interface AIGenerateStepsDialogProps {
  clientId: string;
  sequenceId: string;
  isOpen: boolean;
  onClose: () => void;
  onGenerated: () => void;
}

export function AIGenerateStepsDialog({
  clientId,
  sequenceId,
  isOpen,
  onClose,
  onGenerated,
}: AIGenerateStepsDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await generateAIStepsForSequence(clientId, sequenceId, prompt);
      if (res.success) {
        setPrompt("");
        onGenerated();
        onClose();
      } else {
        setError(res.error || "Failed to generate steps");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-semibold text-gray-900">
                  Generate Steps with AI
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Suggestion Chips */}
            <div className="px-6 pt-4 pb-1 flex flex-wrap gap-2">
              {[
                { label: "Add a follow-up SMS", icon: MessageSquare },
                { label: "Add a voicemail fallback", icon: Phone },
                { label: "Add a re-engagement email", icon: Mail },
              ].map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => setPrompt(chip.label)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full transition-colors"
                >
                  <chip.icon className="w-3 h-3" />
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Describe the steps to add
                </label>
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Add a follow-up SMS after 2 hours, then an email the next day with a special offer"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || loading}
                className="bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium shadow-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Generate Steps
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
