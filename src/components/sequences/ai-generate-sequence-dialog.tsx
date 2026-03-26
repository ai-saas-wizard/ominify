"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    Sparkles,
    Loader2,
    X,
    Send,
    Wand2,
    ArrowLeft,
    Zap,
    Phone,
    Mail,
    Clock,
    Target,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
    startAIConversation,
    sendConversationMessage,
    confirmAndGenerate,
    type ConversationMessage,
    type ConversationPlan,
} from "@/app/actions/ai-generate-sequence-actions";

type Phase = "idle" | "greeting" | "conversing" | "ready" | "generating" | "done";

interface AIGenerateSequenceDialogProps {
    clientId: string;
    variant?: "default" | "hero";
}

const QUICK_CHIPS = [
    { label: "Use all channels", icon: Zap },
    { label: "SMS + Voice only", icon: Phone },
    { label: "Email only", icon: Mail },
    { label: "High urgency", icon: Clock },
    { label: "Spread over a week", icon: Clock },
    { label: "Book appointments", icon: Target },
];

const MAX_MESSAGES = 20;

export function AIGenerateSequenceDialog({
    clientId,
    variant = "default",
}: AIGenerateSequenceDialogProps) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [phase, setPhase] = useState<Phase>("idle");
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [plan, setPlan] = useState<ConversationPlan | null>(null);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    useEffect(() => {
        if (phase === "conversing" && !loading) {
            inputRef.current?.focus();
        }
    }, [phase, loading]);

    const handleOpen = async () => {
        setIsOpen(true);
        setPhase("greeting");
        setMessages([]);
        setPlan(null);
        setError("");
        setInput("");
        setLoading(true);

        const res = await startAIConversation(clientId);
        if (res.success && res.messages && res.systemPrompt) {
            setMessages(res.messages);
            setSystemPrompt(res.systemPrompt);
            setPhase("conversing");
        } else {
            setError(res.error || "Failed to start conversation");
            setPhase("idle");
        }
        setLoading(false);
    };

    const handleClose = () => {
        setIsOpen(false);
        setPhase("idle");
        setMessages([]);
        setPlan(null);
        setError("");
        setInput("");
    };

    const handleSend = async (text?: string) => {
        const msg = (text || input).trim();
        if (!msg || loading) return;
        setInput("");
        setError("");

        // Check message limit
        if (messages.length >= MAX_MESSAGES) {
            setError("Maximum conversation length reached. Please generate or start over.");
            return;
        }

        setLoading(true);

        const res = await sendConversationMessage(systemPrompt, messages, msg);
        if (res.success && res.messages) {
            setMessages(res.messages);
            if (res.phase === "ready" && res.plan) {
                setPlan(res.plan);
                setPhase("ready");
            }
        } else {
            setError(res.error || "Failed to send message");
            // Still add user message to show it was sent
            setMessages((prev) => [...prev, { role: "user", content: msg }]);
        }
        setLoading(false);
    };

    const handleGenerate = async () => {
        if (!plan) return;
        setPhase("generating");
        setError("");
        setLoading(true);

        const res = await confirmAndGenerate(clientId, plan, messages, systemPrompt);
        if (res.success && res.sequenceId) {
            setPhase("done");
            setTimeout(() => {
                handleClose();
                router.push(`/client/${clientId}/sequences/${res.sequenceId}`);
            }, 500);
        } else {
            setError(res.error || "Failed to generate sequence");
            setPhase("ready");
        }
        setLoading(false);
    };

    const handleRefine = () => {
        setPlan(null);
        setPhase("conversing");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const CHANNEL_LABELS: Record<string, string> = {
        sms: "SMS",
        email: "Email",
        voice: "Phone Call",
    };

    const TRIGGER_LABELS: Record<string, string> = {
        new_lead: "New Lead",
        missed_call: "Missed Call",
        form_submission: "Form Submission",
        manual: "Manual",
        tag_added: "Tag Added",
        status_change: "Status Change",
        schedule: "Schedule",
    };

    // Trigger button
    const renderTrigger = () => {
        if (variant === "hero") {
            return (
                <button
                    onClick={handleOpen}
                    className="bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 text-white px-6 py-3 rounded-xl flex items-center gap-3 transition-all text-base font-semibold shadow-lg shadow-emerald-200 hover:shadow-emerald-300"
                >
                    <Sparkles className="w-5 h-5" />
                    Describe Your First Sequence
                </button>
            );
        }

        return (
            <button
                onClick={handleOpen}
                className="bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium shadow-sm"
            >
                <Sparkles className="w-4 h-4" />
                Generate with AI
            </button>
        );
    };

    return (
        <>
            {renderTrigger()}

            <AnimatePresence>
                {isOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-emerald-100 rounded-lg">
                                        <Sparkles className="w-4 h-4 text-emerald-600" />
                                    </div>
                                    <h2 className="text-lg font-semibold text-gray-900">
                                        Create Sequence with AI
                                    </h2>
                                </div>
                                <button
                                    onClick={handleClose}
                                    className="text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Chat Messages */}
                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
                                {phase === "greeting" && loading && (
                                    <div className="flex items-center gap-3 text-gray-500">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm">Starting conversation...</span>
                                    </div>
                                )}

                                <AnimatePresence mode="popLayout">
                                    {messages.map((msg, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                                        >
                                            {msg.role === "assistant" && (
                                                <div className="flex gap-3 max-w-[85%]">
                                                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center mt-1">
                                                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                                    </div>
                                                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                                                        {msg.content}
                                                    </div>
                                                </div>
                                            )}
                                            {msg.role === "user" && (
                                                <div className="max-w-[75%] bg-gray-100 rounded-xl rounded-tr-sm px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                                                    {msg.content}
                                                </div>
                                            )}
                                        </motion.div>
                                    ))}
                                </AnimatePresence>

                                {/* Loading indicator for AI response */}
                                {loading && phase === "conversing" && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex gap-3"
                                    >
                                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                                            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                        </div>
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl rounded-tl-sm px-4 py-3">
                                            <div className="flex gap-1">
                                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {/* Plan Preview */}
                                {phase === "ready" && plan && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="bg-gradient-to-br from-emerald-50 to-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-4"
                                    >
                                        <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                                            <Wand2 className="w-4 h-4" />
                                            Ready to Generate
                                        </div>
                                        <p className="text-sm text-gray-700">{plan.summary}</p>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-white/80 rounded-lg p-3 border border-emerald-100">
                                                <p className="text-xs text-gray-500 mb-1">Trigger</p>
                                                <p className="text-sm font-medium text-gray-900">
                                                    {TRIGGER_LABELS[plan.trigger_type] || plan.trigger_type}
                                                </p>
                                            </div>
                                            <div className="bg-white/80 rounded-lg p-3 border border-emerald-100">
                                                <p className="text-xs text-gray-500 mb-1">Urgency</p>
                                                <p className="text-sm font-medium text-gray-900 capitalize">
                                                    {plan.urgency_tier}
                                                </p>
                                            </div>
                                            <div className="bg-white/80 rounded-lg p-3 border border-emerald-100">
                                                <p className="text-xs text-gray-500 mb-1">Channels</p>
                                                <p className="text-sm font-medium text-gray-900">
                                                    {plan.channels.map((c) => CHANNEL_LABELS[c] || c).join(", ")}
                                                </p>
                                            </div>
                                            <div className="bg-white/80 rounded-lg p-3 border border-emerald-100">
                                                <p className="text-xs text-gray-500 mb-1">Steps</p>
                                                <p className="text-sm font-medium text-gray-900">
                                                    ~{plan.step_count} steps
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 pt-1">
                                            <button
                                                onClick={handleGenerate}
                                                disabled={loading}
                                                className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all text-sm font-medium shadow-sm"
                                            >
                                                {loading ? (
                                                    <>
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        Generating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Wand2 className="w-4 h-4" />
                                                        Generate Sequence
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={handleRefine}
                                                disabled={loading}
                                                className="px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors flex items-center gap-2"
                                            >
                                                <ArrowLeft className="w-4 h-4" />
                                                Refine
                                            </button>
                                        </div>
                                    </motion.div>
                                )}

                                {/* Generating state */}
                                {phase === "generating" && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex flex-col items-center gap-3 py-6"
                                    >
                                        <div className="p-3 bg-emerald-100 rounded-full">
                                            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                                        </div>
                                        <p className="text-sm text-gray-600">Building your sequence...</p>
                                    </motion.div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="px-6 py-2 flex-shrink-0">
                                    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                        {error}
                                    </p>
                                </div>
                            )}

                            {/* Quick Action Chips + Input */}
                            {(phase === "conversing" || (phase === "ready" && !plan)) && (
                                <div className="border-t border-gray-100 flex-shrink-0">
                                    {/* Quick chips */}
                                    <div className="px-6 pt-3 pb-1 flex flex-wrap gap-2">
                                        {QUICK_CHIPS.map((chip) => (
                                            <button
                                                key={chip.label}
                                                onClick={() => handleSend(chip.label)}
                                                disabled={loading}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full transition-colors disabled:opacity-50"
                                            >
                                                <chip.icon className="w-3 h-3" />
                                                {chip.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Input */}
                                    <div className="px-6 pb-4 pt-2">
                                        <div className="flex items-end gap-2">
                                            <textarea
                                                ref={inputRef}
                                                value={input}
                                                onChange={(e) => setInput(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                placeholder="Describe what you need..."
                                                rows={1}
                                                className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                                            />
                                            <button
                                                onClick={() => handleSend()}
                                                disabled={!input.trim() || loading}
                                                className="p-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
                                            >
                                                {loading ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Send className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1.5">
                                            Press Enter to send, Shift+Enter for new line
                                        </p>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}
