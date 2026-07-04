"use client";

import {
    BaseEdge,
    getSmoothStepPath,
    type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function FlowEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
    label,
    labelStyle,
}: EdgeProps) {
    const [hovered, setHovered] = useState(false);

    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 16,
    });

    const showAddButton = data?.insertIndex !== undefined;

    return (
        <g
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <BaseEdge
                path={edgePath}
                style={{
                    strokeWidth: 1.5,
                    stroke: "#d1d5db",
                    ...style,
                }}
            />

            {/* Invisible wider path for easier hover */}
            <path
                d={edgePath}
                fill="none"
                strokeWidth={20}
                stroke="transparent"
            />

            {/* Label (for condition branches) */}
            {label && (
                <text
                    x={labelX}
                    y={labelY - 10}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        ...labelStyle,
                    }}
                >
                    {label as string}
                </text>
            )}

            {/* Add button at midpoint */}
            {showAddButton && (
                <foreignObject
                    x={labelX - 12}
                    y={labelY - 12}
                    width={24}
                    height={24}
                    className="overflow-visible"
                >
                    <AnimatePresence>
                        {hovered && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15 }}
                                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700"
                                data-add-index={data.insertIndex}
                            >
                                <Plus className="w-3.5 h-3.5" />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </foreignObject>
            )}
        </g>
    );
}
