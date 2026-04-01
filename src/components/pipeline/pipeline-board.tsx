"use client";

import { useState, useCallback, useMemo } from "react";
import {
    DndContext,
    DragOverlay,
    DragStartEvent,
    DragEndEvent,
    DragOverEvent,
    PointerSensor,
    useSensor,
    useSensors,
    closestCenter,
} from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import {
    KanbanSquare,
    Settings2,
    Users,
    TrendingUp,
    Search,
    ArrowRight,
    BarChart3,
    CheckSquare,
    X,
    ArrowRightLeft,
    ListPlus,
    Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moveContactToStage, bulkMoveContactsToStage, bulkRemoveFromPipeline } from "@/app/actions/pipeline-actions";
import { evaluateStageRules, fireAutomations } from "@/app/actions/pipeline-rule-actions";
import { PipelineColumn } from "./pipeline-column";
import { PipelineContactCard } from "./pipeline-contact-card";
import { StageEditorDialog } from "./stage-editor-dialog";
import { PipelineSelector } from "./pipeline-selector";
import { CreatePipelineDialog } from "./create-pipeline-dialog";
import { PipelineSettingsDialog } from "./pipeline-settings-dialog";
import { ContactDetailModal } from "@/components/contacts/contact-detail-modal";
import type { Pipeline, PipelineStage, PipelineContact } from "@/types/pipeline";

// ─── Animation Variants ─────────────────────────────────────────────────────

const headerVariants = {
    hidden: { opacity: 0, y: -12 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 300, damping: 24 },
    },
};

const boardVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.08, delayChildren: 0.15 },
    },
};

const columnVariants = {
    hidden: { opacity: 0, y: 24, scale: 0.96 },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { type: "spring" as const, stiffness: 280, damping: 22 },
    },
};

const statVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: (i: number) => ({
        opacity: 1,
        scale: 1,
        transition: { delay: i * 0.06, type: "spring" as const, stiffness: 400, damping: 25 },
    }),
};

const emptyVariants = {
    hidden: { opacity: 0, scale: 0.9, y: 20 },
    visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 200, damping: 20, delay: 0.1 },
    },
};

// ─── Board Component ────────────────────────────────────────────────────────

