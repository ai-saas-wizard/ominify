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
import { CHANNEL_FLOW_CONFIG } from "./utils/constants";
import { TriggerNode, EndNode } from "./nodes/trigger-node";
import { SmsNode, EmailNode, VoiceNode, WaitNode, ConditionNode } from "./nodes/channel-nodes";
import { AddNodeButton } from "./nodes/add-node-button";
import { FlowEdge } from "./edges/flow-edge";
import { FlowToolbar } from "./panels/flow-toolbar";
import { FlowSidebarPanel } from "./panels/flow-sidebar-panel";
import { SequenceStepEditor } from "@/components/sequences/step-editor";
import { AIGenerateStepsDialog } from "./panels/ai-generate-steps-dialog";
import { Sparkles } from "lucide-react";

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

    // MiniMap node color
    const nodeColor = useCallback((node: Node) => {
        const channel = (node.data as any)?.channel;
        if (node.type === "trigger") return "#10b981";
        if (node.type === "addNode") return "#d1d5db";
        if (node.type === "end") return "#ef4444";
        const config = CHANNEL_FLOW_CONFIG[channel];
        if (channel === "sms") return "#22c55e";
        if (channel === "email") return "#3b82f6";
        if (channel === "voice_call" || channel === "voice") return "#10b981";
        if (channel === "wait") return "#f59e0b";
        if (channel === "condition") return "#ec4899";
        return "#9ca3af";
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
                    className="!bg-white !border !shadow-lg !rounded-xl"
                    showInteractive={false}
                />
                <MiniMap
                    nodeColor={nodeColor}
                    maskColor="rgba(255,255,255,0.8)"
                    className="!bg-white !border !shadow-lg !rounded-xl"
                    pannable
                    zoomable
                />

                {/* Toolbar */}
                <FlowToolbar
                    clientId={clientId}
                    sequenceId={sequenceId}
                    sequence={sequence}
                    isActive={isActive}
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
                            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                            onClick={handleStepEditorClose}
                        />
                        {/* Editor */}
                        <div className="relative z-10 w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border p-6">
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
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <div className="bg-white/95 backdrop-blur-sm rounded-2xl border shadow-xl p-8 text-center max-w-sm pointer-events-auto">
                        <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                            <Sparkles className="w-6 h-6 text-emerald-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Describe Your Sequence</h3>
                        <p className="text-sm text-gray-500 mb-4">Let AI build your follow-up steps, or add them manually.</p>
                        <button
                            onClick={() => setShowAIDialog(true)}
                            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all mb-3"
                        >
                            <Sparkles className="w-4 h-4" />
                            Generate with AI
                        </button>
                        <button
                            onClick={() => { setEditingStep(null); setShowStepEditor(true); }}
                            className="text-sm text-emerald-600 hover:text-emerald-800 font-medium transition-colors"
                        >
                            or add steps manually
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
