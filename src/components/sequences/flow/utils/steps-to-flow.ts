import { type Node, type Edge, MarkerType } from "@xyflow/react";
import {
    FLOW_CENTER_X,
    FLOW_VERTICAL_SPACING,
    FLOW_NODE_WIDTH,
    FLOW_BRANCH_OFFSET,
    CHANNEL_FLOW_CONFIG,
    TRIGGER_FLOW_CONFIG,
} from "./constants";

export interface FlowStep {
    id: string;
    step_order: number;
    channel: string;
    action_type?: string;
    delay_minutes?: number;
    delay_amount?: number;
    delay_unit?: string;
    delay_type?: string;
    content?: any;
    subject_line?: string;
    system_prompt?: string;
    skip_conditions?: any;
    on_success?: { action?: string; target_step?: number } | null;
    on_failure?: any;
    enable_ai_mutation?: boolean;
    mutation_instructions?: string | null;
}

export interface FlowData {
    nodes: Node[];
    edges: Edge[];
}

export function stepsToFlow(
    steps: FlowStep[],
    triggerType: string,
    sequenceId: string
): FlowData {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const sorted = [...steps].sort((a, b) => a.step_order - b.step_order);

    // Trigger node
    const triggerConfig = TRIGGER_FLOW_CONFIG[triggerType] || TRIGGER_FLOW_CONFIG.manual;
    nodes.push({
        id: "trigger",
        type: "trigger",
        position: { x: FLOW_CENTER_X - FLOW_NODE_WIDTH / 2, y: 0 },
        data: {
            label: triggerConfig.label,
            triggerType,
        },
        draggable: false,
    });

    // Step nodes
    sorted.forEach((step, index) => {
        const channel = step.action_type || step.channel || "sms";
        const config = CHANNEL_FLOW_CONFIG[channel] || CHANNEL_FLOW_CONFIG.sms;
        const isCondition = channel === "condition";

        const yPos = (index + 1) * FLOW_VERTICAL_SPACING;
        const xPos = FLOW_CENTER_X - FLOW_NODE_WIDTH / 2;

        nodes.push({
            id: step.id,
            type: isCondition ? "condition" : channel === "wait" ? "wait" : channel === "email" ? "email" : channel === "voice_call" || channel === "voice" ? "voice" : "sms",
            position: { x: xPos, y: yPos },
            data: {
                step,
                channel,
                config,
                stepIndex: index,
                label: config.label,
            },
            draggable: false,
        });
    });

    // Add-node button at the end
    const addNodeY = (sorted.length + 1) * FLOW_VERTICAL_SPACING;
    nodes.push({
        id: "add-node",
        type: "addNode",
        position: { x: FLOW_CENTER_X - 24, y: addNodeY },
        data: { sequenceId },
        draggable: false,
    });

    // Edges: trigger → first step
    if (sorted.length > 0) {
        edges.push({
            id: "trigger-to-first",
            source: "trigger",
            target: sorted[0].id,
            type: "flowEdge",
            data: { sequenceId, insertIndex: 0 },
            animated: true,
        });
    } else {
        // trigger → add button when no steps
        edges.push({
            id: "trigger-to-add",
            source: "trigger",
            target: "add-node",
            type: "flowEdge",
            data: { sequenceId },
        });
    }

    // Step-to-step edges
    sorted.forEach((step, index) => {
        const channel = step.action_type || step.channel || "sms";
        const isCondition = channel === "condition";
        const onSuccess = step.on_success;
        const nextStep = sorted[index + 1];

        if (isCondition) {
            // Condition node: two edges (true/false)
            // True branch → next step or end
            if (nextStep) {
                edges.push({
                    id: `${step.id}-true`,
                    source: step.id,
                    sourceHandle: "true",
                    target: nextStep.id,
                    type: "flowEdge",
                    data: { sequenceId, insertIndex: index + 1, label: "True" },
                    style: { stroke: "#22c55e" },
                    label: "True",
                    labelStyle: { fill: "#22c55e", fontWeight: 600, fontSize: 11 },
                });
            }
            // False branch → skip to step after next or end
            const falseTarget = sorted[index + 2];
            if (falseTarget) {
                edges.push({
                    id: `${step.id}-false`,
                    source: step.id,
                    sourceHandle: "false",
                    target: falseTarget.id,
                    type: "flowEdge",
                    data: { sequenceId, label: "False" },
                    style: { stroke: "#ef4444" },
                    label: "False",
                    labelStyle: { fill: "#ef4444", fontWeight: 600, fontSize: 11 },
                });
            }
            return;
        }

        if (onSuccess?.action === "jump_to_step" && onSuccess.target_step) {
            // Jump to specific step
            const target = sorted.find((s) => s.step_order === onSuccess.target_step);
            if (target) {
                edges.push({
                    id: `${step.id}-jump`,
                    source: step.id,
                    target: target.id,
                    type: "flowEdge",
                    data: { sequenceId },
                    style: { stroke: "#8b5cf6", strokeDasharray: "5,5" },
                    label: "Jump",
                    labelStyle: { fill: "#8b5cf6", fontWeight: 600, fontSize: 11 },
                    animated: true,
                });
            }
        } else if (onSuccess?.action === "end_sequence") {
            // End sequence - add terminal node
            const endNodeId = `end-${step.id}`;
            nodes.push({
                id: endNodeId,
                type: "end",
                position: { x: FLOW_CENTER_X - 40, y: (index + 2) * FLOW_VERTICAL_SPACING },
                data: { label: "End" },
                draggable: false,
            });
            edges.push({
                id: `${step.id}-to-end`,
                source: step.id,
                target: endNodeId,
                type: "flowEdge",
                data: { sequenceId },
                style: { stroke: "#ef4444" },
            });
        } else {
            // Default: continue to next step
            if (nextStep) {
                edges.push({
                    id: `${step.id}-to-${nextStep.id}`,
                    source: step.id,
                    target: nextStep.id,
                    type: "flowEdge",
                    data: { sequenceId, insertIndex: index + 1 },
                });
            } else {
                // Last step → add node
                edges.push({
                    id: `${step.id}-to-add`,
                    source: step.id,
                    target: "add-node",
                    type: "flowEdge",
                    data: { sequenceId },
                });
            }
        }
    });

    return { nodes, edges };
}
