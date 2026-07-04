"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { TRIGGER_FLOW_CONFIG, FLOW_NODE_WIDTH } from "../utils/constants";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

export function TriggerNode({ data }: NodeProps) {
    const config = TRIGGER_FLOW_CONFIG[data.triggerType as string] || TRIGGER_FLOW_CONFIG.manual;
    const Icon = config.icon;

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="relative"
            style={{ width: FLOW_NODE_WIDTH }}
        >
            <div className="rounded-xl bg-gray-900 px-4 py-3.5 text-white shadow-sm">
                <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                        <Icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                            Trigger
                        </p>
                        <p className="text-sm font-semibold">{config.label}</p>
                    </div>
                </div>
            </div>

            {/* Source handle only */}
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white !-bottom-1.5"
            />
        </motion.div>
    );
}

// End node (terminal)
export function EndNode({ data }: NodeProps) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative"
        >
            <div className="rounded-full border border-gray-200 bg-gray-50 px-5 py-2">
                <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    <span className="text-xs font-medium text-gray-500">End</span>
                </div>
            </div>

            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !-top-1.5"
            />
        </motion.div>
    );
}
