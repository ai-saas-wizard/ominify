"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Bot, User, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "../types";

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    sending: boolean;
    focusedAgentName?: string;
}

export function ChatPanel({
    isOpen,
    onClose,
    messages,
    onSendMessage,
    sending,
    focusedAgentName,
}: ChatPanelProps) {
    const [input, setInput] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Focus input when panel opens or agent changes
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen, focusedAgentName]);

    const handleSend = useCallback(() => {
        const trimmed = input.trim();
        if (!trimmed || sending) return;
        onSendMessage(trimmed);
        setInput("");
    }, [input, sending, onSendMessage]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend]
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        className="fixed inset-0 z-40 bg-black/40"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-zinc-900 shadow-2xl sm:w-[420px]"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "spring", damping: 25, stiffness: 200 }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                            <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                                    <Bot className="h-4 w-4 text-violet-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-white">
                                        AI Setup Assistant
                                    </h3>
                                    {focusedAgentName && (
                                        <p className="text-[11px] text-zinc-500">
                                            Focused on: {focusedAgentName}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-4 py-4">
                            <div className="space-y-4">
                                {/* Welcome message if no messages */}
                                {messages.length === 0 && (
                                    <div className="rounded-lg bg-zinc-800/50 p-3 text-sm text-zinc-400">
                                        I&apos;ve analyzed your business and set up your agent
                                        fleet. What would you like to change?
                                    </div>
                                )}

                                {messages.map((msg, idx) => (
                                    <MessageBubble key={idx} message={msg} />
                                ))}

                                {sending && (
                                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Thinking...
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Input */}
                        <div className="border-t border-zinc-800 px-4 py-3">
                            <div className="flex gap-2">
                                <Input
                                    ref={inputRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={
                                        focusedAgentName
                                            ? `Customize ${focusedAgentName}...`
                                            : "Ask me anything about your agents..."
                                    }
                                    disabled={sending}
                                    className="border-zinc-700 bg-zinc-800/50 text-white placeholder:text-zinc-500"
                                />
                                <Button
                                    onClick={handleSend}
                                    disabled={sending || !input.trim()}
                                    size="icon"
                                    className="bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

function MessageBubble({ message }: { message: ChatMessage }) {
    const isUser = message.role === "user";

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}
        >
            <div
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    isUser ? "bg-zinc-700" : "bg-violet-500/10"
                }`}
            >
                {isUser ? (
                    <User className="h-3.5 w-3.5 text-zinc-300" />
                ) : (
                    <Bot className="h-3.5 w-3.5 text-violet-400" />
                )}
            </div>
            <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    isUser
                        ? "bg-violet-600 text-white"
                        : "bg-zinc-800 text-zinc-200"
                }`}
            >
                {message.content}
                {message.function_calls && message.function_calls.length > 0 && (
                    <div className="mt-2 border-t border-zinc-700/50 pt-2">
                        {message.function_calls.map((fc, i) => (
                            <span
                                key={i}
                                className="text-[10px] text-zinc-500"
                            >
                                {fc.function_name}: {fc.result}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
