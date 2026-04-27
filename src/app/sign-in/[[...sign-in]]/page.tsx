"use client";

import { useState } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthLayout } from "@/components/auth/auth-layout";
import { dark } from "@clerk/themes";
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
                            baseTheme: dark,
                            elements: {
                                rootBox: "w-full",
                                card: "shadow-none border-0 bg-transparent p-0",
                                headerTitle: "hidden",
                                headerSubtitle: "hidden",
                                socialButtonsBlockButton:
                                    "bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 hover:border-emerald-500/40 text-white rounded-lg py-3 transition-all duration-200",
                                socialButtonsBlockButtonText: "font-medium text-white",
                                socialButtonsProviderIcon: "w-5 h-5",
                                dividerLine: "bg-slate-700/50",
                                dividerText: "text-slate-500 text-xs uppercase tracking-wider",
                                formFieldInput:
                                    "bg-slate-800/60 border border-slate-700/50 text-white rounded-lg py-3 px-4 placeholder:text-slate-500 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-all duration-200",
                                formFieldLabel: "text-slate-300 text-sm font-medium mb-1",
                                formButtonPrimary:
                                    "bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold rounded-lg py-3 transition-all duration-200 shadow-lg shadow-emerald-500/20",
                                footerAction: "mt-6",
                                footerActionText: "text-slate-400",
                                footerActionLink: "text-emerald-400 hover:text-emerald-300 font-medium hover:underline",
                                formFieldInputShowPasswordButton: "text-slate-400 hover:text-emerald-400",
                                identityPreviewEditButton: "text-emerald-400 hover:text-emerald-300",
                                formResendCodeLink: "text-emerald-400 hover:text-emerald-300",
                                otpCodeFieldInput: "bg-slate-800/60 border border-slate-700/50 text-white",
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
                <div className="border-t border-slate-800 pt-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setAccepted((v) => !v)}
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                accepted
                                    ? "border-emerald-500 bg-emerald-500"
                                    : "border-slate-600 bg-slate-800/40 hover:border-emerald-500/60"
                            }`}
                            aria-pressed={accepted}
                            aria-label="Reaffirm compliance terms"
                        >
                            {accepted && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="flex-1 flex items-center justify-between text-left text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            <span>
                                I confirm TCPA, DNC &amp; recording-law compliance
                                {!accepted && (
                                    <span className="text-emerald-400 text-xs ml-1.5 font-medium">
                                        (required)
                                    </span>
                                )}
                            </span>
                            <ChevronDown
                                className={`w-4 h-4 text-slate-500 transition-transform ${
                                    expanded ? "rotate-180" : ""
                                }`}
                            />
                        </button>
                    </div>
                    {expanded && (
                        <p className="mt-3 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 text-xs text-slate-300 leading-relaxed">
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
