"use client";

import { useState } from "react";
import { SignUp } from "@clerk/nextjs";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Check } from "lucide-react";

export default function SignUpPage() {
    const [accepted, setAccepted] = useState(false);

    return (
        <AuthLayout
            title="Create an account"
            subtitle="Get started with Omnify today"
        >
            <div className="space-y-5">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/60 cursor-pointer hover:border-emerald-300 transition-colors">
                    <button
                        type="button"
                        onClick={() => setAccepted((v) => !v)}
                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            accepted
                                ? "border-emerald-500 bg-emerald-500"
                                : "border-gray-300 bg-white"
                        }`}
                        aria-pressed={accepted}
                        aria-label="Accept compliance terms"
                    >
                        {accepted && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <span className="text-xs text-gray-600 leading-relaxed select-none">
                        I confirm that I have obtained prior express written
                        consent from every contact my AI agents will call or
                        message, and that I am solely responsible for compliance
                        with the TCPA, state and federal Do-Not-Call (DNC)
                        registries, and all other applicable communications
                        laws. Omnify is a software platform and assumes no
                        liability for outreach I conduct using the service. I
                        agree to the{" "}
                        <a
                            href="/legal/terms"
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 underline hover:text-emerald-800"
                        >
                            Terms of Service
                        </a>{" "}
                        and{" "}
                        <a
                            href="/legal/privacy"
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 underline hover:text-emerald-800"
                        >
                            Privacy Policy
                        </a>
                        .
                    </span>
                </label>

                <div
                    className={
                        accepted
                            ? ""
                            : "pointer-events-none opacity-50 select-none"
                    }
                    aria-disabled={!accepted}
                >
                    <SignUp
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
                        signInUrl="/sign-in"
                        forceRedirectUrl="/"
                    />
                </div>
                {!accepted && (
                    <p className="text-xs text-gray-500 text-center">
                        Please accept the compliance terms above to create your account.
                    </p>
                )}
            </div>
        </AuthLayout>
    );
}
