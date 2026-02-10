"use client";

import { ABTestPanel } from "@/components/analytics/ab-test-panel";

interface Step {
    id: string;
    step_order: number;
    channel: string;
    content: any;
}

interface LearningABTestsProps {
    steps: Step[];
    sequenceId: string;
    clientId: string;
}

export function LearningABTests({ steps, sequenceId, clientId }: LearningABTestsProps) {
    if (steps.length === 0) {
        return (
            <p className="text-sm text-gray-500">No steps configured in this sequence.</p>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {steps.map((step) => (
                <ABTestPanel
                    key={step.id}
                    stepId={step.id}
                    stepOrder={step.step_order}
                    channel={step.channel}
                    sequenceId={sequenceId}
                    clientId={clientId}
                />
            ))}
        </div>
    );
}
