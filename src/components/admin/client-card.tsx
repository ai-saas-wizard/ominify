"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

export function ClientCard({
    children,
    index = 0,
    disabled = false,
    archived = false,
    variant = "default",
}: {
    children: ReactNode;
    index?: number;
    disabled?: boolean;
    archived?: boolean;
    variant?: "umbrella" | "custom" | "default";
}) {
    // Archived reads as "put away", so it mutes the card even when the account
    // itself is still enabled. Disabled keeps its louder red treatment on top.
    const borderColor = disabled
        ? "border-red-200"
        : archived
            ? "border-gray-200"
            : variant === "umbrella"
                ? "border-emerald-100"
                : "border-gray-200";

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05, ease: "easeOut" }}
            whileHover={{ y: -2, boxShadow: "0 8px 25px -5px rgba(0, 0, 0, 0.08)" }}
            className={`bg-white border ${borderColor} rounded-xl p-5 shadow-sm transition-colors relative overflow-hidden ${disabled || archived ? "opacity-70" : ""}`}
        >
            {(disabled || archived) && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={
                        disabled
                            ? "absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 via-red-500 to-red-400"
                            : "absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gray-300 via-gray-400 to-gray-300"
                    }
                />
            )}
            {children}
        </motion.div>
    );
}
