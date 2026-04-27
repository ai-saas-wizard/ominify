import Link from "next/link";
import Image from "next/image";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-white text-gray-900">
            <header className="border-b border-gray-200">
                <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <Image
                            src="/omnify-logo.png"
                            alt="Omnify"
                            width={28}
                            height={28}
                            className="rounded-md"
                        />
                        <span className="font-semibold tracking-tight">Omnify</span>
                    </Link>
                    <nav className="flex items-center gap-5 text-sm">
                        <Link href="/legal/terms" className="text-gray-600 hover:text-gray-900">
                            Terms
                        </Link>
                        <Link href="/legal/privacy" className="text-gray-600 hover:text-gray-900">
                            Privacy
                        </Link>
                        <Link href="/sign-in" className="text-gray-600 hover:text-gray-900">
                            Sign in
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-12">
                <article className="legal-doc">
                    {children}
                </article>
            </main>

            <footer className="border-t border-gray-200 mt-16">
                <div className="max-w-3xl mx-auto px-6 py-8 text-xs text-gray-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span>
                        © {new Date().getFullYear()} Omnify. Built by Elevate With AI. All rights reserved.
                    </span>
                    <span className="flex items-center gap-4">
                        <Link href="/legal/terms" className="hover:text-gray-700">Terms of Service</Link>
                        <Link href="/legal/privacy" className="hover:text-gray-700">Privacy Policy</Link>
                    </span>
                </div>
            </footer>
        </div>
    );
}
