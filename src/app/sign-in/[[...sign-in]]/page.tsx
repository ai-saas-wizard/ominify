import { SignIn } from "@clerk/nextjs";
import { AuthLayout } from "@/components/auth/auth-layout";

export default function SignInPage() {
    return (
        <AuthLayout
            title="Welcome back"
            subtitle="Sign in to access your dashboard and manage your AI agents."
        >
            <SignIn
                appearance={{
                    elements: {
                        rootBox: "w-full",
                        card: "shadow-none border-0 bg-transparent p-0",
                        headerTitle: "hidden",
                        headerSubtitle: "hidden",
                        socialButtonsBlockButton:
                            "bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/60 hover:border-teal-500/30 text-white rounded-lg py-3 transition-all duration-200",
                        socialButtonsBlockButtonText: "font-medium",
                        socialButtonsProviderIcon: "w-5 h-5",
                        dividerLine: "bg-slate-700/50",
                        dividerText: "text-slate-500 text-xs uppercase tracking-wider",
                        formFieldInput:
                            "bg-slate-800/60 border border-slate-700/50 text-white rounded-lg py-3 px-4 placeholder:text-slate-500 focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all duration-200",
                        formFieldLabel: "text-slate-300 text-sm font-medium mb-1",
                        formButtonPrimary:
                            "bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-white font-semibold rounded-lg py-3 transition-all duration-200 shadow-lg shadow-teal-500/20",
                        footerAction: "mt-6",
                        footerActionText: "text-slate-400",
                        footerActionLink: "text-teal-400 hover:text-teal-300 font-medium",
                        formFieldInputShowPasswordButton: "text-slate-400 hover:text-teal-400",
                        identityPreviewEditButton: "text-teal-400 hover:text-teal-300",
                        formResendCodeLink: "text-teal-400 hover:text-teal-300",
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
        </AuthLayout>
    );
}
