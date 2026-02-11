"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "secondary" | "outline" | "ai-high" | "ai-medium" | "ai-low"
}

const badgeVariants = {
    default: "bg-violet-100 text-violet-700 border-violet-200",
    secondary: "bg-gray-100 text-gray-700 border-gray-200",
    outline: "border-gray-300 text-gray-600 bg-transparent",
    "ai-high": "bg-emerald-50 text-emerald-700 border-emerald-200",
    "ai-medium": "bg-amber-50 text-amber-700 border-amber-200",
    "ai-low": "bg-orange-50 text-orange-700 border-orange-200",
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
    return (
        <div
            className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                badgeVariants[variant],
                className
            )}
            {...props}
        />
    )
}

export { Badge }
