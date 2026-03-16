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
            <div className="bg-gradient-to-br from-violet-500 to-violet-600 rounded-xl shadow-lg px-4 py-3.5 text-white">
                <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm">
                        <Icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                        <p className="text-[10px] font-medium text-violet-200 uppercase tracking-wider">
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
                className="!w-3 !h-3 !bg-violet-400 !border-2 !border-white !-bottom-1.5"
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
            <div className="bg-gray-100 rounded-full px-5 py-2 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
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
