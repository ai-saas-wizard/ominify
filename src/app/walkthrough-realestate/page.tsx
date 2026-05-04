import type { Metadata } from "next";
import { WalkthroughBody } from "./walkthrough-body";

export const metadata: Metadata = {
    title: "Omnify Walkthrough — Real Estate",
    description: "A full walkthrough of the Omnify platform for real estate teams — from signup to a live AI agent.",
};

export default function WalkthroughPage() {
    return <WalkthroughBody />;
}
