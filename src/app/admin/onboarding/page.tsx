import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Calendar, Clock, ExternalLink, Mail, User } from "lucide-react";

export const dynamic = "force-dynamic";

interface OnboardingRow {
    client_id: string;
    legal_business_name: string | null;
    onboarding_path: string | null;
    onboarding_call_scheduled_at: string | null;
    onboarding_call_invitee_email: string | null;
    onboarding_call_invitee_name: string | null;
    onboarding_call_event_uri: string | null;
    onboarding_call_requested_at: string | null;
    onboarding_call_answers: { question: string; answer: string }[] | null;
}

interface ClientRow {
    id: string;
    name: string;
    email: string;
    created_at: string;
    archived_at: string | null;
}

async function getOnboardingQueue() {
    const { data: profiles } = await supabase
        .from("tenant_profiles")
        .select(
            "client_id, legal_business_name, onboarding_path, onboarding_call_scheduled_at, onboarding_call_invitee_email, onboarding_call_invitee_name, onboarding_call_event_uri, onboarding_call_requested_at, onboarding_call_answers, onboarding_completed"
        )
        .in("onboarding_path", ["manual_call_pending", "manual_call_booked"])
        .neq("onboarding_completed", true);

    const profilesData = (profiles ?? []) as (OnboardingRow & {
        onboarding_completed: boolean | null;
    })[];

    if (profilesData.length === 0) {
        return { booked: [], pending: [] };
    }

    const clientIds = profilesData.map((p) => p.client_id);
    const { data: clients } = await supabase
        .from("clients")
        .select("id, name, email, created_at, archived_at")
        .in("id", clientIds);

    const clientMap = new Map<string, ClientRow>();
    (clients ?? []).forEach((c) => clientMap.set((c as ClientRow).id, c as ClientRow));

    const enriched = profilesData
        // An archived client is one the admin has deliberately put away, so it
        // should not keep nagging from the onboarding queue either. Rows whose
        // client row is missing entirely still show, same as before.
        .filter((p) => !clientMap.get(p.client_id)?.archived_at)
        .map((p) => ({
            ...p,
            client: clientMap.get(p.client_id) ?? null,
        }));

    const booked = enriched
        .filter((r) => r.onboarding_path === "manual_call_booked")
        .sort((a, b) => {
            const at = a.onboarding_call_scheduled_at;
            const bt = b.onboarding_call_scheduled_at;
            if (!at) return 1;
            if (!bt) return -1;
            return new Date(at).getTime() - new Date(bt).getTime();
        });

    const pending = enriched
        .filter((r) => r.onboarding_path === "manual_call_pending")
        .sort((a, b) => {
            const at = a.onboarding_call_requested_at;
            const bt = b.onboarding_call_requested_at;
            if (!at) return 1;
            if (!bt) return -1;
            return new Date(bt).getTime() - new Date(at).getTime();
        });

    return { booked, pending };
}

