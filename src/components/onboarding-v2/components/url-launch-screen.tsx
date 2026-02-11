"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Globe, Rocket, Sparkles, Clock, CreditCard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface UrlLaunchScreenProps {
    onLaunch: (url: string) => void;
    launching: boolean;
}

export function UrlLaunchScreen({ onLaunch, launching }: UrlLaunchScreenProps) {
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = useCallback(() => {
        setError(null);

        let finalUrl = url.trim();
        if (!finalUrl) {
            setError("Please enter your website URL");
            return;
        }

        // Auto-prepend https:// if missing
        if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
            finalUrl = `https://${finalUrl}`;
        }

        // Validate URL
        try {
            new URL(finalUrl);
        } catch {
            setError("Please enter a valid website URL");
            return;
        }

        onLaunch(finalUrl);
    }, [url, onLaunch]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && !launching) {
                handleSubmit();
            }
        },
        [handleSubmit, launching]
    );

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-4">
            {/* Floating sparkle accents */}
            <motion.div
                className="pointer-events-none absolute inset-0 overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
            >
                <div className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-violet-500/5 blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 h-64 w-64 rounded-full bg-violet-500/5 blur-3xl" />
            </motion.div>

            {/* Main content */}
            <motion.div
                className="relative z-10 flex w-full max-w-lg flex-col items-center gap-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
            >
                {/* Icon */}
                <motion.div
                    className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                >
                    <Sparkles className="h-8 w-8 text-violet-400" />
                </motion.div>

                {/* Headline */}
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                        Let&apos;s build your AI call center
                    </h1>
                    <p className="mt-3 text-lg text-zinc-400">
                        Paste your website URL. We&apos;ll handle the rest.
                    </p>
                </div>

                {/* URL Input */}
                <div className="w-full space-y-3">
                    <div className="relative">
                        <Globe className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
                        <Input
                            type="url"
                            placeholder="www.yourbusiness.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={launching}
                            className="h-14 border-zinc-700 bg-zinc-800/50 pl-12 text-lg text-white placeholder:text-zinc-500 focus:border-violet-500 focus:ring-violet-500/20"
                        />
                    </div>
                    {error && (
                        <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-sm text-red-400"
                        >
                            {error}
                        </motion.p>
                    )}
                    <Button
                        onClick={handleSubmit}
                        disabled={launching || !url.trim()}
                        className="h-14 w-full bg-violet-600 text-lg font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                        {launching ? (
                            <motion.div
                                className="flex items-center gap-2"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                            >
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                Analyzing...
                            </motion.div>
                        ) : (
                            <span className="flex items-center gap-2">
                                <Rocket className="h-5 w-5" />
                                Launch
                            </span>
                        )}
                    </Button>
                </div>

                {/* Trust badges */}
                <motion.div
                    className="flex flex-wrap items-center justify-center gap-4 text-sm text-zinc-500"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                >
                    <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        Fully automated
                    </span>
                    <span className="text-zinc-700">|</span>
                    <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Under 5 minutes
                    </span>
                    <span className="text-zinc-700">|</span>
                    <span className="flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5" />
                        No credit card
                    </span>
                </motion.div>
            </motion.div>
        </div>
    );
}
