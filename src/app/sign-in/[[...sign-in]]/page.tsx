"use client";

import { useState } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Check, ChevronDown } from "lucide-react";

export default function SignInPage() {
    const [accepted, setAccepted] = useState(false);
    const [expanded, setExpanded] = useState(false);

    return (
        <AuthLayout
            title="Welcome back"
            subtitle="Sign in to access your dashboard"
        >
            <div className="space-y-5">
                <div
                    className={
                        accepted
                            ? ""
                            : "pointer-events-none opacity-60 select-none transition-opacity"
                    }
                    aria-disabled={!accepted}
                >
                    <SignIn
                        appearance={{
                            elements: {
                                rootBox: "w-full",
                                card: "shadow-none border-0 bg-transparent p-0",
                                headerTitle: "hidden",
                                headerSubtitle: "hidden",
                                socialButtonsBlockButton:
                                    "bg-white border border-gray-200 hover:bg-gray-50 hover:border-emerald-300 text-gray-900 rounded-lg py-3 transition-all duration-200",
                                socialButtonsBlockButtonText: "font-medium text-gray-900",
                                socialButtonsProviderIcon: "w-5 h-5",
                                dividerLine: "bg-gray-200",
                                dividerText: "text-gray-400 text-xs uppercase tracking-wider",
                                formFieldInput:
                                    "bg-white border border-gray-300 text-gray-900 rounded-lg py-3 px-4 placeholder:text-gray-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all duration-200",
                                formFieldLabel: "text-gray-700 text-sm font-medium mb-1",
                                formButtonPrimary:
                                    "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg py-3 transition-all duration-200 shadow-sm",
                                footerAction: "mt-6",
                                footerActionText: "text-gray-500",
                                footerActionLink: "text-emerald-700 hover:text-emerald-800 font-medium hover:underline",
                                formFieldInputShowPasswordButton: "text-gray-400 hover:text-emerald-700",
                                identityPreviewEditButton: "text-emerald-700 hover:text-emerald-800",
                                formResendCodeLink: "text-emerald-700 hover:text-emerald-800",
                                otpCodeFieldInput: "bg-white border border-gray-300 text-gray-900",
                            },
                            layout: {
                                socialButtonsPlacement: "top",
                                showOptionalFields: false,
                            }
                        }}
                        signUpUrl="/sign-up"
                        forceRedirectUrl="/"
                    />
                </div>

                {/* Compliance acknowledgment — expandable */}
                <div className="border-t border-gray-200 pt-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setAccepted((v) => !v)}
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                accepted
                                    ? "border-emerald-500 bg-emerald-500"
                                    : "border-gray-300 bg-white hover:border-emerald-400"
                            }`}
                            aria-pressed={accepted}
                            aria-label="Reaffirm compliance terms"
                        >
                            {accepted && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="flex-1 flex items-center justify-between text-left text-sm text-gray-700 hover:text-gray-900 transition-colors"
                        >
                            <span>
                                I confirm TCPA, DNC &amp; recording-law compliance
                                {!accepted && (
                                    <span className="text-emerald-700 text-xs ml-1.5 font-medium">
                                        (required)
                                    </span>
                                )}
                            </span>
                            <ChevronDown
                                className={`w-4 h-4 text-gray-400 transition-transform ${
                                    expanded ? "rotate-180" : ""
                                }`}
                            />
                        </button>
                    </div>
                    {expanded && (
                        <p className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600 leading-relaxed">
                            I reaffirm that I have prior express written consent
                            from every contact my AI agents will reach, and that
                            I am solely responsible for TCPA, DNC, and other
                            applicable communications-law compliance. Omnify is
                            not liable for any outreach I conduct using the
                            platform.
                        </p>
                    )}
                </div>
            </div>
        </AuthLayout>
    );
}