export function PipelineBoard({
    clientId,
    pipelineId,
    currentPipeline,
    pipelines,
    initialStages,
    initialContacts,
}: {
    clientId: string;
    pipelineId: string;
    currentPipeline: Pipeline & { contact_count: number };
    pipelines: (Pipeline & { contact_count: number })[];
    initialStages: PipelineStage[];
    initialContacts: PipelineContact[];
}) {
    const [stages, setStages] = useState<PipelineStage[]>(initialStages);
    const [contacts, setContacts] = useState<PipelineContact[]>(initialContacts);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [selectedContact, setSelectedContact] = useState<PipelineContact | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    // Bulk selection state
    const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
    const [bulkMode, setBulkMode] = useState(false);
    const [bulkStageTarget, setBulkStageTarget] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    // Default stage for contacts with null stage_id
    const defaultStage = stages.find((s) => s.is_default);

    // Group contacts by stage
    const contactsByStage = useMemo(() => {
        const map: Record<string, PipelineContact[]> = {};
        for (const stage of stages) {
            map[stage.id] = [];
        }
        const filtered = searchQuery
            ? contacts.filter(
                (c) =>
                    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    c.phone.includes(searchQuery) ||
                    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
            )
            : contacts;
        for (const contact of filtered) {
            const stageId = contact.stage_id || defaultStage?.id;
            if (stageId && map[stageId]) {
                map[stageId].push(contact);
            } else if (defaultStage && map[defaultStage.id]) {
                map[defaultStage.id].push(contact);
            }
        }
        return map;
    }, [contacts, stages, defaultStage, searchQuery]);

    // Stats
    const totalContacts = contacts.length;
    const contactsWithStage = contacts.filter((c) => c.stage_id).length;
    const terminalContacts = contacts.filter((c) => {
        const stage = stages.find((s) => s.id === c.stage_id);
        return stage?.is_terminal;
    }).length;

    // ─── DnD handlers ──────────────────────────────────────────────────────

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    }, []);

    const handleDragOver = useCallback((event: DragOverEvent) => {
        setOverId(event.over?.id as string ?? null);
    }, []);

    const handleDragEnd = useCallback(
        async (event: DragEndEvent) => {
            const { active, over } = event;
            setActiveId(null);
            setOverId(null);

            if (!over) return;

            const contactId = active.id as string;
            const targetStageId = over.id as string;

            const contact = contacts.find((c) => c.id === contactId);
            if (!contact) return;

            const currentStageId = contact.stage_id || defaultStage?.id;
            if (currentStageId === targetStageId) return;

            // Optimistic update
            setContacts((prev) =>
                prev.map((c) =>
                    c.id === contactId
                        ? { ...c, stage_id: targetStageId, moved_by: "user" }
                        : c
                )
            );

            // Server call
            const result = await moveContactToStage(contactId, pipelineId, targetStageId, "user");
            if (!result.success) {
                // Revert
                setContacts((prev) =>
                    prev.map((c) =>
                        c.id === contactId
                            ? { ...c, stage_id: currentStageId || null, moved_by: contact.moved_by }
                            : c
                    )
                );
            } else {
                // Fire stage rules + automations in background
                evaluateStageRules(contactId, targetStageId, clientId).catch(() => {});
                fireAutomations(contactId, targetStageId).catch(() => {});
            }
        },
        [contacts, defaultStage, pipelineId, clientId]
    );

    const activeContact = activeId ? contacts.find((c) => c.id === activeId) : null;

    // ─── Stage editor ──────────────────────────────────────────────────────

    const handleStagesUpdated = useCallback((newStages: PipelineStage[]) => {
        setStages(newStages);
    }, []);

    // ─── Contact detail ────────────────────────────────────────────────────

    const handleContactClick = useCallback((contact: PipelineContact) => {
        if (bulkMode) {
            setSelectedContactIds((prev) => {
                const next = new Set(prev);
                if (next.has(contact.id)) {
                    next.delete(contact.id);
                } else {
                    next.add(contact.id);
                }
                return next;
            });
            return;
        }
        setSelectedContact(contact);
    }, [bulkMode]);

    const handleContactUpdate = useCallback((updated: any) => {
        setContacts((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
        );
        setSelectedContact(null);
    }, []);

    // ─── Bulk actions ──────────────────────────────────────────────────────

    const handleBulkMoveToStage = async (stageId: string) => {
        const ids = Array.from(selectedContactIds);
        // Optimistic update
        setContacts((prev) =>
            prev.map((c) =>
                selectedContactIds.has(c.id)
                    ? { ...c, stage_id: stageId, moved_by: "user" }
                    : c
            )
        );
        setSelectedContactIds(new Set());
        setBulkMode(false);
        await bulkMoveContactsToStage(ids, pipelineId, stageId);
    };

    const handleBulkRemove = async () => {
        const ids = Array.from(selectedContactIds);
        setContacts((prev) => prev.filter((c) => !selectedContactIds.has(c.id)));
        setSelectedContactIds(new Set());
        setBulkMode(false);
        await bulkRemoveFromPipeline(ids, pipelineId);
    };

    const handleSelectAllInColumn = (stageId: string) => {
        const columnContacts = contactsByStage[stageId] || [];
        setSelectedContactIds((prev) => {
            const next = new Set(prev);
            for (const c of columnContacts) {
                next.add(c.id);
            }
            return next;
        });
    };

    // Empty state
    if (contacts.length === 0) {
        return (
            <div className="h-full flex flex-col">
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={headerVariants}
                    className="px-8 pt-8 pb-4"
                >
                    <div className="flex items-center gap-3">
                        <PipelineSelector
                            currentPipeline={currentPipeline}
                            pipelines={pipelines}
                            clientId={clientId}
                            onCreateClick={() => setCreateDialogOpen(true)}
                            onSettingsClick={() => setSettingsOpen(true)}
                        />
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Track your leads through every stage</p>
                </motion.div>
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={emptyVariants}
                    className="flex-1 flex items-center justify-center"
                >
                    <div className="text-center max-w-sm mx-auto">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-100 flex items-center justify-center mx-auto mb-4">
                            <KanbanSquare className="w-8 h-8 text-emerald-500" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">No leads in this pipeline yet</h2>
                        <p className="text-sm text-gray-500 mb-6">
                            Import contacts or enroll them in sequences to start tracking your pipeline.
                        </p>
                        <a
                            href={`/client/${clientId}/contacts`}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                        >
                            Go to Contacts
                            <ArrowRight className="w-4 h-4" />
                        </a>
                    </div>
                </motion.div>

                <CreatePipelineDialog
                    open={createDialogOpen}
                    onOpenChange={setCreateDialogOpen}
                    clientId={clientId}
                    pipelines={pipelines}
                />
                <PipelineSettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                    pipeline={currentPipeline}
                    clientId={clientId}
                    stages={stages}
                    pipelines={pipelines}
                />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <motion.div
                initial="hidden"
                animate="visible"
                variants={headerVariants}
                className="px-8 pt-8 pb-2 flex-shrink-0"
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <PipelineSelector
                            currentPipeline={currentPipeline}
                            pipelines={pipelines}
                            clientId={clientId}
                            onCreateClick={() => setCreateDialogOpen(true)}
                            onSettingsClick={() => setSettingsOpen(true)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                setBulkMode(!bulkMode);
                                if (bulkMode) setSelectedContactIds(new Set());
                            }}
                            className={cn(
                                "inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-all",
                                bulkMode
                                    ? "text-emerald-700 bg-emerald-50 border border-emerald-200"
                                    : "text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm"
                            )}
                        >
                            <CheckSquare className="w-4 h-4" />
                            {bulkMode ? "Cancel Selection" : "Select"}
                        </button>
                        <a
                            href={`/client/${clientId}/pipeline/analytics?pipeline=${pipelineId}`}
                            className={cn(
                                "inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-all",
                                "text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm"
                            )}
                        >
                            <BarChart3 className="w-4 h-4" />
                            Analytics
                        </a>
                        <button
                            onClick={() => setEditorOpen(true)}
                            className={cn(
                                "inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-all",
                                "text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm"
                            )}
                        >
                            <Settings2 className="w-4 h-4" />
                            Edit Stages
                        </button>
                    </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 mb-4">
                    {[
                        { icon: Users, label: "Total leads", value: totalContacts, color: "text-emerald-600 bg-emerald-50" },
                        { icon: TrendingUp, label: "In pipeline", value: contactsWithStage, color: "text-blue-600 bg-blue-50" },
                        { icon: KanbanSquare, label: "Converted", value: terminalContacts, color: "text-emerald-600 bg-emerald-50" },
                    ].map((stat, i) => (
                        <motion.div
                            key={stat.label}
                            custom={i}
                            initial="hidden"
                            animate="visible"
                            variants={statVariants}
                            className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-white border border-gray-100"
                        >
                            <div className={cn("w-7 h-7 rounded-md flex items-center justify-center", stat.color)}>
                                <stat.icon className="w-3.5 h-3.5" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">{stat.label}</p>
                                <p className="text-sm font-semibold text-gray-900 tabular-nums">{stat.value}</p>
                            </div>
                        </motion.div>
                    ))}

                    {/* Search */}
                    <div className="ml-auto relative">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search leads..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-56 pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all"
                        />
                    </div>
                </div>
            </motion.div>

            {/* Kanban Board */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={boardVariants}
                    className="flex-1 overflow-x-auto overflow-y-hidden px-8 pb-6"
                >
                    <div className="flex gap-4 h-full min-w-max">
                        {stages.map((stage) => (
                            <motion.div key={stage.id} variants={columnVariants}>
                                <PipelineColumn
                                    stage={stage}
                                    contacts={contactsByStage[stage.id] || []}
                                    isOver={overId === stage.id}
                                    onContactClick={handleContactClick}
                                    bulkMode={bulkMode}
                                    selectedContactIds={selectedContactIds}
                                    onSelectAllInColumn={() => handleSelectAllInColumn(stage.id)}
                                />
                            </motion.div>
                        ))}
                    </div>
                </motion.div>

                {/* Drag Overlay */}
                <DragOverlay dropAnimation={null}>
                    {activeContact && (
                        <div className="rotate-[2deg] scale-105 opacity-90">
                            <PipelineContactCard contact={activeContact} isGhost />
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            {/* Bulk Action Bar */}
            <AnimatePresence>
                {bulkMode && selectedContactIds.size > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4"
                    >
                        <span className="text-sm font-medium tabular-nums">
                            {selectedContactIds.size} selected
                        </span>
                        <div className="w-px h-5 bg-gray-700" />
                        <div className="relative">
                            <select
                                value={bulkStageTarget || ""}
                                onChange={(e) => {
                                    if (e.target.value) handleBulkMoveToStage(e.target.value);
                                }}
                                className="appearance-none bg-gray-800 text-white text-sm px-3 py-1.5 pr-8 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700"
                            >
                                <option value="">Move to stage...</option>
                                {stages.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <ArrowRightLeft className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                        <button
                            onClick={handleBulkRemove}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                        </button>
                        <button
                            onClick={() => {
                                setSelectedContactIds(new Set());
                                setBulkMode(false);
                            }}
                            className="p-1.5 hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Stage Editor */}
            <StageEditorDialog
                open={editorOpen}
                onOpenChange={setEditorOpen}
                pipelineId={pipelineId}
                clientId={clientId}
                stages={stages}
                contactsByStage={contactsByStage}
                onStagesUpdated={handleStagesUpdated}
            />

            {/* Create Pipeline Dialog */}
            <CreatePipelineDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                clientId={clientId}
                pipelines={pipelines}
            />

            {/* Pipeline Settings */}
            <PipelineSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                pipeline={currentPipeline}
                clientId={clientId}
                stages={stages}
                pipelines={pipelines}
            />

            {/* Contact Detail */}
            {selectedContact && (
                <ContactDetailModal
                    contact={{
                        id: selectedContact.id,
                        phone: selectedContact.phone,
                        name: selectedContact.name,
                        email: selectedContact.email,
                        conversation_summary: selectedContact.conversation_summary,
                        total_calls: selectedContact.total_calls,
                        last_call_at: selectedContact.last_call_at,
                        custom_fields: selectedContact.custom_fields,
                        created_at: selectedContact.created_at,
                        engagement_score: selectedContact.engagement_score ?? undefined,
                        sentiment_trend: selectedContact.sentiment_trend ?? undefined,
                    }}
                    customFields={[]}
                    clientId={clientId}
                    onClose={() => setSelectedContact(null)}
                    onUpdate={handleContactUpdate}
                />
            )}
        </div>
    );
}
