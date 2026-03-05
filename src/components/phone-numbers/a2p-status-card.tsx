"use client";

import { useState } from "react";
import {
    Shield,
    CheckCircle2,
    Clock,
    XCircle,
    AlertTriangle,
    RefreshCw,
    Loader2,
    Send,
    ChevronDown,
    ChevronUp,
    Building2,
    FileCheck,
    BadgeCheck,
    MessageSquare,
} from "lucide-react";
import {
    checkA2PStatus,
    createA2PCustomerProfile,
    createA2PTrustProductAction,
    registerBrandAction,
    submitA2PCampaign,
    type CampaignSubmission,
} from "@/app/actions/twilio-actions";
import { A2PBusinessInfoForm } from "./a2p-business-info-form";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
    a2pRegistration: any;
    tenantProfile: any;
}

// ─── Step definitions ────────────────────────────────────────────────────────

interface Step {
    key: string;
    label: string;
    description: string;
    icon: React.ReactNode;
}

const STEPS: Step[] = [
    {
        key: "business_info",
        label: "Business Information",
        description: "Provide your legal business details, address, and authorized representatives",
        icon: <Building2 className="w-4 h-4" />,
    },
    {
        key: "customer_profile",
        label: "Customer Profile",
        description: "Submit your TrustHub customer profile to Twilio for review",
        icon: <FileCheck className="w-4 h-4" />,
    },
    {
        key: "profile_review",
        label: "Profile Review",
        description: "Twilio is reviewing your customer profile (1-3 business days)",
        icon: <Clock className="w-4 h-4" />,
    },
    {
        key: "trust_product",
        label: "A2P Trust Product",
        description: "Create your A2P messaging trust product",
        icon: <Shield className="w-4 h-4" />,
    },
    {
        key: "trust_review",
        label: "Trust Product Review",
        description: "Twilio is reviewing your A2P trust product (1-3 business days)",
        icon: <Clock className="w-4 h-4" />,
    },
    {
        key: "brand_registration",
        label: "Brand Registration",
        description: "Register your brand with The Campaign Registry (TCR)",
        icon: <BadgeCheck className="w-4 h-4" />,
    },
    {
        key: "campaign",
        label: "Campaign Registration",
        description: "Submit your SMS campaign use case for carrier approval",
        icon: <MessageSquare className="w-4 h-4" />,
    },
];

type StepStatus = "completed" | "active" | "pending" | "failed" | "waiting";

function getStepStatus(registration: any, tenantProfile: any, stepKey: string): StepStatus {
    if (!registration && !tenantProfile?.a2p_business_info_complete) {
        return stepKey === "business_info" ? "active" : "pending";
    }

    const currentStep = registration?.current_step || "business_info";
    const stepOrder = STEPS.map((s) => s.key);
    const currentIndex = stepOrder.indexOf(currentStep);
    const stepIndex = stepOrder.indexOf(stepKey);

    // Steps before current are completed
    if (stepIndex < currentIndex) return "completed";

    // Current step is active
    if (stepIndex === currentIndex) {
        // Check for failures
        if (stepKey === "profile_review" && registration?.secondary_profile_status === "twilio-rejected") return "failed";
        if (stepKey === "trust_review" && registration?.trust_product_status === "twilio-rejected") return "failed";
        if (stepKey === "brand_registration" && registration?.brand_status === "FAILED") return "failed";
        if (stepKey === "campaign" && registration?.campaign_status === "FAILED") return "failed";

        // Waiting steps
        if (stepKey === "profile_review") return "waiting";
        if (stepKey === "trust_review") return "waiting";

        return "active";
    }

    // Completed special cases (check if step was already done)
    if (stepKey === "business_info" && tenantProfile?.a2p_business_info_complete) return "completed";
    if (stepKey === "customer_profile" && registration?.secondary_customer_profile_sid) return "completed";
    if (stepKey === "profile_review" && registration?.secondary_profile_status === "twilio-approved") return "completed";
    if (stepKey === "trust_product" && registration?.trust_product_sid) return "completed";
    if (stepKey === "trust_review" && registration?.trust_product_status === "twilio-approved") return "completed";
    if (stepKey === "brand_registration" && registration?.brand_sid) return "completed";

    // Check for 'complete' current_step (all done)
    if (currentStep === "complete") return "completed";
    if (currentStep === "campaign_review") {
        if (stepKey === "campaign") return "waiting";
        return "completed";
    }

    // Brand review — special active state for brand_registration step
    if (currentStep === "brand_review") {
        if (stepKey === "brand_registration") return "waiting";
        if (stepIndex < stepOrder.indexOf("brand_registration")) return "completed";
    }

    return "pending";
}

