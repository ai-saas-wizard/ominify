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

    // Step-to-step edges. The scheduler always advances linearly
    // (current_step_order + 1); it never reads on_success/on_failure/condition
    // branches, so the flow only renders the real linear path.
    sorted.forEach((step, index) => {
        const nextStep = sorted[index + 1];

        if (nextStep) {
            // Continue to next step
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
    });

    return { nodes, edges };
}
