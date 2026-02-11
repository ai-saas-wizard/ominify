"use client";

import { useState, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { completeOnboarding, saveTenantProfile } from "@/app/actions/tenant-profile-actions";

import type { OnboardingWizardProps } from "./types";
import { STEPS } from "./constants";
import { useOnboardingForm } from "./hooks/use-onboarding-form";
import { useAIAnalysis } from "./hooks/use-ai-analysis";

import { SidebarStepper } from "./components/sidebar-stepper";
import { StepContent } from "./components/step-content";
import { AIUrlStep } from "./components/ai-url-step";
import { AIAnalysisLoading } from "./components/ai-analysis-loading";
import { BusinessIdentityStep } from "./components/business-identity-step";
import { ServiceDetailsStep } from "./components/service-details-step";
import { BrandVoiceStep } from "./components/brand-voice-step";
import { BusinessHoursStep } from "./components/business-hours-step";
import { LeadConfigStep } from "./components/lead-config-step";
import { ReviewStep } from "./components/review-step";
import { Button } from "@/components/ui/button";

export function OnboardingWizard({ clientId, clientName, initialProfile }: OnboardingWizardProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
    const [completing, setCompleting] = useState(false);
    const [direction, setDirection] = useState(1);
    const prevStepRef = useRef(0);

    const formHook = useOnboardingForm(clientId, initialProfile);
    const aiHook = useAIAnalysis();

    // ─── NAVIGATION ───

    const goToStep = useCallback((step: number) => {
        if (step >= 0 && step < STEPS.length) {
            setDirection(step > currentStep ? 1 : -1);
            prevStepRef.current = currentStep;
            setCurrentStep(step);
        }
    }, [currentStep]);

    const goNext = useCallback(async () => {
        if (currentStep < STEPS.length - 1) {
            // Save progress when moving past form steps (1-5)
            if (currentStep >= 1 && currentStep <= 5) {
                const saved = await formHook.saveProgress();
                if (!saved) return;
            }
            setCompletedSteps((prev) => new Set([...prev, currentStep]));
            setDirection(1);
            prevStepRef.current = currentStep;
            setCurrentStep((s) => s + 1);
        }
    }, [currentStep, formHook]);

    const goPrev = useCallback(() => {
        if (currentStep > 0) {
            setDirection(-1);
            prevStepRef.current = currentStep;
            setCurrentStep((s) => s - 1);
        }
    }, [currentStep]);

    // ─── AI ANALYSIS HANDLERS ───

    const handleAnalyze = useCallback(async (url: string) => {
        formHook.updateField("website", url);
        const result = await aiHook.analyzeWebsite(url);
        if (result) {
            formHook.applyAIResults(result);
            // Auto-advance to step 1
            setCompletedSteps(new Set([0]));
            setDirection(1);
            prevStepRef.current = 0;
            setCurrentStep(1);
        }
    }, [formHook, aiHook]);

    const handleSkipAI = useCallback(() => {
        setCompletedSteps(new Set([0]));
        setDirection(1);
        prevStepRef.current = 0;
        setCurrentStep(1);
    }, []);

    const handleRetryAI = useCallback(() => {
        aiHook.resetAnalysis();
    }, [aiHook]);

    // ─── COMPLETE ONBOARDING ───

    const handleComplete = useCallback(async () => {
        setCompleting(true);

        // Save all data first
        const fd = formHook.buildFormData();
        const saveResult = await saveTenantProfile(clientId, fd);

        if (!saveResult.success) {
            setCompleting(false);
            return;
        }

        const result = await completeOnboarding(clientId);
        setCompleting(false);

        if (result.success) {
            window.location.href = `/client/${clientId}`;
        }
    }, [clientId, formHook]);

    // ─── RENDER CURRENT STEP ───

    const renderStep = () => {
        // Step 0: AI URL analysis
        if (currentStep === 0) {
            if (aiHook.analyzing) {
                return (
                    <AIAnalysisLoading
                        currentStage={aiHook.currentStage}
                        websiteUrl={formHook.form.website}
                    />
                );
            }
            if (aiHook.error) {
                return (
                    <AIAnalysisLoading
                        currentStage={aiHook.currentStage}
                        websiteUrl={formHook.form.website}
                        error={aiHook.error}
                        onRetry={handleRetryAI}
                        onSkip={handleSkipAI}
                    />
                );
            }
            return (
                <AIUrlStep
                    initialUrl={formHook.form.website}
                    onAnalyze={handleAnalyze}
                    onSkip={handleSkipAI}
                    analyzing={aiHook.analyzing}
                />
            );
        }

        const stepProps = {
            form: formHook.form,
            fieldMeta: formHook.fieldMeta,
            updateField: formHook.updateField,
            resetFieldToAI: formHook.resetFieldToAI,
        };

        switch (currentStep) {
            case 1:
                return <BusinessIdentityStep {...stepProps} />;
            case 2:
                return (
                    <ServiceDetailsStep
                        {...stepProps}
                        addJobType={formHook.addJobType}
                        updateJobType={formHook.updateJobType}
                        removeJobType={formHook.removeJobType}
                        updateServiceAreaCities={formHook.updateServiceAreaCities}
                        updateServiceAreaZips={formHook.updateServiceAreaZips}
                        updateServiceAreaRadius={formHook.updateServiceAreaRadius}
                    />
                );
            case 3:
                return <BrandVoiceStep {...stepProps} />;
            case 4:
                return <BusinessHoursStep {...stepProps} updateHours={formHook.updateHours} />;
            case 5:
                return <LeadConfigStep {...stepProps} toggleLeadSource={formHook.toggleLeadSource} />;
            case 6:
                return (
                    <ReviewStep
                        form={formHook.form}
                        fieldMeta={formHook.fieldMeta}
                        completing={completing}
                        onComplete={handleComplete}
                        onGoToStep={goToStep}
                    />
                );
            default:
                return null;
        }
    };

    // ─── MAIN LAYOUT ───

    return (
        <div className="flex h-full bg-gray-50">
            {/* Left Sidebar — hidden on mobile */}
            <aside className="w-72 border-r border-gray-200 bg-white flex-shrink-0 hidden lg:flex flex-col">
                <SidebarStepper
                    currentStep={currentStep}
                    completedSteps={completedSteps}
                    onStepClick={goToStep}
                    clientName={clientName}
                />
            </aside>

            {/* Mobile Top Bar */}
            <div className="lg:hidden fixed top-0 left-0 right-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900 truncate">{clientName}</span>
                    <span className="text-xs text-gray-500">
                        Step {currentStep + 1} of {STEPS.length}
                    </span>
                </div>
                {/* Step dots */}
                <div className="flex items-center gap-1.5 mt-2">
                    {STEPS.map((_, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => goToStep(idx)}
                            className={cn(
                                "h-1.5 rounded-full transition-all",
                                idx === currentStep
                                    ? "bg-violet-600 w-6"
                                    : completedSteps.has(idx)
                                    ? "bg-violet-300 w-3"
                                    : "bg-gray-200 w-3"
                            )}
                        />
                    ))}
                </div>
            </div>

            {/* Right Content Area */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-6 py-8 lg:py-12 lg:mt-0 mt-16">
                    <StepContent stepKey={currentStep} direction={direction}>
                        {renderStep()}
                    </StepContent>

                    {/* Navigation Bar — shown for steps 1-5 */}
                    {currentStep >= 1 && currentStep <= 5 && (
                        <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
                            <Button
                                variant="outline"
                                onClick={goPrev}
                                disabled={currentStep === 0}
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" />
                                Previous
                            </Button>

                            <div className="flex items-center gap-3">
                                {formHook.saveMessage && (
                                    <span
                                        className={cn(
                                            "text-sm",
                                            formHook.saveMessage.type === "success"
                                                ? "text-green-600"
                                                : "text-red-600"
                                        )}
                                    >
                                        {formHook.saveMessage.text}
                                    </span>
                                )}
                                {formHook.saving && (
                                    <span className="flex items-center gap-1.5 text-sm text-gray-400">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Saving...
                                    </span>
                                )}
                            </div>

                            <Button onClick={goNext} disabled={formHook.saving}>
                                Next
                                <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    )}

                    {/* Back button on review step */}
                    {currentStep === 6 && (
                        <div className="mt-6">
                            <Button variant="outline" onClick={goPrev}>
                                <ChevronLeft className="w-4 h-4 mr-1" />
                                Back to Lead Config
                            </Button>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
