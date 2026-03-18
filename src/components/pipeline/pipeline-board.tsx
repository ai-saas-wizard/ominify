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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moveContactToStage } from "@/app/actions/pipeline-actions";
import { PipelineColumn } from "./pipeline-column";
import { PipelineContactCard } from "./pipeline-contact-card";
import { StageEditorDialog } from "./stage-editor-dialog";
import { ContactDetailModal } from "@/components/contacts/contact-detail-modal";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PipelineStage {
    id: string;
    client_id: string;
    name: string;
    color: string;
    position: number;
    is_default: boolean;
    is_terminal: boolean;
    created_at: string;
}

export interface PipelineContact {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    pipeline_stage_id: string | null;
    pipeline_stage_moved_by: string | null;
    engagement_score: number | null;
    sentiment_trend: string | null;
    conversation_summary: string | null;
    last_call_at: string | null;
    total_calls: number;
    custom_fields: Record<string, any>;
    created_at: string;
    enrollment: {
        id: string;
        status: string;
        source: string;
        sequence_name: string | null;
    } | null;
}

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSourceLabel(source: string | null): string {
    if (!source) return "Unknown";
    const map: Record<string, string> = {
        csv_upload: "CSV",
        manual: "Manual",
        api: "API",
        form: "Form",
        import: "Import",
    };
    return map[source] || source;
}

// ─── Board Component ────────────────────────────────────────────────────────

export function PipelineBoard({
    clientId,
    initialStages,
    initialContacts,
}: {
    clientId: string;
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

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    // Default stage for contacts with null pipeline_stage_id
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
            const stageId = contact.pipeline_stage_id || defaultStage?.id;
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
    const contactsWithStage = contacts.filter((c) => c.pipeline_stage_id).length;
    const terminalContacts = contacts.filter((c) => {
        const stage = stages.find((s) => s.id === c.pipeline_stage_id);
        return stage?.is_terminal;
    }).length;

    // DnD handlers
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

            // Find the contact
            const contact = contacts.find((c) => c.id === contactId);
            if (!contact) return;

            const currentStageId = contact.pipeline_stage_id || defaultStage?.id;
            if (currentStageId === targetStageId) return;

            // Optimistic update
            setContacts((prev) =>
                prev.map((c) =>
                    c.id === contactId
                        ? { ...c, pipeline_stage_id: targetStageId, pipeline_stage_moved_by: "user" }
                        : c
                )
            );

            // Server call
            const result = await moveContactToStage(contactId, targetStageId, "user");
            if (!result.success) {
                // Revert
                setContacts((prev) =>
                    prev.map((c) =>
                        c.id === contactId
                            ? { ...c, pipeline_stage_id: currentStageId || null, pipeline_stage_moved_by: contact.pipeline_stage_moved_by }
                            : c
                    )
                );
            }
        },
        [contacts, defaultStage]
    );

    const activeContact = activeId ? contacts.find((c) => c.id === activeId) : null;

    // Handle stage editor updates
    const handleStagesUpdated = useCallback((newStages: PipelineStage[]) => {
        setStages(newStages);
    }, []);

    // Handle contact detail
    const handleContactClick = useCallback((contact: PipelineContact) => {
        setSelectedContact(contact);
    }, []);

    const handleContactUpdate = useCallback((updated: any) => {
        setContacts((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
        );
        setSelectedContact(null);
    }, []);

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
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Pipeline</h1>
                    <p className="text-sm text-gray-500 mt-1">Track your leads through every stage</p>
                </motion.div>
                <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={emptyVariants}
                    className="flex-1 flex items-center justify-center"
                >
                    <div className="text-center max-w-sm mx-auto">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center mx-auto mb-4">
                            <KanbanSquare className="w-8 h-8 text-violet-500" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">No leads in your pipeline yet</h2>
                        <p className="text-sm text-gray-500 mb-6">
                            Import contacts or enroll them in sequences to start tracking your sales pipeline.
                        </p>
                        <a
                            href={`/client/${clientId}/contacts`}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
                        >
                            Go to Contacts
                            <ArrowRight className="w-4 h-4" />
                        </a>
                    </div>
                </motion.div>
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
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Pipeline</h1>
                        <p className="text-sm text-gray-500 mt-0.5">Track your leads through every stage</p>
                    </div>
                    <button
                        onClick={() => setEditorOpen(true)}
                        className={cn(
                            "inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-all",
                            "text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm"
                        )}
                    >
                        <Settings2 className="w-4 h-4" />
                        Edit Pipeline
                    </button>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 mb-4">
                    {[
                        { icon: Users, label: "Total leads", value: totalContacts, color: "text-violet-600 bg-violet-50" },
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
                            className="w-56 pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all"
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

            {/* Stage Editor */}
            <StageEditorDialog
                open={editorOpen}
                onOpenChange={setEditorOpen}
                clientId={clientId}
                stages={stages}
                contactsByStage={contactsByStage}
                onStagesUpdated={handleStagesUpdated}
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
