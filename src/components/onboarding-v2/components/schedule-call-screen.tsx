"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
    ArrowLeft,
    CheckCircle2,
    Calendar as CalendarIcon,
    Clock,
    ExternalLink,
    Loader2,
    AlertTriangle,
} from "lucide-react";
import { InlineWidget, useCalendlyEventListener } from "react-calendly";
import { getCaseStudiesForIndustry } from "../case-studies";
import type { OnboardingCallBooking } from "../types";

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
    {
        q: "How long is the call?",
        a: "15-30 minutes — usually closer to 25.",
    },
    {
        q: "Will my AI be ready by the end?",
        a: "Yes. We configure everything live so you walk away with working agents.",
    },
    {
        q: "What do I need to prepare?",
        a: "Just your business website and a rough idea of the calls you want AI to handle. We'll cover everything else.",
    },
    {
        q: "Can I reschedule?",
        a: "Yes — you'll get a reschedule link in the confirmation email.",
    },
    {
        q: "Do I need to be at my computer?",
        a: "Yes — we'll be sharing screens and configuring your account live, so a phone-only call won't work.",
    },
    {
        q: "Will the call be recorded?",
        a: "Only with your permission. We'll always ask first.",
    },
];

interface ScheduleCallScreenProps {
    mode: "picker" | "booked-confirmation";
    clientId: string;
    userEmail: string | null;
    userName: string;
    industry?: string | null;
    booking?: OnboardingCallBooking | null;
    onBack?: () => void;
}

export function ScheduleCallScreen({
    mode,
    clientId,
    userEmail,
    userName,
    industry,
    booking,
    onBack,
}: ScheduleCallScreenProps) {
    if (mode === "booked-confirmation" && booking) {
        return (
            <BookedConfirmation
                booking={booking}
                userName={userName}
                industry={industry}
                onBack={onBack}
            />
        );
    }

    return (
        <PickerMode
            clientId={clientId}
            userEmail={userEmail}
            userName={userName}
            onBack={onBack}
        />
    );
}

