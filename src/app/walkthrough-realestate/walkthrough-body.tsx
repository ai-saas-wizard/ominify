"use client";

import { motion } from "framer-motion";
import Image from "next/image";

export function WalkthroughBody() {
    return (
        <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
            {/* Background — animated gradient orbs */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <motion.div
                    aria-hidden
                    className="absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-emerald-500/30 blur-[120px]"
                    animate={{
                        x: [0, 80, -40, 0],
                        y: [0, 60, 30, 0],
                        scale: [1, 1.1, 0.95, 1],
                    }}
                    transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                    aria-hidden
                    className="absolute top-1/3 -right-32 h-[32rem] w-[32rem] rounded-full bg-sky-500/30 blur-[120px]"
                    animate={{
                        x: [0, -70, 40, 0],
                        y: [0, 50, -30, 0],
                        scale: [1, 0.95, 1.1, 1],
                    }}
                    transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                    aria-hidden
                    className="absolute -bottom-40 left-1/4 h-[34rem] w-[34rem] rounded-full bg-blue-600/25 blur-[120px]"
                    animate={{
                        x: [0, 60, -50, 0],
                        y: [0, -40, 20, 0],
                        scale: [1, 1.05, 0.9, 1],
                    }}
                    transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
                />
            </div>

            {/* Subtle grid overlay */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.07]"
                style={{
                    backgroundImage:
                        "linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)",
                    backgroundSize: "56px 56px",
                    maskImage:
                        "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
                    WebkitMaskImage:
                        "radial-gradient(ellipse 80% 60% at 50% 40%, black 40%, transparent 100%)",
                }}
            />

            {/* Vignette to keep video readable */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/80"
            />

            {/* Foreground content */}
            <div className="relative z-10 flex min-h-screen flex-col">
                {/* Header */}
                <motion.header
                    initial={{ opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="flex items-center justify-between px-6 py-5 sm:px-10"
                >
                    <div className="flex items-center gap-2.5">
                        <Image
                            src="/omnify-logo.png"
                            alt="Omnify"
                            width={32}
                            height={32}
                            className="rounded-md ring-1 ring-white/10"
                        />
                        <span className="text-base font-semibold tracking-tight">
                            Omnify
                        </span>
                    </div>
                    <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur sm:flex">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        </span>
                        Live Walkthrough
                    </div>
                </motion.header>

                {/* Hero + video */}
                <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-4 sm:px-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
                        className="mb-8 flex flex-col items-center text-center"
                    >
                        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Real Estate Edition
                        </span>
                        <h1 className="bg-gradient-to-br from-white via-white to-white/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl md:text-5xl">
                            The Omnify Walkthrough
                        </h1>
                        <p className="mt-3 max-w-xl text-sm text-white/60 sm:text-base">
                            From signup to a live AI agent — see how the entire platform
                            comes together in under 15 minutes.
                        </p>
                    </motion.div>

                    {/* Video frame */}
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
                        className="relative w-full max-w-6xl"
                    >
                        {/* Glow */}
                        <div
                            aria-hidden
                            className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-emerald-500/40 via-sky-500/40 to-blue-600/40 opacity-50 blur-2xl"
                        />
                        {/* Frame */}
                        <div className="relative rounded-2xl border border-white/10 bg-black/40 p-2 shadow-2xl backdrop-blur">
                            <iframe
                                src="https://www.youtube.com/embed/AG4ZAVOblNA?rel=0"
                                title="Omnify Walkthrough — Real Estate"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                className="aspect-video w-full rounded-xl bg-black"
                            />
                        </div>
                    </motion.div>

                    {/* Footer line */}
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.8, delay: 0.6 }}
                        className="mt-10 text-xs text-white/40"
                    >
                        © {new Date().getFullYear()} Omnify · Built by Elevate With AI
                    </motion.p>
                </div>
            </div>
        </main>
    );
}