function getStepStatusIcon(status: StepStatus) {
    switch (status) {
        case "completed":
            return <CheckCircle2 className="w-5 h-5 text-green-600" />;
        case "active":
            return <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-white" /></div>;
        case "waiting":
            return <Clock className="w-5 h-5 text-blue-500 animate-pulse" />;
        case "failed":
            return <XCircle className="w-5 h-5 text-red-600" />;
        default:
            return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
    }
}

export function A2PStatusCard({ clientId, a2pRegistration, tenantProfile }: Props) {
    const router = useRouter();
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [showBusinessForm, setShowBusinessForm] = useState(false);
    const [showCampaignForm, setShowCampaignForm] = useState(false);
    const [expandedStep, setExpandedStep] = useState<string | null>(null);

    // Campaign form
    const [campaignForm, setCampaignForm] = useState<CampaignSubmission>({
        description: "",
        messageFlow: "",
        sampleMessages: ["", ""],
        optInMessage: "",
        optOutMessage: "",
        helpMessage: "",
    });

    const currentStep = a2pRegistration?.current_step || "business_info";
    const isComplete = currentStep === "complete" ||
        (a2pRegistration?.campaign_status === "VERIFIED" || a2pRegistration?.campaign_status === "approved");

    async function handleRefresh() {
        setRefreshing(true);
        setError("");
        try {
            await checkA2PStatus(clientId);
            router.refresh();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setRefreshing(false);
        }
    }

    async function handleAction(action: string) {
        setActionLoading(action);
        setError("");
        try {
            let result;
            switch (action) {
                case "create_profile":
                    result = await createA2PCustomerProfile(clientId);
                    break;
                case "create_trust":
                    result = await createA2PTrustProductAction(clientId);
                    break;
                case "register_brand":
                    result = await registerBrandAction(clientId);
                    break;
                default:
                    return;
            }
            if (!result.success) {
                setError(result.error || "Action failed");
            } else {
                router.refresh();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setActionLoading(null);
        }
    }

    async function handleSubmitCampaign() {
        if (!campaignForm.description.trim() || !campaignForm.messageFlow.trim()) {
            setError("Campaign description and message flow are required.");
            return;
        }
        if (!campaignForm.sampleMessages[0].trim() || !campaignForm.sampleMessages[1].trim()) {
            setError("Both sample messages are required.");
            return;
        }
        if (!campaignForm.optInMessage.trim() || !campaignForm.optOutMessage.trim() || !campaignForm.helpMessage.trim()) {
            setError("Opt-in, opt-out, and help messages are all required.");
            return;
        }

        setActionLoading("submit_campaign");
        setError("");
        try {
            const result = await submitA2PCampaign(clientId, campaignForm);
            if (!result.success) {
                setError(result.error || "Failed to submit campaign");
            } else {
                setShowCampaignForm(false);
                router.refresh();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setActionLoading(null);
        }
    }

    function updateSampleMessage(index: number, value: string) {
        setCampaignForm((prev) => {
            const updated = [...prev.sampleMessages] as [string, string];
            updated[index] = value;
            return { ...prev, sampleMessages: updated };
        });
    }

    function renderStepAction(stepKey: string, status: StepStatus) {
        if (status === "completed" || status === "pending") return null;

        switch (stepKey) {
            case "business_info":
                if (status === "active") {
                    return (
                        <button
                            onClick={() => setShowBusinessForm(true)}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs"
                        >
                            <Building2 className="w-3.5 h-3.5" />
                            Complete Business Info
                        </button>
                    );
                }
                return null;

            case "customer_profile":
                if (status === "active") {
                    return (
                        <button
                            onClick={() => handleAction("create_profile")}
                            disabled={actionLoading === "create_profile"}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs disabled:opacity-50"
                        >
                            {actionLoading === "create_profile" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Send className="w-3.5 h-3.5" />
                            )}
                            {actionLoading === "create_profile" ? "Submitting..." : "Submit to Twilio"}
                        </button>
                    );
                }
                return null;

            case "profile_review":
            case "trust_review":
                if (status === "waiting") {
                    return (
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                            {refreshing ? "Checking..." : "Refresh Status"}
                        </button>
                    );
                }
                if (status === "failed") {
                    return (
                        <div className="mt-2 text-xs text-red-600">
                            Registration was rejected. Please review your business information and try again.
                        </div>
                    );
                }
                return null;

            case "trust_product":
                if (status === "active") {
                    return (
                        <button
                            onClick={() => handleAction("create_trust")}
                            disabled={actionLoading === "create_trust"}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs disabled:opacity-50"
                        >
                            {actionLoading === "create_trust" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Shield className="w-3.5 h-3.5" />
                            )}
                            {actionLoading === "create_trust" ? "Creating..." : "Create Trust Product"}
                        </button>
                    );
                }
                return null;

            case "brand_registration":
                if (status === "active") {
                    return (
                        <button
                            onClick={() => handleAction("register_brand")}
                            disabled={actionLoading === "register_brand"}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs disabled:opacity-50"
                        >
                            {actionLoading === "register_brand" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <BadgeCheck className="w-3.5 h-3.5" />
                            )}
                            {actionLoading === "register_brand" ? "Registering..." : "Register Brand ($4.50)"}
                        </button>
                    );
                }
                if (status === "waiting") {
                    return (
                        <div className="mt-2 space-y-1">
                            <p className="text-xs text-blue-600">Brand review in progress (3-7 business days)</p>
                            <button
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs disabled:opacity-50"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                                {refreshing ? "Checking..." : "Refresh Status"}
                            </button>
                        </div>
                    );
                }
                return null;

            case "campaign":
                if (status === "active" && !showCampaignForm) {
                    return (
                        <button
                            onClick={() => setShowCampaignForm(true)}
                            className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs"
                        >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Submit Campaign
                        </button>
                    );
                }
                if (status === "waiting") {
                    return (
                        <div className="mt-2 space-y-1">
                            <p className="text-xs text-blue-600">Campaign review in progress (1-3 business days)</p>
                            <button
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-xs disabled:opacity-50"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                                {refreshing ? "Checking..." : "Refresh Status"}
                            </button>
                        </div>
                    );
                }
                return null;

            default:
                return null;
        }
    }

    const inputClass = "w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent";

    return (
        <div className="bg-white rounded-xl border shadow-sm p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 rounded-lg">
                        <Shield className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-gray-900">A2P 10DLC Registration</h2>
                        <p className="text-sm text-gray-500">
                            Required for SMS compliance in the US
                        </p>
                    </div>
                </div>
                {isComplete && (
                    <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">
                        Fully Approved
                    </span>
                )}
            </div>

            {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {/* 7-Step Vertical Timeline */}
            <div className="space-y-0">
                {STEPS.map((step, index) => {
                    const status = getStepStatus(a2pRegistration, tenantProfile, step.key);
                    const isExpanded = expandedStep === step.key || status === "active" || status === "waiting" || status === "failed";
                    const isLast = index === STEPS.length - 1;

                    return (
                        <div key={step.key} className="relative">
                            {/* Connector line */}
                            {!isLast && (
                                <div
                                    className={`absolute left-[9px] top-[28px] w-0.5 h-full ${
                                        status === "completed" ? "bg-green-300" : "bg-gray-200"
                                    }`}
                                />
                            )}

                            <div
                                className={`relative flex items-start gap-3 py-3 px-2 rounded-lg transition-colors ${
                                    status === "active" || status === "waiting"
                                        ? "bg-amber-50/50"
                                        : status === "failed"
                                        ? "bg-red-50/50"
                                        : ""
                                }`}
                            >
                                {/* Status icon */}
                                <div className="flex-shrink-0 mt-0.5 z-10 bg-white rounded-full">
                                    {getStepStatusIcon(status)}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <button
                                        onClick={() => setExpandedStep(expandedStep === step.key ? null : step.key)}
                                        className="flex items-center gap-2 w-full text-left"
                                    >
                                        <span
                                            className={`text-sm font-medium ${
                                                status === "completed"
                                                    ? "text-green-700"
                                                    : status === "active" || status === "waiting"
                                                    ? "text-amber-700"
                                                    : status === "failed"
                                                    ? "text-red-700"
                                                    : "text-gray-400"
                                            }`}
                                        >
                                            {step.label}
                                        </span>
                                        {status !== "pending" && (
                                            expandedStep === step.key ? (
                                                <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                                            ) : (
                                                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                                            )
                                        )}
                                    </button>

                                    {isExpanded && (
                                        <div className="mt-1">
                                            <p className="text-xs text-gray-500">{step.description}</p>
                                            {renderStepAction(step.key, status)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Business Info Form (modal-like overlay within card) */}
            {showBusinessForm && (
                <div className="mt-4 border-t pt-4">
                    <h3 className="font-semibold text-gray-900 text-sm mb-4">Business Information for A2P Registration</h3>
                    <A2PBusinessInfoForm
                        clientId={clientId}
                        tenantProfile={tenantProfile}
                        onComplete={() => setShowBusinessForm(false)}
                        onCancel={() => setShowBusinessForm(false)}
                    />
                </div>
            )}

            {/* Campaign Form */}
            {showCampaignForm && (
                <div className="mt-4 border-t pt-4 space-y-4">
                    <h3 className="font-semibold text-gray-900 text-sm">Campaign Details (Low Volume)</h3>
                    <p className="text-xs text-gray-500">
                        Carriers review these details to approve your SMS usage. Be specific and honest.
                        Cost: $15 one-time vetting + $1.50/month.
                    </p>

                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Campaign Description *</label>
                        <textarea
                            value={campaignForm.description}
                            onChange={(e) => setCampaignForm((p) => ({ ...p, description: e.target.value }))}
                            placeholder="e.g. Lead follow-up SMS for home services company. We contact leads who submitted inquiry forms to schedule appointments."
                            className={`${inputClass} resize-none`}
                            rows={2}
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Message Flow — How do users opt in? *</label>
                        <textarea
                            value={campaignForm.messageFlow}
                            onChange={(e) => setCampaignForm((p) => ({ ...p, messageFlow: e.target.value }))}
                            placeholder="e.g. Users opt in by submitting a web form on our website requesting a quote. The form includes SMS consent checkbox."
                            className={`${inputClass} resize-none`}
                            rows={2}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Sample Message 1 *</label>
                            <input
                                type="text"
                                value={campaignForm.sampleMessages[0]}
                                onChange={(e) => updateSampleMessage(0, e.target.value)}
                                placeholder="Hi John, this is ABC Plumbing. Following up on your request..."
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Sample Message 2 *</label>
                            <input
                                type="text"
                                value={campaignForm.sampleMessages[1]}
                                onChange={(e) => updateSampleMessage(1, e.target.value)}
                                placeholder="ABC Plumbing here — checking if you still need help..."
                                className={inputClass}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Opt-In Message *</label>
                            <textarea
                                value={campaignForm.optInMessage}
                                onChange={(e) => setCampaignForm((p) => ({ ...p, optInMessage: e.target.value }))}
                                placeholder="You're now receiving messages from ABC Plumbing. Reply STOP to opt out."
                                className={`${inputClass} resize-none`}
                                rows={2}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Opt-Out Message *</label>
                            <textarea
                                value={campaignForm.optOutMessage}
                                onChange={(e) => setCampaignForm((p) => ({ ...p, optOutMessage: e.target.value }))}
                                placeholder="You've been unsubscribed. Reply START to re-subscribe."
                                className={`${inputClass} resize-none`}
                                rows={2}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Help Message *</label>
                            <textarea
                                value={campaignForm.helpMessage}
                                onChange={(e) => setCampaignForm((p) => ({ ...p, helpMessage: e.target.value }))}
                                placeholder="For help, contact us at support@abc.com. Reply STOP to opt out."
                                className={`${inputClass} resize-none`}
                                rows={2}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <button
                            onClick={handleSubmitCampaign}
                            disabled={actionLoading === "submit_campaign"}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
                        >
                            {actionLoading === "submit_campaign" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Send className="w-4 h-4" />
                            )}
                            {actionLoading === "submit_campaign" ? "Submitting..." : "Submit Campaign for Review"}
                        </button>
                        <button
                            onClick={() => {
                                setShowCampaignForm(false);
                                setError("");
                            }}
                            className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Completion banner */}
            {isComplete && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="text-sm text-green-800 font-medium">A2P Registration Complete</p>
                        <p className="text-xs text-green-600 mt-1">
                            Your brand and campaign have been approved. You can now send SMS messages at scale.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
