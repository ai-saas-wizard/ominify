"use client";

import { useDroppable } from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { PipelineContactCard } from "./pipeline-contact-card";
import type { PipelineStage, PipelineContact } from "./pipeline-board";

const cardListVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.04, delayChildren: 0.05 },
    },
};

const cardItemVariants = {
    hidden: { opacity: 0, y: 12, scale: 0.97 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring" as const, stiffness: 320, damping: 24 },
    },
};

export function PipelineColumn({
    stage,
    contacts,
    isOver,
    onContactClick,
}: {
    stage: PipelineStage;
    contacts: PipelineContact[];
    isOver: boolean;
    onContactClick: (contact: PipelineContact) => void;
}) {
    const { setNodeRef, isOver: isDirectlyOver } = useDroppable({
        id: stage.id,
    });

    const highlighted = isOver || isDirectlyOver;

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "flex flex-col w-[300px] h-full rounded-xl transition-all duration-200",
                "bg-gray-50/80 border border-gray-200/60",
                highlighted && "bg-violet-50/60 border-violet-300/60 ring-2 ring-violet-200/40"
            )}
        >
            {/* Column Header */}
            <div className="px-3.5 pt-3.5 pb-2 flex-shrink-0">
                <div className="flex items-center gap-2.5 mb-1">
                    {/* Color dot */}
                    <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm"
                        style={{ backgroundColor: stage.color }}
                    />
                    <h3 className="text-sm font-semibold text-gray-800 truncate">{stage.name}</h3>
                    <span
                        className={cn(
                            "ml-auto text-xs font-medium px-2 py-0.5 rounded-full tabular-nums flex-shrink-0",
                            contacts.length > 0
                                ? "bg-white text-gray-700 shadow-sm border border-gray-200/80"
                                : "text-gray-400"
                        )}
                    >
                        {contacts.length}
                    </span>
                </div>

                {/* Thin color bar */}
                <div
                    className="h-0.5 rounded-full mt-2 opacity-40"
                    style={{ backgroundColor: stage.color }}
                />
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 scrollbar-thin scrollbar-thumb-gray-200 hover:scrollbar-thumb-gray-300">
                {contacts.length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-xs text-gray-400 italic">
                        Drop leads here
                    </div>
                ) : (
                    <motion.div
                        initial="hidden"
                        animate="visible"
                        variants={cardListVariants}
                        className="space-y-2 pt-1"
                    >
                        <AnimatePresence mode="popLayout">
                            {contacts.map((contact) => (
                                <motion.div
                                    key={contact.id}
                                    variants={cardItemVariants}
                                    layout
                                    layoutId={contact.id}
                                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                                >
                                    <PipelineContactCard
                                        contact={contact}
                                        onClick={() => onContactClick(contact)}
                                    />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
