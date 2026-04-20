"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LoaderProps {
    size?: number;
    className?: string;
}

export function Loader({ size = 44, className }: LoaderProps) {
    const gradientId = useId();

    return (
        <div
            role="status"
            aria-label="Loading"
            className={cn("relative", className)}
            style={{ width: size, height: size }}
        >
            <div className="absolute inset-0 rounded-full border-2 border-foreground/[0.08]" />
            <motion.svg
                viewBox="0 0 40 40"
                className="absolute inset-0 text-foreground"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.85, ease: "linear", repeat: Infinity }}
            >
                <defs>
                    <linearGradient
                        id={gradientId}
                        gradientUnits="userSpaceOnUse"
                        x1="0"
                        y1="0"
                        x2="40"
                        y2="40"
                    >
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
                    </linearGradient>
                </defs>
                <circle
                    cx="20"
                    cy="20"
                    r="18"
                    fill="none"
                    stroke={`url(#${gradientId})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="45 200"
                />
            </motion.svg>
        </div>
    );
}
