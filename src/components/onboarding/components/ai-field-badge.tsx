"use client";

import { motion } from "framer-motion";
import { Sparkles, RotateCcw } from "lucide-react";
import type { AIFieldMeta } from "../types";
import { Badge } from "@/components/ui/badge";

interface AIFieldBadgeProps {
    meta?: AIFieldMeta;
    onReset?: () => void;
}

const confidenceVariant: Record<string, "ai-high" | "ai-medium" | "ai-low"> = {
    high: "ai-high",
    medium: "ai-medium",
    low: "ai-low",
};

export function AIFieldBadge({ meta, onReset }: AIFieldBadgeProps) {
    if (!meta?.aiGenerated) return null;

    if (meta.userEdited) {
        return (
            <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px] py-0">
                    Edited
                </Badge>
                {onReset && (
                    <button
                        type="button"
                        onClick={onReset}
                        className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 transition-colors"
                        title="Restore AI suggestion"
                    >
                        <RotateCcw className="w-3 h-3" />
                        Restore
                    </button>
                )}
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
        >
            <Badge variant={confidenceVariant[meta.confidence]} className="text-[10px] py-0 gap-1">
                <Sparkles className="w-3 h-3" />
                AI Suggested
            </Badge>
        </motion.div>
    );
}
