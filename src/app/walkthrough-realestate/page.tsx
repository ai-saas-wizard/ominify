import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Omnify Walkthrough — Real Estate",
    description: "A full walkthrough of the Omnify platform for real estate teams — from signup to a live AI agent.",
};

export default function WalkthroughPage() {
    return (
        <main className="min-h-screen bg-black flex items-center justify-center p-4">
            <video
                src="/omnify-walkthrough.mp4"
                controls
                playsInline
                preload="metadata"
                className="w-full max-w-6xl rounded-lg shadow-2xl"
            />
        </main>
    );
}
