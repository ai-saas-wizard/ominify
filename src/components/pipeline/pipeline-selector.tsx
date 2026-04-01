"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Settings, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pipeline } from "@/types/pipeline";

export function PipelineSelector({
    currentPipeline,
    pipelines,
    clientId,
    onCreateClick,
    onSettingsClick,
}: {
    currentPipeline: Pipeline;
    pipelines: (Pipeline & { contact_count: number })[];
    clientId: string;
    onCreateClick: () => void;
    onSettingsClick: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const router = useRouter();

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (pipelineId: string) => {
        setOpen(false);
        if (pipelineId !== currentPipeline.id) {
            router.push(`/client/${clientId}/pipeline?pipeline=${pipelineId}`);
        }
    };

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-left",
                    "hover:bg-gray-100 border border-transparent",
                    open && "bg-gray-100 border-gray-200"
                )}
            >
                <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: currentPipeline.color }}
                />
                <span className="text-2xl font-bold text-gray-900 tracking-tight">
                    {currentPipeline.name}
                </span>
                <ChevronDown
                    className={cn(
                        "w-4 h-4 text-gray-400 transition-transform",
                        open && "rotate-180"
                    )}
                />
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
                    <div className="p-1.5 max-h-64 overflow-y-auto">
                        {pipelines.map((pipeline) => (
                            <button
                                key={pipeline.id}
                                onClick={() => handleSelect(pipeline.id)}
                                className={cn(
                                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors",
                                    pipeline.id === currentPipeline.id
                                        ? "bg-emerald-50"
                                        : "hover:bg-gray-50"
                                )}
                            >
                                <div
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: pipeline.color }}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">
                                        {pipeline.name}
                                    </p>
                                    {pipeline.description && (
                                        <p className="text-xs text-gray-500 truncate">{pipeline.description}</p>
                                    )}
                                </div>
                                <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
                                    {pipeline.contact_count}
                                </span>
                                {pipeline.id === currentPipeline.id && (
                                    <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="border-t border-gray-100 p-1.5 space-y-0.5">
                        <button
                            onClick={() => {
                                setOpen(false);
                                onCreateClick();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors"
                        >
                            <Plus className="w-4 h-4 text-emerald-600" />
                            <span className="text-sm font-medium text-emerald-600">Create Pipeline</span>
                        </button>
                        <button
                            onClick={() => {
                                setOpen(false);
                                onSettingsClick();
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors"
                        >
                            <Settings className="w-4 h-4 text-gray-500" />
                            <span className="text-sm text-gray-600">Pipeline Settings</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
