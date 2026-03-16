"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Sparkles, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { DELAY_LABELS, FLOW_NODE_WIDTH } from "../utils/constants";

interface BaseFlowNodeProps {
    icon: LucideIcon;
    label: string;
    accentColor: string;
    bgColor: string;
    textColor: string;
    selected?: boolean;
    hasTarget?: boolean;
    hasSource?: boolean;
    sourceHandleId?: string;
    delay?: string;
    aiMutationEnabled?: boolean;
    children?: React.ReactNode;
    onClick?: () => void;
}

export function BaseFlowNode({
    icon: Icon,
    label,
    accentColor,
    bgColor,
    textColor,
    selected,
    hasTarget = true,
    hasSource = true,
    sourceHandleId,
    delay,
    aiMutationEnabled,
    children,
    onClick,
}: BaseFlowNodeProps) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            onClick={onClick}
            className={cn(
                "relative bg-white rounded-xl border shadow-sm cursor-pointer transition-all hover:shadow-md",
                selected && "ring-2 ring-violet-500 ring-offset-2",
            )}
            style={{ width: FLOW_NODE_WIDTH }}
        >
            {/* Colored accent bar */}
            <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-xl", accentColor)} />

            {/* Target handle (top) */}
            {hasTarget && (
                <Handle
                    type="target"
                    position={Position.Top}
                    className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !-top-1.5"
                />
            )}

            {/* Content */}
            <div className="pl-4 pr-3 py-3">
                {/* Header row */}
                <div className="flex items-center gap-2 mb-1">
                    <div className={cn("flex items-center justify-center w-6 h-6 rounded-md", bgColor)}>
                        <Icon className={cn("w-3.5 h-3.5", textColor)} />
                    </div>
                    <span className={cn("text-xs font-semibold", textColor)}>{label}</span>
                    {delay && (
                        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                            {delay}
                        </Badge>
                    )}
                    {aiMutationEnabled && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-violet-100">
                                        <Sparkles className="w-3 h-3 text-violet-600" />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>AI Mutation enabled</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>

                {/* Body */}
                {children && <div className="mt-1">{children}</div>}
            </div>

            {/* Source handle (bottom) */}
            {hasSource && (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    id={sourceHandleId}
                    className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !-bottom-1.5"
                />
            )}
        </motion.div>
    );
}

export function formatStepDelay(step: any): string {
    if (step.delay_type === "immediate") return "Immediately";
    if (step.delay_amount && step.delay_unit) {
        return `${step.delay_amount} ${step.delay_unit}`;
    }
    return DELAY_LABELS[step.delay_type] || "";
}
