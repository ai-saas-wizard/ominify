"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BaseFlowNode, formatStepDelay } from "./base-flow-node";
import { CHANNEL_FLOW_CONFIG, FLOW_NODE_WIDTH } from "../utils/constants";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { MessageSquare, Mail, Phone, Clock, GitBranch } from "lucide-react";

// SMS Node
export function SmsNode({ data, selected }: NodeProps) {
    const step = data.step as any;
    const config = CHANNEL_FLOW_CONFIG.sms;

    return (
        <BaseFlowNode
            icon={config.icon}
            label={config.label}
            accentColor={config.accentColor}
            bgColor={config.bgColor}
            textColor={config.textColor}
            selected={selected}
            delay={formatStepDelay(step)}
            aiMutationEnabled={step.enable_ai_mutation}
        >
            {step.content && (
                <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                    {typeof step.content === "string" ? step.content : JSON.stringify(step.content)}
                </p>
            )}
        </BaseFlowNode>
    );
}

// Email Node
export function EmailNode({ data, selected }: NodeProps) {
    const step = data.step as any;
    const config = CHANNEL_FLOW_CONFIG.email;

    return (
        <BaseFlowNode
            icon={config.icon}
            label={config.label}
            accentColor={config.accentColor}
            bgColor={config.bgColor}
            textColor={config.textColor}
            selected={selected}
            delay={formatStepDelay(step)}
            aiMutationEnabled={step.enable_ai_mutation}
        >
            {step.subject_line && (
                <p className="text-xs font-medium text-gray-700 truncate">
                    {step.subject_line}
                </p>
            )}
            {step.content && (
                <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">
                    {typeof step.content === "string" ? step.content : JSON.stringify(step.content)}
                </p>
            )}
        </BaseFlowNode>
    );
}

// Voice Node
export function VoiceNode({ data, selected }: NodeProps) {
    const step = data.step as any;
    const config = CHANNEL_FLOW_CONFIG.voice_call;

    return (
        <BaseFlowNode
            icon={config.icon}
            label={config.label}
            accentColor={config.accentColor}
            bgColor={config.bgColor}
            textColor={config.textColor}
            selected={selected}
            delay={formatStepDelay(step)}
            aiMutationEnabled={step.enable_ai_mutation}
        >
            {(step.system_prompt || step.content) && (
                <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                    {step.system_prompt || (typeof step.content === "string" ? step.content : JSON.stringify(step.content))}
                </p>
            )}
        </BaseFlowNode>
    );
}

// Wait Node
export function WaitNode({ data, selected }: NodeProps) {
    const step = data.step as any;
    const config = CHANNEL_FLOW_CONFIG.wait;
    const delay = formatStepDelay(step);

    return (
        <BaseFlowNode
            icon={config.icon}
            label={config.label}
            accentColor={config.accentColor}
            bgColor={config.bgColor}
            textColor={config.textColor}
            selected={selected}
        >
            <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-700">
                    {delay || "Configure delay"}
                </span>
            </div>
        </BaseFlowNode>
    );
}

// Condition Node (two source handles)
export function ConditionNode({ data, selected }: NodeProps) {
    const step = data.step as any;
    const config = CHANNEL_FLOW_CONFIG.condition;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className={cn(
                "relative cursor-pointer rounded-xl border border-gray-200 bg-white shadow-none transition-[border-color,box-shadow] duration-150 hover:border-gray-300 hover:shadow-sm",
                selected && "border-emerald-600 ring-1 ring-emerald-600",
            )}
            style={{ width: FLOW_NODE_WIDTH }}
        >
            {/* Neutral accent */}
            <div className="absolute bottom-0 left-0 top-0 w-1 rounded-l-xl bg-gray-300" />

            {/* Target handle */}
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !-top-1.5"
            />

            {/* Content */}
            <div className="py-3 pl-4 pr-3">
                <div className="mb-1 flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-50">
                        <GitBranch className="h-3.5 w-3.5 text-gray-500" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700">{config.label}</span>
                </div>
                {step.content && (
                    <p className="line-clamp-2 text-xs text-gray-600">
                        {typeof step.content === "string" ? step.content : "Condition check"}
                    </p>
                )}

                {/* Branch labels */}
                <div className="mt-2 flex items-center justify-between px-1">
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        True
                    </span>
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        False
                    </span>
                </div>
            </div>

            {/* Two source handles */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="true"
                className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white !-bottom-1.5"
                style={{ left: "30%" }}
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="false"
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white !-bottom-1.5"
                style={{ left: "70%" }}
            />
        </motion.div>
    );
}
