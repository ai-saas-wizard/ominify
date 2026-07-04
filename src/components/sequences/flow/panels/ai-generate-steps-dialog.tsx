"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, X, Wand2, MessageSquare, Phone, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { generateAIStepsForSequence } from "@/app/actions/ai-generate-sequence-actions";
import { cn } from "@/lib/utils";
import { seqBtnPrimary, seqBtnGhost, seqFocusRing } from "@/components/sequences/theme";

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
            className="w-full max-w-lg overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-gray-400" />
                <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                  Generate Steps with AI
                </h2>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close"
                className={cn(
                  "rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600",
                  seqFocusRing
                )}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Suggestion Chips */}
            <div className="flex flex-wrap gap-2 px-6 pb-1 pt-4">
              {[
                { label: "Add a follow-up SMS", icon: MessageSquare },
                { label: "Add a voicemail fallback", icon: Phone },
                { label: "Add a re-engagement email", icon: Mail },
              ].map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => setPrompt(chip.label)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50",
                    seqFocusRing
                  )}
                >
                  <chip.icon className="h-3 w-3 text-gray-400" />
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
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
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
                className={cn(seqBtnGhost, "px-4 py-2")}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || loading}
                className={cn(seqBtnPrimary, "px-4 py-2")}
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
