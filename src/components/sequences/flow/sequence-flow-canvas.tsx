"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    type Node,
    type Edge,
    type NodeTypes,
    type EdgeTypes,
    BackgroundVariant,
    useNodesState,
    useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";

import { stepsToFlow, type FlowStep } from "./utils/steps-to-flow";
import { TriggerNode, EndNode } from "./nodes/trigger-node";
import { SmsNode, EmailNode, VoiceNode, WaitNode, ConditionNode } from "./nodes/channel-nodes";
import { AddNodeButton } from "./nodes/add-node-button";
import { FlowEdge } from "./edges/flow-edge";
import { FlowToolbar } from "./panels/flow-toolbar";
import { FlowSidebarPanel } from "./panels/flow-sidebar-panel";
import { SequenceStepEditor } from "@/components/sequences/step-editor";
import { AIGenerateStepsDialog } from "./panels/ai-generate-steps-dialog";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { seqBtnPrimary, seqFocusRing } from "@/components/sequences/theme";

const nodeTypes: NodeTypes = {
    trigger: TriggerNode,
    sms: SmsNode,
    email: EmailNode,
    voice: VoiceNode,
    wait: WaitNode,
    condition: ConditionNode,
    addNode: AddNodeButton,
    end: EndNode,
};

const edgeTypes: EdgeTypes = {
    flowEdge: FlowEdge,
};

interface SequenceFlowCanvasProps {
    clientId: string;
    sequenceId: string;
    sequence: any;
    steps: any[];
    enrollments: any[];
    isActive: boolean;
}

export function SequenceFlowCanvas({
    clientId,
    sequenceId,
    sequence,
    steps,
    enrollments,
    isActive,
}: SequenceFlowCanvasProps) {
    const router = useRouter();

    // Sidebar state
    const [sidebarTab, setSidebarTab] = useState<string | null>(null);

    // Step editor state
    const [showStepEditor, setShowStepEditor] = useState(false);
    const [editingStep, setEditingStep] = useState<any>(null);
    const [showAIDialog, setShowAIDialog] = useState(false);

    // Compute flow from steps
    const flowData = useMemo(
        () => stepsToFlow(steps as FlowStep[], sequence.trigger_type, sequenceId),
        [steps, sequence.trigger_type, sequenceId]
    );

    const [nodes, setNodes, onNodesChange] = useNodesState(flowData.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(flowData.edges);

    // Update nodes/edges when steps change
    useEffect(() => {
        setNodes(flowData.nodes);
        setEdges(flowData.edges);
    }, [flowData, setNodes, setEdges]);

    // Handle node click
    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            if (node.type === "addNode") {
                setEditingStep(null);
                setShowStepEditor(true);
                return;
            }
            if (node.type === "trigger" || node.type === "end") return;

            // Open step editor with existing step data
            const step = (node.data as any).step;
            if (step) {
                setEditingStep(step);
                setShowStepEditor(true);
            }
        },
        []
    );

    // Handle edge click (+ button on edge)
    const onEdgeClick = useCallback(
        (event: React.MouseEvent, edge: Edge) => {
            // Check if the click was on the add button
            const target = event.target as HTMLElement;
            const addButton = target.closest("[data-add-index]");
            if (addButton) {
                setEditingStep(null);
                setShowStepEditor(true);
            }
        },
        []
    );

    // Handle step saved
    const handleStepSaved = useCallback(() => {
        setShowStepEditor(false);
        setEditingStep(null);
        router.refresh();
    }, [router]);

    // Handle step editor close
    const handleStepEditorClose = useCallback(() => {
        setShowStepEditor(false);
        setEditingStep(null);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                if (showStepEditor) {
                    handleStepEditorClose();
                } else if (sidebarTab) {
                    setSidebarTab(null);
                }
            }
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showStepEditor, sidebarTab, handleStepEditorClose]);

    // MiniMap node color — ink for the trigger, amber for waits, neutral grays
    // for everything else (channel identity lives on the nodes, not the map).
    const nodeColor = useCallback((node: Node) => {
        const channel = (node.data as any)?.channel;
        if (node.type === "trigger") return "#111827";
        if (node.type === "addNode") return "#e5e7eb";
        if (node.type === "end") return "#9ca3af";
        if (channel === "wait") return "#f59e0b";
        return "#d1d5db";
    }, []);

    return (
        <div className="h-full w-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.3}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="#e5e7eb"
                />
                <Controls
                    className="!rounded-xl !border !border-gray-200 !bg-white !shadow-sm"
                    showInteractive={false}
                />
                <MiniMap
                    nodeColor={nodeColor}
                    maskColor="rgba(255,255,255,0.8)"
                    className="!rounded-xl !border !border-gray-200 !bg-white !shadow-sm"
                    pannable
                    zoomable
                />

                {/* Toolbar */}
                <FlowToolbar
                    clientId={clientId}
                    sequenceId={sequenceId}
                    sequence={sequence}
                    isActive={isActive}
                    enrollments={enrollments}
                    sidebarTab={sidebarTab}
                    onSidebarToggle={setSidebarTab}
                    onOpenAIDialog={() => setShowAIDialog(true)}
                />
            </ReactFlow>

            {/* Sidebar panel */}
            <AnimatePresence>
                {sidebarTab && (
                    <FlowSidebarPanel
                        activeTab={sidebarTab}
                        sequence={sequence}
                        enrollments={enrollments}
                        sequenceId={sequenceId}
                        clientId={clientId}
                        onClose={() => setSidebarTab(null)}
                    />
                )}
            </AnimatePresence>

            {/* Step editor modal overlay */}
            <AnimatePresence>
                {showStepEditor && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/40"
                            onClick={handleStepEditorClose}
                        />
                        {/* Editor */}
                        <div className="relative z-10 mx-4 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-lg">
                            <SequenceStepEditor
                                sequenceId={sequenceId}
                                existingStep={editingStep}
                                onClose={handleStepEditorClose}
                                onSaved={handleStepSaved}
                            />
                        </div>
                    </div>
                )}
            </AnimatePresence>

            {/* AI Generate Steps Dialog */}
            <AIGenerateStepsDialog
                clientId={clientId}
                sequenceId={sequenceId}
                isOpen={showAIDialog}
                onClose={() => setShowAIDialog(false)}
                onGenerated={() => {
                    setShowAIDialog(false);
                    router.refresh();
                }}
            />

            {/* Empty state CTA */}
            {steps.length === 0 && !showStepEditor && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <div className="pointer-events-auto max-w-sm rounded-xl border border-gray-200 bg-white p-8 text-center shadow-md">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                            <Sparkles className="h-5 w-5 text-gray-400" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-gray-900">Describe Your Sequence</h3>
                        <p className="mb-4 text-sm text-gray-500">Let AI build your follow-up steps, or add them manually.</p>
                        <button
                            onClick={() => setShowAIDialog(true)}
                            className={cn(seqBtnPrimary, "mb-3 w-full px-4 py-2.5")}
                        >
                            <Sparkles className="h-4 w-4" />
                            Generate with AI
                        </button>
                        <button
                            onClick={() => { setEditingStep(null); setShowStepEditor(true); }}
                            className={cn("rounded-sm text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700", seqFocusRing)}
                        >
                            or add steps manually
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
