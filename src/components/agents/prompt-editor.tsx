"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Sparkles, Check, Undo2, Eye, EyeOff, Loader2, History } from "lucide-react";
import { editPromptWithAI } from "@/app/actions/prompt-editor-actions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PromptEditorProps {
  agentId: string;
  initialPrompt: string;
  onSave: (newPrompt: string) => Promise<void>;
  onClose: () => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface DiffLine {
  type: "add" | "remove" | "same";
  text: string;
}

// ─── Suggestion Chips ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Make the agent sound more professional",
  "Add Spanish language support",
  "Ask for budget or timeline earlier in the call",
  "Be stricter about not discussing pricing",
];

// ─── Diff Utility ─────────────────────────────────────────────────────────────

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const diff: DiffLine[] = [];

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Track which lines from each side have been "consumed"
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      diff.push({ type: "same", text: oldLines[oi] });
      oi++;
      ni++;
    } else if (oi < oldLines.length && !newSet.has(oldLines[oi])) {
      diff.push({ type: "remove", text: oldLines[oi] });
      oi++;
    } else if (ni < newLines.length && !oldSet.has(newLines[ni])) {
      diff.push({ type: "add", text: newLines[ni] });
      ni++;
    } else if (oi < oldLines.length) {
      diff.push({ type: "remove", text: oldLines[oi] });
      oi++;
    } else {
      diff.push({ type: "add", text: newLines[ni] });
      ni++;
    }
  }

  return diff;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PromptEditor({ agentId, initialPrompt, onSave, onClose }: PromptEditorProps) {
  const [currentPrompt, setCurrentPrompt] = useState(initialPrompt);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [showingDiff, setShowingDiff] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    setShowSuggestions(false);
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const result = await editPromptWithAI(currentPrompt, text.trim(), messages);

    if (result.success && result.data) {
      setPendingPrompt(result.data.newPrompt);
      setShowingDiff(true);

      const changeList = result.data.changes
        .map((c) => {
          const icon = c.type === "add" ? "+" : c.type === "remove" ? "-" : "~";
          return `${icon} ${c.description}`;
        })
        .join("\n");

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Here's what I changed:\n\n${changeList}\n\nReview the diff on the left and accept or reject.`,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.error || "Something went wrong." },
      ]);
    }

    setIsLoading(false);
  }, [currentPrompt, isLoading]);

  // ── Accept / Reject ───────────────────────────────────────────────────────

  const handleAccept = async () => {
    if (!pendingPrompt) return;
    setIsSaving(true);
    try {
      await onSave(pendingPrompt);
      setPromptHistory((prev) => [...prev, currentPrompt]);
      setCurrentPrompt(pendingPrompt);
      setPendingPrompt(null);
      setShowingDiff(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Changes saved successfully." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to save. Please try again." },
      ]);
    }
    setIsSaving(false);
  };

  const handleReject = () => {
    setPendingPrompt(null);
    setShowingDiff(false);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "No changes were made. Feel free to try a different edit." },
    ]);
  };

  const handleRollback = async () => {
    if (promptHistory.length === 0) return;
    setIsSaving(true);
    const previousPrompt = promptHistory[promptHistory.length - 1];
    try {
      await onSave(previousPrompt);
      setCurrentPrompt(previousPrompt);
      setPromptHistory((prev) => prev.slice(0, -1));
      setPendingPrompt(null);
      setShowingDiff(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Rolled back to the previous version." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to rollback. Please try again." },
      ]);
    }
    setIsSaving(false);
  };

  // ── Diff ──────────────────────────────────────────────────────────────────

  const diff = pendingPrompt ? computeDiff(currentPrompt, pendingPrompt) : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[1100px] h-[580px] flex flex-col overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50/80">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-600" />
            <span className="text-sm font-semibold text-gray-900">Edit with AI</span>
            {showSaved && (
              <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full animate-in fade-in duration-200">
                Saved
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-200 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Split Panels */}
        <div className="flex flex-1 min-h-0">
          {/* ── Left Panel: Prompt / Diff ─────────────────────────────── */}
          <div className="w-[42%] flex flex-col border-r border-gray-200">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50/60 border-b border-gray-100">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                System Prompt
              </span>
              <div className="flex items-center gap-2">
                {promptHistory.length > 0 && !pendingPrompt && (
                  <button
                    onClick={handleRollback}
                    disabled={isSaving}
                    className="flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 transition-colors disabled:opacity-50"
                  >
                    <History className="w-3 h-3" />
                    Rollback
                  </button>
                )}
                {pendingPrompt && (
                  <button
                    onClick={() => setShowingDiff(!showingDiff)}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-violet-600 hover:text-violet-700 transition-colors"
                  >
                    {showingDiff ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showingDiff ? "Edit" : "Show diff"}
                  </button>
                )}
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-auto min-h-0">
              {showingDiff && pendingPrompt ? (
                <div className="p-4 font-mono text-[13px] leading-relaxed space-y-0">
                  {diff.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.type === "add"
                          ? "bg-emerald-50 text-emerald-800"
                          : line.type === "remove"
                          ? "bg-red-50 text-red-600 line-through"
                          : "text-gray-400"
                      }
                    >
                      <span className="inline-block w-5 text-center select-none opacity-60">
                        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                      </span>
                      {line.text || "\u00A0"}
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={pendingPrompt ?? currentPrompt}
                  onChange={(e) => {
                    if (!pendingPrompt) setCurrentPrompt(e.target.value);
                  }}
                  readOnly={!!pendingPrompt}
                  className="w-full h-full p-4 font-mono text-[13px] leading-relaxed text-gray-800 bg-transparent border-none outline-none resize-none"
                  placeholder="Your agent prompt will appear here..."
                />
              )}
            </div>

            {/* Action bar — only when pending */}
            {pendingPrompt && (
              <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50/60">
                <button
                  onClick={handleAccept}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Accept changes
                </button>
                <button
                  onClick={handleReject}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-100 transition-colors"
                >
                  <Undo2 className="w-3 h-3" />
                  Reject
                </button>
              </div>
            )}
          </div>

          {/* ── Right Panel: Chat ─────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Panel header */}
            <div className="px-4 py-2 bg-gray-50/60 border-b border-gray-100">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Chat
              </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-3 min-h-0">
              {messages.length === 0 && !isLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <Sparkles className="w-8 h-8 text-violet-300" />
                  <p className="text-sm text-gray-500 max-w-[280px]">
                    Describe what you'd like to change about your prompt in plain English.
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-violet-600 text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 px-3.5 py-2.5 rounded-xl rounded-bl-sm text-sm flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Suggestion chips */}
            {showSuggestions && messages.length === 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full hover:bg-violet-100 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder="Describe what to change..."
                  disabled={isLoading}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 disabled:opacity-50 transition-all"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={isLoading || !input.trim()}
                  className="p-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
