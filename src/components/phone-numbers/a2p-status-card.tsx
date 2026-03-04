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
} from "lucide-react";
import {
    startA2PRegistration,
    checkA2PStatus,
    submitA2PCampaign,
    type CampaignSubmission,
} from "@/app/actions/twilio-actions";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
    a2pRegistration: any;
}

const STEPS = [
    { key: "brand_registration", label: "Brand Registration" },
    { key: "brand_approval", label: "Brand Approval" },
    { key: "campaign_submission", label: "Campaign Submission" },
    { key: "campaign_approval", label: "Campaign Approval" },
];

function getStepStatus(registration: any, stepKey: string): "completed" | "active" | "pending" | "failed" {
    if (!registration) return "pending";

    switch (stepKey) {
        case "brand_registration":
            if (registration.brand_sid) return "completed";
            return "pending";

        case "brand_approval":
            if (registration.brand_status === "APPROVED") return "completed";
            if (registration.brand_status === "FAILED") return "failed";
            if (registration.brand_sid) return "active";
            return "pending";

        case "campaign_submission":
            if (registration.campaign_sid) return "completed";
            if (registration.brand_status === "APPROVED" && !registration.campaign_sid) return "active";
            return "pending";

        case "campaign_approval":
            if (registration.campaign_status === "VERIFIED" || registration.campaign_status === "APPROVED") return "completed";
            if (registration.campaign_status === "FAILED") return "failed";
            if (registration.campaign_sid) return "active";
            return "pending";

        default:
            return "pending";
    }
}

function getStepIcon(status: string) {
    switch (status) {
        case "completed":
            return <CheckCircle2 className="w-5 h-5 text-green-600" />;
        case "active":
            return <Clock className="w-5 h-5 text-amber-500 animate-pulse" />;
        case "failed":
            return <XCircle className="w-5 h-5 text-red-600" />;
        default:
            return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
    }
}

function getOverallStatus(registration: any): { label: string; color: string } {
    if (!registration) return { label: "Not Started", color: "text-gray-500" };

    const campaignStatus = registration.campaign_status;
    if (campaignStatus === "VERIFIED" || campaignStatus === "APPROVED") {
        return { label: "Fully Approved", color: "text-green-600" };
    }

    if (registration.brand_status === "FAILED" || campaignStatus === "FAILED") {
        return { label: "Registration Failed", color: "text-red-600" };
    }

    if (registration.brand_status === "APPROVED" && !registration.campaign_sid) {
        return { label: "Brand Approved — Submit Campaign", color: "text-blue-600" };
    }

    if (registration.brand_sid) {
        return { label: "In Progress", color: "text-amber-600" };
    }

    return { label: "Not Started", color: "text-gray-500" };
}

