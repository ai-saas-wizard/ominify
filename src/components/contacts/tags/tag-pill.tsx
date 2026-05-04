"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Tag {
    id: string;
    name: string;
    color: string | null;
}

interface TagPillProps {
    tag: Tag;
    onRemove?: () => void;
    size?: "sm" | "md";
}

// Small color-coded pill. Uses the tag's color when available; falls back to
// indigo. Hex colors get a subtle background tint to keep the text readable.
export function TagPill({ tag, onRemove, size = "sm" }: TagPillProps) {
    const palette = colorToPalette(tag.color);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border font-medium",
                size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
                palette.bg,
                palette.text,
                palette.border,
            )}
        >
            <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tag.color || "#6366f1" }}
            />
            {tag.name}
            {onRemove && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-black/5"
                    aria-label={`Remove tag ${tag.name}`}
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </span>
    );
}

function colorToPalette(color: string | null): {
    bg: string;
    text: string;
    border: string;
} {
    if (!color) {
        return {
            bg: "bg-indigo-50",
            text: "text-indigo-700",
            border: "border-indigo-100",
        };
    }
    return {
        bg: "bg-gray-50",
        text: "text-gray-700",
        border: "border-gray-200",
    };
}