function PickerMode({
    clientId,
    userEmail,
    userName,
    onBack,
}: {
    clientId: string;
    userEmail: string | null;
    userName: string;
    onBack?: () => void;
}) {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const calendlyUrl = process.env.NEXT_PUBLIC_ONBOARDING_CALENDLY_URL;

    useCalendlyEventListener({
        onEventScheduled: () => {
            setConfirming(true);
            setTimeout(() => router.refresh(), 1500);
        },
    });

    return (
        <div className="min-h-screen bg-gray-50 px-6 py-10">
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mx-auto max-w-6xl"
            >
                {onBack && (
                    <button
                        onClick={onBack}
                        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to options
                    </button>
                )}

                <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            Set up your AI agents with our team — live.
                        </h1>
                        <p className="mt-3 text-sm leading-relaxed text-gray-600">
                            Pick a time below. We&apos;ll jump on a call, walk through
                            your business together, and configure your AI voice agents
                            on screen with you. By the end you&apos;ll have working
                            agents ready to take real calls.
                        </p>

                        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                <CalendarIcon className="h-4 w-4 text-emerald-600" />
                                What to expect
                            </div>
                            <ul className="mt-3 space-y-2 text-sm text-gray-600">
                                <li className="flex gap-2">
                                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                                    <span>15-30 min, screen-share with our onboarding team</span>
                                </li>
                                <li className="flex gap-2">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                                    <span>Live agent configuration — your AI is ready by the end</span>
                                </li>
                                <li className="flex gap-2">
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                                    <span>We test a real call together before you go live</span>
                                </li>
                            </ul>
                        </div>

                        <FaqAccordion className="mt-6" />
                    </div>

                    <div className="relative rounded-xl border border-gray-200 bg-white">
                        {!calendlyUrl ? (
                            <div className="flex items-start gap-3 p-6 text-sm text-amber-800">
                                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                                <div>
                                    <div className="font-medium">
                                        Booking link not configured
                                    </div>
                                    <div className="mt-1 text-amber-700">
                                        Set <code className="rounded bg-amber-100 px-1">
                                            NEXT_PUBLIC_ONBOARDING_CALENDLY_URL
                                        </code>{" "}
                                        in your environment to enable scheduling.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <InlineWidget
                                    url={calendlyUrl}
                                    prefill={{
                                        email: userEmail ?? undefined,
                                        name: userName,
                                        customAnswers: {
                                            a1: clientId,
                                        },
                                    }}
                                    pageSettings={{
                                        backgroundColor: "ffffff",
                                        primaryColor: "059669",
                                        textColor: "111827",
                                        hideEventTypeDetails: false,
                                        hideLandingPageDetails: false,
                                    }}
                                    styles={{ minHeight: 720, height: "100%" }}
                                />
                                {confirming && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-white/95 backdrop-blur-sm">
                                        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
                                        <div className="text-sm font-medium text-gray-900">
                                            Confirming your booking…
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            One moment, finalizing the details.
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function BookedConfirmation({
    booking,
    userName,
    industry,
    onBack,
}: {
    booking: OnboardingCallBooking;
    userName: string;
    industry?: string | null;
    onBack?: () => void;
}) {
    const firstName = useMemo(
        () => (userName ? userName.split(" ")[0] : "there"),
        [userName]
    );
    const formattedDate = useMemo(
        () => formatScheduledAt(booking.scheduledAt),
        [booking.scheduledAt]
    );
    const caseStudies = useMemo(
        () => getCaseStudiesForIndustry(industry, 2),
        [industry]
    );
    const loomUrl = process.env.NEXT_PUBLIC_ONBOARDING_INTRO_LOOM_URL;

    return (
        <div className="min-h-screen bg-gray-50 px-6 py-10">
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mx-auto max-w-6xl"
            >
                {onBack && (
                    <button
                        onClick={onBack}
                        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to options
                    </button>
                )}

                <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Call scheduled
                        </div>
                        <h1 className="mt-4 text-2xl font-bold text-gray-900">
                            You&apos;re all set, {firstName}.
                        </h1>
                        <p className="mt-3 text-sm leading-relaxed text-gray-600">
                            Your onboarding call is scheduled for{" "}
                            <span className="font-medium text-gray-900">
                                {formattedDate}
                            </span>
                            . We&apos;ll configure your AI agents live with you on the
                            call — by the end, they&apos;ll be ready to take real
                            conversations.
                        </p>

                        {loomUrl && (
                            <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-black">
                                <iframe
                                    src={loomUrl}
                                    title="Onboarding intro"
                                    allowFullScreen
                                    allow="autoplay; encrypted-media"
                                    className="aspect-video w-full"
                                />
                            </div>
                        )}

                        {caseStudies.length > 0 && (
                            <div className="mt-6">
                                <div className="text-sm font-medium text-gray-900">
                                    What other businesses got out of their call
                                </div>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    {caseStudies.map((cs) => (
                                        <div
                                            key={cs.id}
                                            className="rounded-xl border border-gray-200 bg-white p-4"
                                        >
                                            <p className="text-sm leading-relaxed text-gray-700">
                                                &ldquo;{cs.quote}&rdquo;
                                            </p>
                                            <div className="mt-3 text-xs text-gray-500">
                                                <span className="font-medium text-gray-900">
                                                    {cs.name}
                                                </span>{" "}
                                                — {cs.role}, {cs.company}
                                            </div>
                                            {cs.metric && (
                                                <div className="mt-1.5 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                                                    {cs.metric}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <FaqAccordion className="mt-6" />
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-xl border border-gray-200 bg-white p-5">
                            <div className="text-sm font-medium text-gray-900">
                                Your call details
                            </div>
                            <dl className="mt-3 space-y-3 text-sm">
                                <div>
                                    <dt className="text-gray-500">When</dt>
                                    <dd className="mt-0.5 font-medium text-gray-900">
                                        {formattedDate}
                                    </dd>
                                </div>
                                {booking.inviteeEmail && (
                                    <div>
                                        <dt className="text-gray-500">
                                            Invitation sent to
                                        </dt>
                                        <dd className="mt-0.5 font-medium text-gray-900 break-all">
                                            {booking.inviteeEmail}
                                        </dd>
                                    </div>
                                )}
                            </dl>
                            <div className="mt-4 flex flex-col gap-2">
                                {booking.rescheduleUrl && (
                                    <a
                                        href={booking.rescheduleUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        Need to change time?
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                )}
                                {booking.cancelUrl && (
                                    <CancelButton url={booking.cancelUrl} />
                                )}
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-white p-5">
                            <div className="text-sm font-medium text-gray-900">
                                While you wait
                            </div>
                            <ul className="mt-3 space-y-2 text-sm">
                                <li>
                                    <a
                                        href="https://omnify.ai/docs"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800"
                                    >
                                        Read the docs
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </li>
                                <li>
                                    <a
                                        href="https://omnify.ai"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800"
                                    >
                                        2-min product overview
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function CancelButton({ url }: { url: string }) {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            !confirm(
                "Cancelling will mark you as not scheduled and remove this call from your account. Continue?"
            )
        ) {
            e.preventDefault();
        }
    };

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-red-600"
        >
            Can&apos;t make it?
        </a>
    );
}

function FaqAccordion({ className }: { className?: string }) {
    return (
        <div className={className}>
            <div className="text-sm font-medium text-gray-900">
                Frequently asked
            </div>
            <div className="mt-3 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
                {FAQ_ITEMS.map((item, idx) => (
                    <details
                        key={idx}
                        className="group p-4 [&_summary::-webkit-details-marker]:hidden"
                    >
                        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-gray-900">
                            {item.q}
                            <span className="ml-2 text-gray-400 transition-transform group-open:rotate-45">
                                +
                            </span>
                        </summary>
                        <p className="mt-2 text-sm text-gray-600">{item.a}</p>
                    </details>
                ))}
            </div>
        </div>
    );
}

function formatScheduledAt(iso: string): string {
    try {
        return new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
        }).format(new Date(iso));
    } catch {
        return iso;
    }
}