export function A2PStatusCard({ clientId, a2pRegistration }: Props) {
    const router = useRouter();
    const [starting, setStarting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [submittingCampaign, setSubmittingCampaign] = useState(false);
    const [showCampaignForm, setShowCampaignForm] = useState(false);
    const [error, setError] = useState("");

    // Campaign form fields
    const [campaignForm, setCampaignForm] = useState<CampaignSubmission>({
        description: "",
        messageFlow: "",
        sampleMessages: ["", ""],
        optInMessage: "",
        optOutMessage: "",
        helpMessage: "",
    });

    const overallStatus = getOverallStatus(a2pRegistration);
    const brandApproved = a2pRegistration?.brand_status === "APPROVED";
    const noCampaignYet = !a2pRegistration?.campaign_sid;

    async function handleStartRegistration() {
        setStarting(true);
        setError("");
        try {
            const result = await startA2PRegistration(clientId);
            if (!result.success) {
                setError(result.error || "Failed to start registration");
            } else {
                router.refresh();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setStarting(false);
        }
    }

    async function handleRefresh() {
        setRefreshing(true);
        try {
            await checkA2PStatus(clientId);
            router.refresh();
        } catch (err) {
            console.error("Refresh error:", err);
        } finally {
            setRefreshing(false);
        }
    }

    async function handleSubmitCampaign() {
        // Validate
        if (!campaignForm.description.trim()) {
            setError("Campaign description is required.");
            return;
        }
        if (!campaignForm.messageFlow.trim()) {
            setError("Message flow description is required.");
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

        setSubmittingCampaign(true);
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
            setSubmittingCampaign(false);
        }
    }

    function updateSampleMessage(index: number, value: string) {
        setCampaignForm((prev) => {
            const updated = [...prev.sampleMessages] as [string, string];
            updated[index] = value;
            return { ...prev, sampleMessages: updated };
        });
    }

    return (
        <div className="bg-white rounded-xl border shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
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
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${overallStatus.color}`}>
                        {overallStatus.label}
                    </span>
                    {a2pRegistration && (
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-50"
                            title="Refresh status"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                        </button>
                    )}
                </div>
            </div>

            {!a2pRegistration ? (
                <div className="text-center py-6">
                    <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm mb-1">
                        A2P 10DLC registration is required for sending SMS in the US.
                    </p>
                    <p className="text-gray-400 text-xs mb-4">
                        This registers your business with carriers and typically takes 3-7 business days.
                    </p>
                    {error && (
                        <p className="text-red-600 text-sm mb-3 flex items-center justify-center gap-1">
                            <AlertTriangle className="w-4 h-4" />
                            {error}
                        </p>
                    )}
                    <button
                        onClick={handleStartRegistration}
                        disabled={starting}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                    >
                        {starting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Shield className="w-4 h-4" />
                        )}
                        {starting ? "Starting Registration..." : "Start A2P Registration"}
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Progress Steps */}
                    <div className="flex items-center justify-between">
                        {STEPS.map((step, index) => {
                            const status = getStepStatus(a2pRegistration, step.key);
                            return (
                                <div key={step.key} className="flex items-center flex-1">
                                    <div className="flex flex-col items-center text-center">
                                        {getStepIcon(status)}
                                        <span
                                            className={`text-xs mt-1.5 max-w-[80px] leading-tight ${
                                                status === "completed"
                                                    ? "text-green-600 font-medium"
                                                    : status === "active"
                                                    ? "text-amber-600 font-medium"
                                                    : status === "failed"
                                                    ? "text-red-600 font-medium"
                                                    : "text-gray-400"
                                            }`}
                                        >
                                            {step.label}
                                        </span>
                                    </div>
                                    {index < STEPS.length - 1 && (
                                        <div
                                            className={`flex-1 h-0.5 mx-2 mt-[-16px] ${
                                                status === "completed"
                                                    ? "bg-green-300"
                                                    : "bg-gray-200"
                                            }`}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Status Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                        {a2pRegistration.brand_sid && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">Brand SID</p>
                                <p className="text-sm font-mono text-gray-700 truncate">
                                    {a2pRegistration.brand_sid}
                                </p>
                            </div>
                        )}
                        {a2pRegistration.brand_status && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">Brand Status</p>
                                <p className={`text-sm font-medium ${
                                    a2pRegistration.brand_status === "APPROVED"
                                        ? "text-green-600"
                                        : a2pRegistration.brand_status === "FAILED"
                                        ? "text-red-600"
                                        : "text-amber-600"
                                }`}>
                                    {a2pRegistration.brand_status}
                                </p>
                            </div>
                        )}
                        {a2pRegistration.campaign_sid && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">Campaign SID</p>
                                <p className="text-sm font-mono text-gray-700 truncate">
                                    {a2pRegistration.campaign_sid}
                                </p>
                            </div>
                        )}
                        {a2pRegistration.campaign_status && a2pRegistration.campaign_status !== "awaiting_brand" && (
                            <div className="bg-gray-50 rounded-lg p-3">
                                <p className="text-xs text-gray-500">Campaign Status</p>
                                <p className={`text-sm font-medium ${
                                    a2pRegistration.campaign_status === "VERIFIED" || a2pRegistration.campaign_status === "APPROVED"
                                        ? "text-green-600"
                                        : a2pRegistration.campaign_status === "FAILED"
                                        ? "text-red-600"
                                        : "text-amber-600"
                                }`}>
                                    {a2pRegistration.campaign_status}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Submit Campaign — shown when brand is approved but no campaign yet */}
                    {brandApproved && noCampaignYet && !showCampaignForm && (
                        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-4 mt-3">
                            <CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <p className="text-sm text-blue-800 font-medium">Brand Approved — Ready for Campaign</p>
                                <p className="text-xs text-blue-600 mt-1">
                                    Your brand has been verified. Now submit your campaign details for carrier approval.
                                    This describes how you'll use SMS and costs $15 vetting + $15/month.
                                </p>
                                <button
                                    onClick={() => {
                                        setShowCampaignForm(true);
                                        setError("");
                                    }}
                                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                                >
                                    <Send className="w-4 h-4" />
                                    Submit Campaign
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Campaign Submission Form */}
                    {showCampaignForm && (
                        <div className="border border-blue-200 rounded-lg p-4 mt-3 space-y-4">
                            <h3 className="font-semibold text-gray-900 text-sm">Campaign Details (Low Volume)</h3>
                            <p className="text-xs text-gray-500">
                                Carriers review these details to approve your SMS usage. Be specific and honest.
                            </p>

                            {error && (
                                <p className="text-red-600 text-sm flex items-center gap-1">
                                    <AlertTriangle className="w-4 h-4" />
                                    {error}
                                </p>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Campaign Description
                                </label>
                                <textarea
                                    value={campaignForm.description}
                                    onChange={(e) => setCampaignForm((p) => ({ ...p, description: e.target.value }))}
                                    placeholder="e.g. Lead follow-up SMS for home services company. We contact leads who submitted inquiry forms to schedule appointments."
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                    rows={2}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Message Flow — How do users opt in?
                                </label>
                                <textarea
                                    value={campaignForm.messageFlow}
                                    onChange={(e) => setCampaignForm((p) => ({ ...p, messageFlow: e.target.value }))}
                                    placeholder="e.g. Users opt in by submitting a web form on our website requesting a quote. The form includes SMS consent checkbox."
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                    rows={2}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Sample Message 1
                                </label>
                                <input
                                    type="text"
                                    value={campaignForm.sampleMessages[0]}
                                    onChange={(e) => updateSampleMessage(0, e.target.value)}
                                    placeholder="e.g. Hi John, this is ABC Plumbing. Following up on your request. When works best to chat?"
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Sample Message 2
                                </label>
                                <input
                                    type="text"
                                    value={campaignForm.sampleMessages[1]}
                                    onChange={(e) => updateSampleMessage(1, e.target.value)}
                                    placeholder="e.g. ABC Plumbing here — just checking if you still need help with your AC repair. Reply YES to schedule."
                                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Opt-In Message
                                    </label>
                                    <textarea
                                        value={campaignForm.optInMessage}
                                        onChange={(e) => setCampaignForm((p) => ({ ...p, optInMessage: e.target.value }))}
                                        placeholder="e.g. You're now receiving messages from ABC Plumbing. Reply STOP to opt out."
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                        rows={2}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Opt-Out Message
                                    </label>
                                    <textarea
                                        value={campaignForm.optOutMessage}
                                        onChange={(e) => setCampaignForm((p) => ({ ...p, optOutMessage: e.target.value }))}
                                        placeholder="e.g. You've been unsubscribed from ABC Plumbing. Reply START to re-subscribe."
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                        rows={2}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Help Message
                                    </label>
                                    <textarea
                                        value={campaignForm.helpMessage}
                                        onChange={(e) => setCampaignForm((p) => ({ ...p, helpMessage: e.target.value }))}
                                        placeholder="e.g. For help, contact ABC Plumbing at support@abc.com or call (555) 123-4567. Reply STOP to opt out."
                                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                        rows={2}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    onClick={handleSubmitCampaign}
                                    disabled={submittingCampaign}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
                                >
                                    {submittingCampaign ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Send className="w-4 h-4" />
                                    )}
                                    {submittingCampaign ? "Submitting..." : "Submit Campaign for Review"}
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

                    {/* Warning for failed registrations */}
                    {(a2pRegistration.brand_status === "FAILED" || a2pRegistration.campaign_status === "FAILED") && (
                        <div className="flex items-start gap-2 bg-red-50 rounded-lg p-3 mt-3">
                            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm text-red-700 font-medium">Registration Failed</p>
                                <p className="text-xs text-red-600 mt-0.5">
                                    Your A2P registration was rejected. This may be due to incomplete business information.
                                    Please verify your onboarding profile and contact support if the issue persists.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Info for pending registrations */}
                    {a2pRegistration.brand_status === "pending" && (
                        <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-3 mt-3">
                            <Clock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm text-amber-700 font-medium">Review In Progress</p>
                                <p className="text-xs text-amber-600 mt-0.5">
                                    Brand registration is being reviewed by The Campaign Registry (TCR). This typically
                                    takes 3-7 business days. Click the refresh button to check for updates.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Info for pending campaign */}
                    {a2pRegistration.campaign_status === "pending_approval" && (
                        <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-3 mt-3">
                            <Clock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm text-amber-700 font-medium">Campaign Under Review</p>
                                <p className="text-xs text-amber-600 mt-0.5">
                                    Your campaign is being reviewed by carriers. This typically takes 1-3 business days.
                                    Click the refresh button to check for updates.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
