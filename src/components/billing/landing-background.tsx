"use client";

import { motion } from "framer-motion";

/**
 * Dark brand background, three radial color blooms (emerald / sky / blue),
 * a subtle dot grid, and a vignette gradient. Matches the marketing site's
 * walkthrough aesthetic. Pure decoration, pointer-events-none everywhere.
 */
export function LandingBackground() {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Top-left emerald bloom */}
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="absolute -top-48 -left-48 h-[36rem] w-[36rem] rounded-full bg-emerald-500/30 blur-[120px]"
            />
            {/* Right-side sky bloom */}
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.9, scale: 1 }}
                transition={{ duration: 1.4, delay: 0.15, ease: "easeOut" }}
                className="absolute top-1/3 -right-32 h-[32rem] w-[32rem] rounded-full bg-sky-500/25 blur-[120px]"
            />
            {/* Bottom blue bloom */}
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.8, scale: 1 }}
                transition={{ duration: 1.6, delay: 0.3, ease: "easeOut" }}
                className="absolute -bottom-48 left-1/4 h-[34rem] w-[34rem] rounded-full bg-blue-600/20 blur-[120px]"
            />

            {/* Subtle dot grid */}
            <div
                className="absolute inset-0 opacity-[0.07]"
                style={{
                    backgroundImage:
                        "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)",
                    backgroundSize: "56px 56px",
                }}
            />

            {/* Vignette */}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/80" />
        </div>
    );
}

/**
 * A small "live" status pill, emerald dot with a ping animation. Useful to
 * pair with hero copy ("real-time pricing", "live", "active offer").
 */
export function LiveDot({ label = "Live" }: { label?: string }) {
    return (
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium tracking-wider text-emerald-300 uppercase">
            <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {label}
        </span>
    );
}
