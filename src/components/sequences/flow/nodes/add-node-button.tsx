"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { motion } from "framer-motion";

export function AddNodeButton({ data }: NodeProps) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            className="relative"
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !-top-1.5"
            />

            <div className="flex items-center justify-center w-12 h-12 rounded-full border-2 border-dashed border-gray-300 bg-white hover:border-emerald-400 hover:bg-emerald-50 transition-all cursor-pointer group shadow-sm">
                <Plus className="w-5 h-5 text-gray-400 group-hover:text-emerald-600 transition-colors" />
            </div>
        </motion.div>
    );
}
