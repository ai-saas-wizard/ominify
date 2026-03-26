"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

export function ClientCard({
    children,
    index = 0,
    disabled = false,
    variant = "default",
}: {
    children: ReactNode;
    index?: number;
    disabled?: boolean;
    variant?: "umbrella" | "custom" | "default";
}) {
    const borderColor = disabled
        ? "border-red-200"
        : variant === "umbrella"
            ? "border-emerald-100"
            : "border-gray-200";

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05, ease: "easeOut" }}
            whileHover={{ y: -2, boxShadow: "0 8px 25px -5px rgba(0, 0, 0, 0.08)" }}
            className={`bg-white border ${borderColor} rounded-xl p-5 shadow-sm transition-colors relative overflow-hidden ${disabled ? "opacity-70" : ""}`}
        >
            {disabled && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 via-red-500 to-red-400"
                />
            )}
            {children}
        </motion.div>
    );
}
