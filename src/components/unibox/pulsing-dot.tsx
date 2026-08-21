"use client";

import { cn } from "@/lib/utils";

export function PulsingDot({ className }: { className?: string }) {
    return (
        <span className={cn("relative flex h-2.5 w-2.5", className)}>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
    );
}
