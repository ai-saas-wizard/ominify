import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Text Logo */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-white tracking-tight">
                        <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                            INDRIS
                        </span>
                    </h1>
                    <p className="text-slate-400 mt-4">Welcome back</p>
                    <p className="text-slate-500 text-sm">Sign in to access your dashboard</p>
                </div>

                <SignIn
                    appearance={{
                        elements: {
                            rootBox: "mx-auto",
                            card: "shadow-2xl border border-slate-700 bg-slate-800/50 backdrop-blur",
                            headerTitle: "hidden",
                            headerSubtitle: "hidden",
                            socialButtonsBlockButton: "border border-slate-600 hover:bg-slate-700 text-white",
                            formButtonPrimary: "bg-indigo-600 hover:bg-indigo-700",
                            formFieldInput: "bg-slate-700 border-slate-600 text-white",
                            formFieldLabel: "text-slate-300",
                            footerActionLink: "text-indigo-400 hover:text-indigo-300",
                        }
                    }}
                    signUpUrl="/sign-up"
                    forceRedirectUrl="/"
                />

                {/* Powered by */}
                <p className="text-center text-slate-500 text-xs mt-8">
                    Powered by <span className="text-slate-400 font-medium">Elevate With AI</span>
                </p>
            </div>
        </div>
    );
}
