"use client";

import { useState } from "react";
import { SignUp } from "@clerk/nextjs";
import { AuthLayout } from "@/components/auth/auth-layout";
import { dark } from "@clerk/themes";
import { Check } from "lucide-react";

export default function SignUpPage() {
    const [accepted, setAccepted] = useState(false);

    return (
        <AuthLayout
            title="Create an account"
            subtitle="Get started with Omnify today"
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
                    <SignUp
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
                        signInUrl="/sign-in"
                        forceRedirectUrl="/"
                    />
                </div>

                {/* Terms & Privacy acknowledgment */}
                <div className="border-t border-slate-800 pt-4">
                    <label className="flex items-center gap-3 cursor-pointer group">
                        <button
                            type="button"
                            onClick={() => setAccepted((v) => !v)}
                            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                accepted
                                    ? "border-emerald-500 bg-emerald-500"
                                    : "border-slate-600 bg-slate-800/40 group-hover:border-emerald-500/60"
                            }`}
                            aria-pressed={accepted}
                            aria-label="Accept Terms and Privacy"
                        >
                            {accepted && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <span className="text-sm text-slate-300 leading-snug select-none">
                            I agree to the{" "}
                            <a
                                href="/legal/terms"
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-400 underline hover:text-emerald-300"
                                onClick={(e) => e.stopPropagation()}
                            >
                                Terms of Service
                            </a>{" "}
                            and{" "}
                            <a
                                href="/legal/privacy"
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-400 underline hover:text-emerald-300"
                                onClick={(e) => e.stopPropagation()}
                            >
                                Privacy Policy
                            </a>
                            {!accepted && (
                                <span className="text-emerald-400 text-xs ml-1.5 font-medium">
                                    (required)
                                </span>
                            )}
                        </span>
                    </label>
                </div>
            </div>
        </AuthLayout>
    );
}
