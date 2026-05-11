"use client";

import { SignIn } from "@clerk/nextjs";
import { AuthLayout } from "@/components/auth/auth-layout";
import { dark } from "@clerk/themes";

export default function SignInPage() {
    return (
        <AuthLayout
            title="Welcome back"
            subtitle="Sign in to access your dashboard"
        >
            <div className="space-y-4">
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

                <p className="text-xs text-slate-500 text-center leading-relaxed pt-2 border-t border-slate-800">
                    By signing in, you agree to our{" "}
                    <a
                        href="/legal/terms"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 underline"
                    >
                        Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                        href="/legal/privacy"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:text-emerald-300 underline"
                    >
                        Privacy Policy
                    </a>
                    .
                </p>
            </div>
        </AuthLayout>
    );
}
