"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Globe, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface AIUrlStepProps {
    initialUrl: string;
    onAnalyze: (url: string) => void;
    onSkip: () => void;
    analyzing: boolean;
}

export function AIUrlStep({ initialUrl, onAnalyze, onSkip, analyzing }: AIUrlStepProps) {
    const [url, setUrl] = useState(initialUrl || "");
    const [urlError, setUrlError] = useState<string | null>(null);

    const handleAnalyze = () => {
        setUrlError(null);

        let finalUrl = url.trim();
        if (!finalUrl) {
            setUrlError("Please enter a website URL");
            return;
        }

        // Auto-add https:// if missing
        if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
            finalUrl = `https://${finalUrl}`;
            setUrl(finalUrl);
        }

        try {
            new URL(finalUrl);
        } catch {
            setUrlError("Please enter a valid URL (e.g., https://www.yourcompany.com)");
            return;
        }

        onAnalyze(finalUrl);
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-lg"
            >
                <Card className="border-0 shadow-lg">
                    <CardContent className="pt-8 pb-8 px-8">
                        {/* Icon */}
                        <motion.div
                            className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-6"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                        >
                            <Sparkles className="w-8 h-8 text-violet-600" />
                        </motion.div>

                        {/* Title */}
                        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
                            Let AI set up your profile
                        </h2>
                        <p className="text-gray-500 text-center mb-8">
                            Enter your website URL and we&apos;ll auto-fill everything for you. You can review and edit any details afterward.
                        </p>

                        {/* URL Input */}
                        <div className="space-y-3">
                            <div className="relative">
                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input
                                    type="url"
                                    value={url}
                                    onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
                                    placeholder="https://www.yourcompany.com"
                                    className="pl-10 h-12 text-base"
                                    onKeyDown={(e) => { if (e.key === "Enter") handleAnalyze(); }}
                                    disabled={analyzing}
                                />
                            </div>
                            {urlError && (
                                <p className="text-sm text-red-600">{urlError}</p>
                            )}

                            <Button
                                onClick={handleAnalyze}
                                disabled={analyzing}
                                className="w-full h-12 text-base gap-2"
                            >
                                <Sparkles className="w-4 h-4" />
                                Analyze My Business
                            </Button>
                        </div>

                        {/* Divider */}
                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-200" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-3 text-gray-400">or</span>
                            </div>
                        </div>

                        {/* Skip */}
                        <button
                            type="button"
                            onClick={onSkip}
                            disabled={analyzing}
                            className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors py-2"
                        >
                            Skip and fill in manually
                            <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}
