export type WalkthroughStepType = "welcome" | "sidebar" | "action" | "complete";

export interface WalkthroughStep {
    id: string;
    type: WalkthroughStepType;
    targetId?: string; // data-walkthrough-id to highlight (sidebar steps)
    title: string;
    description: string;
    icon?: string;
    actionUrl?: string; // navigation URL for action steps
    actionLabel?: string;
}

export interface WalkthroughState {
    isActive: boolean;
    currentStepIndex: number;
    steps: WalkthroughStep[];
}

export interface WalkthroughContextType {
    state: WalkthroughState;
    nextStep: () => void;
    prevStep: () => void;
    skip: () => void;
    start: () => void;
}
