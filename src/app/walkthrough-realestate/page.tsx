import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Omnify Walkthrough — Real Estate",
    description: "A full walkthrough of the Omnify platform for real estate teams — from signup to a live AI agent.",
};

export default function WalkthroughPage() {
    return (
        <main className="min-h-screen bg-black flex items-center justify-center p-4">
            <iframe
                src="https://www.youtube.com/embed/KSOjqzhN4GY?rel=0"
                title="Omnify Walkthrough — Real Estate"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="w-full max-w-6xl aspect-video rounded-lg shadow-2xl bg-black"
            />
        </main>
    );
}