export default async function AdminOnboardingPage() {
    const { booked, pending } = await getOnboardingQueue();
    const generatedAt = new Date();

    return (
        <div className="px-8 py-6">
            <div className="mb-6 flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        Onboarding queue
                    </h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Clients waiting on a white-glove onboarding call.
                    </p>
                </div>
                <div className="text-xs text-gray-400">
                    Last refreshed {formatRelative(generatedAt.toISOString())}
                </div>
            </div>

            <section className="mb-10">
                <div className="mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    <h2 className="text-sm font-semibold text-gray-900">
                        Booked
                    </h2>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        {booked.length}
                    </span>
                </div>
                {booked.length === 0 ? (
                    <EmptyState text="No booked onboarding calls right now." />
                ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                        {booked.map((row, idx) => (
                            <Row
                                key={row.client_id}
                                row={row}
                                isLast={idx === booked.length - 1}
                                variant="booked"
                            />
                        ))}
                    </div>
                )}
            </section>

            <section>
                <div className="mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <h2 className="text-sm font-semibold text-gray-900">
                        Clicked but not booked
                    </h2>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                        {pending.length}
                    </span>
                </div>
                {pending.length === 0 ? (
                    <EmptyState text="No pending click-throughs." />
                ) : (
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                        {pending.map((row, idx) => (
                            <Row
                                key={row.client_id}
                                row={row}
                                isLast={idx === pending.length - 1}
                                variant="pending"
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function Row({
    row,
    isLast,
    variant,
}: {
    row: OnboardingRow & { client: ClientRow | null };
    isLast: boolean;
    variant: "booked" | "pending";
}) {
    const businessName =
        row.legal_business_name || row.client?.name || "Unknown business";
    const inviteeName = row.onboarding_call_invitee_name || row.client?.name;
    const inviteeEmail =
        row.onboarding_call_invitee_email || row.client?.email;

    return (
        <details
            className={`group [&_summary::-webkit-details-marker]:hidden ${
                isLast ? "" : "border-b border-gray-100"
            }`}
        >
            <summary className="grid cursor-pointer grid-cols-12 items-center gap-4 px-5 py-4 hover:bg-gray-50">
                <div className="col-span-4 min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                        {businessName}
                    </div>
                    {inviteeName && (
                        <div className="truncate text-xs text-gray-500">
                            <User className="mr-1 inline h-3 w-3" />
                            {inviteeName}
                        </div>
                    )}
                </div>
                <div className="col-span-3 min-w-0">
                    {variant === "booked" && row.onboarding_call_scheduled_at ? (
                        <>
                            <div className="text-sm text-gray-900">
                                {formatAbsolute(row.onboarding_call_scheduled_at)}
                            </div>
                            <div className="text-xs text-gray-500">
                                {formatRelative(row.onboarding_call_scheduled_at)}
                            </div>
                        </>
                    ) : variant === "pending" &&
                      row.onboarding_call_requested_at ? (
                        <>
                            <div className="text-sm text-gray-900">
                                Clicked {formatRelative(
                                    row.onboarding_call_requested_at
                                )}
                            </div>
                            <div className="text-xs text-gray-500">
                                {formatAbsolute(row.onboarding_call_requested_at)}
                            </div>
                        </>
                    ) : (
                        <div className="text-xs text-gray-400">No timestamp</div>
                    )}
                </div>
                <div className="col-span-3 min-w-0">
                    {inviteeEmail && (
                        <div className="truncate text-xs text-gray-500">
                            <Mail className="mr-1 inline h-3 w-3" />
                            {inviteeEmail}
                        </div>
                    )}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2">
                    {variant === "booked" && row.onboarding_call_event_uri && (
                        <a
                            href={row.onboarding_call_event_uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-gray-600 hover:text-gray-900"
                        >
                            Calendly{" "}
                            <ExternalLink className="ml-0.5 inline h-3 w-3" />
                        </a>
                    )}
                    <Link
                        href={`/client/${row.client_id}/onboarding`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                        Configure Now
                    </Link>
                </div>
            </summary>

            {row.onboarding_call_answers &&
                Array.isArray(row.onboarding_call_answers) &&
                row.onboarding_call_answers.length > 0 && (
                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            Calendly answers
                        </div>
                        <dl className="grid gap-3 md:grid-cols-2">
                            {row.onboarding_call_answers.map((qa, idx) => (
                                <div key={idx}>
                                    <dt className="text-xs font-medium text-gray-700">
                                        {qa.question}
                                    </dt>
                                    <dd className="mt-0.5 text-sm text-gray-900 break-words whitespace-pre-wrap">
                                        {qa.answer || (
                                            <span className="text-gray-400">
                                                (no answer)
                                            </span>
                                        )}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
        </details>
    );
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-500">
            {text}
        </div>
    );
}

function formatAbsolute(iso: string): string {
    try {
        return new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }).format(new Date(iso));
    } catch {
        return iso;
    }
}

function formatRelative(iso: string): string {
    try {
        const then = new Date(iso).getTime();
        const now = Date.now();
        const diffSec = Math.round((then - now) / 1000);
        const absSec = Math.abs(diffSec);
        const future = diffSec > 0;
        const fmt = (n: number, unit: string) =>
            future
                ? `in ${n} ${unit}${n === 1 ? "" : "s"}`
                : `${n} ${unit}${n === 1 ? "" : "s"} ago`;
        if (absSec < 60) return future ? "just now" : "just now";
        if (absSec < 3600) return fmt(Math.round(absSec / 60), "min");
        if (absSec < 86400) return fmt(Math.round(absSec / 3600), "hour");
        return fmt(Math.round(absSec / 86400), "day");
    } catch {
        return "";
    }
}
