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
} from "lucide-react";
import { startA2PRegistration, checkA2PStatus } from "@/app/actions/twilio-actions";
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

    if (registration.brand_sid) {
        return { label: "In Progress", color: "text-amber-600" };
    }

    return { label: "Not Started", color: "text-gray-500" };
}

export function A2PStatusCard({ clientId, a2pRegistration }: Props) {
    const router = useRouter();
    const [starting, setStarting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");

    const overallStatus = getOverallStatus(a2pRegistration);

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
                        {a2pRegistration.campaign_status && (
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
                </div>
            )}
        </div>
    );
}
