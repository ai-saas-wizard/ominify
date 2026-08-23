"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Check,
    Loader2,
    MessageSquare,
    Phone,
    Plus,
    Search,
    Shield,
    Link2,
    Trash2,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";
import { isA2PRegistered } from "@/lib/a2p-status";
import {
    disconnectTwilioAccount,
    purchasePhoneNumberForClient,
    releasePhoneNumberForClient,
    searchAvailableNumbers,
    adoptTwilioNumber,
} from "@/app/actions/twilio-actions";
import {
    assignPhoneNumberToAgent,
    unassignPhoneNumberFromAgent,
} from "@/app/actions/phone-assignment-actions";
import { TwilioAccountSetup } from "./twilio-account-setup";
import { A2PStatusCard } from "./a2p-status-card";

interface Props {
    clientId: string;
    clientName: string;
    twilioAccount: any;
    initialPhoneNumbers: any[];
    a2pRegistration: any;
    tenantProfile: any;
    agentMap?: Record<string, string>;
    agents?: { id: string; name: string }[];
    /** On the Twilio account but with no row of ours yet. */
    unlinkedNumbers?: UnlinkedNumber[];
}

export interface UnlinkedNumber {
    sid: string;
    phoneNumber: string;
    friendlyName: string | null;
    capabilities: { voice: boolean; sms: boolean };
    dateCreated: string | null;
}

// ── Shared bits, matching the other rebuilt pages ────────────────────────────

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500";
const CARD = "rounded-lg border border-gray-200 bg-white";
const BTN_SECONDARY =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-900 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
    "inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

/** The one place the table geometry is written, so header and rows cannot drift. */
const COLS =
    "grid grid-cols-[148px_minmax(0,1fr)_minmax(210px,260px)_92px_128px_92px_34px] items-center gap-3";

/** "+17866865958" reads as a phone number only once it is spaced out. */
function prettyNumber(e164: string): string {
    const digits = String(e164 || "").replace(/[^0-9]/g, "");
    if (digits.length === 11 && digits.startsWith("1")) {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return e164;
}

/** Account SIDs are long and only their ends identify them. */
function maskSid(sid: string): string {
    if (!sid || sid.length < 12) return sid || "";
    return `${sid.slice(0, 6)}···${sid.slice(-4)}`;
}

function shortDate(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US");
}

export function PhoneNumbersManager({
    clientId,
    clientName,
    twilioAccount,
    initialPhoneNumbers,
    a2pRegistration,
    tenantProfile,
    agentMap = {},
    agents = [],
    unlinkedNumbers = [],
}: Props) {
    const router = useRouter();
    const [buyOpen, setBuyOpen] = useState(false);
    const [regOpen, setRegOpen] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [connecting, setConnecting] = useState<string | null>(null);

    const hasAccount = !!twilioAccount;
    const isBYOT = twilioAccount?.account_type === "type_a_byoa";
    const numbers = initialPhoneNumbers || [];

    // A2P drives whether SMS is actually usable, so it decides half of this page.
    const smsReady = isA2PRegistered(a2pRegistration);
    const stage: "approved" | "in_review" | "not_started" = smsReady
        ? "approved"
        : a2pRegistration
          ? "in_review"
          : "not_started";

    const stageStyle = {
        approved: { chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", tile: "bg-emerald-50", icon: "text-emerald-600", label: "Approved" },
        in_review: { chip: "bg-amber-50 text-amber-700", dot: "bg-amber-500", tile: "bg-amber-50", icon: "text-amber-600", label: "In review" },
        not_started: { chip: "bg-gray-100 text-gray-600", dot: "bg-gray-400", tile: "bg-gray-100", icon: "text-gray-500", label: "Not started" },
    }[stage];

    const entryNote = {
        approved:
            "Your brand and campaign are approved, so your numbers can text. Open the registration to review what was submitted.",
        in_review:
            "Submitted and waiting on carrier review. Nothing is needed from you, open it to see which step is in flight.",
        not_started:
            "Required before any US texting. Voice calling works without it, and SMS steps in your sequences are held until it clears.",
    }[stage];

    const entryCta = {
        approved: "View registration",
        in_review: "View progress",
        not_started: "Start registration",
    }[stage];

    const activeNumbers = numbers.filter((n: any) => n.status === "active");
    const stats = [
        {
            label: "Numbers",
            value: String(numbers.length),
            // Saying "on this account" while unadopted numbers sit below would
            // contradict the section under the table.
            sub: unlinkedNumbers.length
                ? `${unlinkedNumbers.length} not connected`
                : "on this account",
            dot: "bg-gray-400",
            tone: "text-gray-900",
        },
        { label: "Voice ready", value: String(activeNumbers.length), sub: activeNumbers.length === numbers.length ? "all numbers" : "of " + numbers.length, dot: "bg-emerald-500", tone: "text-gray-900" },
        {
            label: "SMS ready",
            value: smsReady ? String(activeNumbers.length) : "0",
            sub: smsReady ? "campaign approved" : "needs A2P",
            dot: smsReady ? "bg-emerald-500" : "bg-amber-500",
            tone: smsReady ? "text-gray-900" : "text-amber-700",
        },
        { label: "A2P status", value: stageStyle.label, sub: "", dot: stageStyle.dot, tone: "text-gray-900" },
    ];

    const handleAssign = useCallback(
        async (phoneNumberId: string, agentId: string) => {
            if (!agentId) return;
            setBusyId(phoneNumberId);
            setError(null);
            const res = await assignPhoneNumberToAgent(clientId, phoneNumberId, agentId);
            setBusyId(null);
            if (res?.success) router.refresh();
            else setError(res?.error || "Could not assign that agent");
        },
        [clientId, router]
    );

    const handleUnassign = useCallback(
        async (phoneNumberId: string) => {
            setBusyId(phoneNumberId);
            setError(null);
            const res = await unassignPhoneNumberFromAgent(clientId, phoneNumberId);
            setBusyId(null);
            if (res?.success) router.refresh();
            else setError(res?.error || "Could not unassign that number");
        },
        [clientId, router]
    );

    const handleRelease = useCallback(
        async (phoneNumberId: string, label: string) => {
            if (
                !confirm(
                    `Release ${label}? The number goes back to Twilio immediately and cannot be recovered.`
                )
            )
                return;
            setBusyId(phoneNumberId);
            setError(null);
            const res = await releasePhoneNumberForClient(clientId, phoneNumberId);
            setBusyId(null);
            if (res?.success) router.refresh();
            else setError(res?.error || "Could not release that number");
        },
        [clientId, router]
    );

    const handleConnect = useCallback(
        async (sid: string) => {
            setConnecting(sid);
            setError(null);
            const res = await adoptTwilioNumber(clientId, sid);
            setConnecting(null);
            if (res?.success) {
                if (res.warning) {
                    setError(
                        `Connected, but VAPI registration failed: ${res.warning}. Calls to it will not route until that is retried.`
                    );
                }
                router.refresh();
            } else {
                setError(res?.error || "Could not connect that number");
            }
        },
        [clientId, router]
    );

    async function handleDisconnect() {
        if (
            !confirm(
                "Disconnect this Twilio account? Numbers stay in Twilio, but Omnify stops using them until you reconnect."
            )
        )
            return;
        const res = await disconnectTwilioAccount(clientId);
        if (res?.success) router.refresh();
        else setError(res?.error || "Could not disconnect the account");
    }

    if (!hasAccount) {
        return (
            <div className="flex h-full min-h-0 min-w-[1000px] flex-col bg-gray-50">
                <header className="flex flex-none items-center gap-2.5 border-b border-gray-200 bg-white px-5 pb-3 pt-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                        <Phone className="h-4 w-4" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-gray-900">
                            Phone numbers
                        </h1>
                        <p className="text-[11.5px] text-gray-500">
                            Connect Twilio to buy numbers and start calling.
                        </p>
                    </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                    <TwilioAccountSetup clientId={clientId} />
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 min-w-[1000px] flex-col bg-gray-50">
            {/* ---- Header ---- */}
            <header className="flex flex-none items-center gap-2.5 border-b border-gray-200 bg-white px-5 pb-3 pt-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                    <Phone className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-gray-900">
                        Phone numbers
                    </h1>
                    {/* The account identity lives in the subtitle rather than its own
                        card, since it is reference material and not a task. */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-gray-500">
                        <span>Twilio</span>
                        <span className="text-gray-300">·</span>
                        <span className="tabular-nums">
                            {maskSid(twilioAccount.subaccount_sid || twilioAccount.external_account_sid || "")}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="truncate">{clientName}</span>
                        {isBYOT && (
                            <span className="inline-flex h-[18px] items-center rounded bg-blue-50 px-1.5 text-[10.5px] font-semibold text-blue-700">
                                BYOT
                            </span>
                        )}
                        <span className="inline-flex h-[18px] items-center gap-1.5 rounded bg-emerald-50 px-1.5 text-[10.5px] font-semibold text-emerald-700">
                            <span className="h-1 w-1 rounded-full bg-emerald-500" />
                            Connected
                        </span>
                        <button
                            type="button"
                            onClick={handleDisconnect}
                            className={cn("rounded text-[11.5px] text-gray-500 hover:text-gray-900", seqFocusRing)}
                        >
                            Disconnect
                        </button>
                    </div>
                </div>
                <div className="flex flex-none items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setBuyOpen(true)}
                        className={cn(BTN_PRIMARY, seqFocusRing)}
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Buy number
                    </button>
                </div>
            </header>

            {/* ---- Stat strip ---- */}
            <div className="grid flex-none grid-cols-4 border-b border-gray-200 bg-white">
                {stats.map((s) => (
                    <div
                        key={s.label}
                        className="flex flex-col gap-1.5 border-r border-gray-100 px-4 py-3 last:border-r-0"
                    >
                        <div className="flex items-center gap-1.5">
                            <span className={cn("h-[5px] w-[5px] rounded-full", s.dot)} />
                            <span className={LABEL}>{s.label}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className={cn("text-[19px] font-semibold tracking-[-0.02em] tabular-nums", s.tone)}>
                                {s.value}
                            </span>
                            {s.sub && <span className="text-[11px] text-gray-500">{s.sub}</span>}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-8 pt-3.5">
                {error && (
                    <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
                )}

                {/* ---- Numbers ---- */}
                <section className={CARD}>
                    <div className="flex items-baseline gap-2.5 border-b border-gray-100 px-3.5 pb-2.5 pt-3">
                        <span className="text-[13px] font-semibold text-gray-900">Your numbers</span>
                        <span className="text-[11.5px] text-gray-500">
                            {smsReady
                                ? "These numbers can place calls and send texts."
                                : "Voice is live. Texting unlocks when A2P registration clears."}
                        </span>
                    </div>

                    {numbers.length === 0 ? (
                        <p className="px-4 py-12 text-center text-[12.5px] text-gray-500">
                            No numbers yet. Buy one to start calling.
                        </p>
                    ) : (
                        <>
                            <div className={cn(COLS, "border-b border-gray-200 bg-gray-50 px-3.5 py-2")}>
                                <span className={LABEL}>Number</span>
                                <span className={LABEL}>Label</span>
                                <span className={LABEL}>Assigned agent</span>
                                <span className={LABEL}>Voice</span>
                                <span className={LABEL}>SMS</span>
                                <span className={cn(LABEL, "text-right")}>Added</span>
                                <span />
                            </div>
                            {numbers.map((n: any) => {
                                const assignedName = n.agent_id ? agentMap[n.agent_id] : null;
                                const busy = busyId === n.id;
                                return (
                                    <div
                                        key={n.id}
                                        className={cn(
                                            COLS,
                                            "border-b border-gray-50 px-3.5 py-2.5 transition-colors hover:bg-gray-50"
                                        )}
                                    >
                                        <span className="text-[13px] font-medium tabular-nums text-gray-900">
                                            {n.phone_number}
                                        </span>
                                        <span className="min-w-0 truncate text-[12.5px] text-gray-600">
                                            {n.friendly_name || prettyNumber(n.phone_number)}
                                        </span>

                                        <div className="min-w-0">
                                            {assignedName ? (
                                                <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-gray-200 px-2 text-[11.5px]">
                                                    <span className="min-w-0 truncate">{assignedName}</span>
                                                    <button
                                                        type="button"
                                                        title="Unassign"
                                                        disabled={busy}
                                                        onClick={() => handleUnassign(n.id)}
                                                        className={cn(
                                                            "grid h-3.5 w-3.5 flex-none place-items-center text-gray-400 hover:text-red-600 disabled:opacity-50",
                                                            seqFocusRing
                                                        )}
                                                    >
                                                        {busy ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                            <X className="h-3 w-3" />
                                                        )}
                                                    </button>
                                                </span>
                                            ) : (
                                                <select
                                                    aria-label={`Assign an agent to ${n.phone_number}`}
                                                    defaultValue=""
                                                    disabled={busy}
                                                    onChange={(e) => handleAssign(n.id, e.target.value)}
                                                    className="h-7 w-full rounded-md border border-dashed border-gray-300 bg-white px-1.5 text-xs text-gray-600 outline-none transition-colors focus:border-solid focus:border-emerald-600 disabled:opacity-50"
                                                >
                                                    <option value="">Assign an agent…</option>
                                                    {agents.map((a) => (
                                                        <option key={a.id} value={a.id}>
                                                            {a.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>

                                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                                            <Check className="h-3.5 w-3.5" />
                                            Ready
                                        </span>

                                        <span
                                            className={cn(
                                                "inline-flex items-center gap-1.5 text-xs",
                                                smsReady ? "text-emerald-700" : "text-amber-700"
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "h-[5px] w-[5px] rounded-full",
                                                    smsReady ? "bg-emerald-500" : "bg-amber-500"
                                                )}
                                            />
                                            {smsReady ? "Ready" : "Needs A2P"}
                                        </span>

                                        <span className="text-right text-xs tabular-nums text-gray-500">
                                            {shortDate(n.created_at)}
                                        </span>

                                        <button
                                            type="button"
                                            title="Release number"
                                            disabled={busy}
                                            onClick={() => handleRelease(n.id, n.phone_number)}
                                            className={cn(
                                                "grid h-[26px] w-[26px] place-items-center rounded-md border border-transparent text-gray-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50",
                                                seqFocusRing
                                            )}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </section>

                {/* ---- On Twilio but not connected ---- */}
                {unlinkedNumbers.length > 0 && (
                    <section className={CARD}>
                        <div className="flex items-baseline gap-2.5 border-b border-gray-100 px-3.5 pb-2.5 pt-3">
                            <span className="text-[13px] font-semibold text-gray-900">
                                Available on Twilio
                            </span>
                            <span className="text-[11.5px] text-gray-500">
                                {unlinkedNumbers.length === 1
                                    ? "1 number on your Twilio account is not connected to Omnify yet."
                                    : `${unlinkedNumbers.length} numbers on your Twilio account are not connected to Omnify yet.`}
                            </span>
                        </div>
                        {unlinkedNumbers.map((n) => (
                            <div
                                key={n.sid}
                                className="flex items-center gap-3 border-b border-gray-50 px-3.5 py-2.5 transition-colors hover:bg-gray-50"
                            >
                                <span className="w-[148px] flex-none text-[13px] font-medium tabular-nums text-gray-900">
                                    {n.phoneNumber}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-600">
                                    {n.friendlyName || prettyNumber(n.phoneNumber)}
                                </span>
                                <span className="flex flex-none items-center gap-2.5 text-[11.5px] text-gray-500">
                                    {n.capabilities.voice && (
                                        <span className="inline-flex items-center gap-1.5">
                                            <Phone className="h-3.5 w-3.5" />
                                            Voice
                                        </span>
                                    )}
                                    {n.capabilities.sms && (
                                        <span className="inline-flex items-center gap-1.5">
                                            <MessageSquare className="h-3.5 w-3.5" />
                                            SMS
                                        </span>
                                    )}
                                </span>
                                <span className="w-[92px] flex-none text-right text-xs tabular-nums text-gray-500">
                                    {shortDate(n.dateCreated)}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleConnect(n.sid)}
                                    disabled={!!connecting}
                                    className={cn(BTN_PRIMARY, "flex-none", seqFocusRing)}
                                >
                                    {connecting === n.sid ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Link2 className="h-3.5 w-3.5" />
                                    )}
                                    Connect with Omnify
                                </button>
                            </div>
                        ))}
                        <p className="px-3.5 py-2.5 text-[11px] leading-relaxed text-gray-500">
                            Connecting registers the number with VAPI so calls route correctly,
                            adds it to your messaging service, and makes it selectable for
                            sequence number rotation.
                        </p>
                    </section>
                )}

                {/* ---- A2P entry ---- */}
                <section className={cn(CARD, "flex items-start gap-3.5 p-3.5")}>
                    <span
                        className={cn(
                            "grid h-[30px] w-[30px] flex-none place-items-center rounded-lg",
                            stageStyle.tile
                        )}
                    >
                        <Shield className={cn("h-4 w-4", stageStyle.icon)} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex items-center gap-2.5">
                            <span className="text-[13px] font-semibold text-gray-900">
                                A2P 10DLC registration
                            </span>
                            <span
                                className={cn(
                                    "inline-flex h-5 items-center gap-1.5 rounded px-2 text-[10.5px] font-semibold",
                                    stageStyle.chip
                                )}
                            >
                                <span className={cn("h-[5px] w-[5px] rounded-full", stageStyle.dot)} />
                                {stageStyle.label}
                            </span>
                            {a2pRegistration?.discovered_externally && (
                                <span className="inline-flex h-5 items-center rounded bg-blue-50 px-2 text-[10.5px] font-semibold text-blue-700">
                                    Registered directly with Twilio
                                </span>
                            )}
                        </div>
                        <p className="max-w-[660px] text-xs leading-relaxed text-gray-600">
                            {entryNote}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11.5px] text-gray-500">
                            <span>7 steps, mostly carrier review</span>
                            <span className="text-gray-300">·</span>
                            <span>3 to 6 business days end to end</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setRegOpen(true)}
                        className={cn(BTN_PRIMARY, "flex-none", seqFocusRing)}
                    >
                        {entryCta}
                    </button>
                </section>
            </div>

            {/* ---- A2P registration, in a dialog so the page stays one screen ---- */}
            {regOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 p-6">
                    <div className="flex max-h-[92vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                        <div className="flex flex-none items-center gap-3 border-b border-gray-200 px-5 py-3">
                            <span className="text-[15px] font-semibold text-gray-900">
                                A2P 10DLC registration
                            </span>
                            <span
                                className={cn(
                                    "inline-flex h-5 items-center gap-1.5 rounded px-2 text-[10.5px] font-semibold",
                                    stageStyle.chip
                                )}
                            >
                                <span className={cn("h-[5px] w-[5px] rounded-full", stageStyle.dot)} />
                                {stageStyle.label}
                            </span>
                            <button
                                type="button"
                                onClick={() => setRegOpen(false)}
                                className={cn(
                                    "ml-auto grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900",
                                    seqFocusRing
                                )}
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-5">
                            <A2PStatusCard
                                clientId={clientId}
                                a2pRegistration={a2pRegistration}
                                tenantProfile={tenantProfile}
                            />
                        </div>
                    </div>
                </div>
            )}

            {buyOpen && (
                <BuyNumberDialog clientId={clientId} onClose={() => setBuyOpen(false)} />
            )}
        </div>
    );
}

// ── Buy a number ─────────────────────────────────────────────────────────────

function BuyNumberDialog({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const router = useRouter();
    const [areaCode, setAreaCode] = useState("");
    const [searching, setSearching] = useState(false);
    const [buying, setBuying] = useState<string | null>(null);
    const [results, setResults] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    const search = useCallback(async () => {
        setSearching(true);
        setError(null);
        try {
            const res = await searchAvailableNumbers(areaCode || undefined, undefined, clientId);
            setResults(Array.isArray(res) ? res : (res as any)?.data || []);
        } catch {
            setError("Could not search for numbers");
        } finally {
            setSearching(false);
        }
    }, [areaCode, clientId]);

    async function buy(phoneNumber: string) {
        setBuying(phoneNumber);
        setError(null);
        const res = await purchasePhoneNumberForClient(clientId, phoneNumber);
        setBuying(null);
        if (res?.success) {
            onClose();
            router.refresh();
        } else {
            setError(res?.error || "Could not buy that number");
        }
    }

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/40 p-6">
            <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="flex flex-none items-center gap-3 border-b border-gray-200 px-5 py-3">
                    <span className="text-[15px] font-semibold text-gray-900">Buy a number</span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className={cn(
                            "ml-auto grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900",
                            seqFocusRing
                        )}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex flex-col gap-3 px-5 py-4">
                    <div className="flex items-center gap-2">
                        <div className="relative flex flex-1 items-center">
                            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-gray-400" />
                            <input
                                value={areaCode}
                                onChange={(e) => setAreaCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") search();
                                }}
                                placeholder="Area code, optional"
                                aria-label="Area code"
                                className="h-[30px] w-full rounded-md border border-gray-200 bg-white pl-[29px] pr-2.5 text-[12.5px] tabular-nums text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-emerald-600 focus:ring-[3px] focus:ring-emerald-600/10"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={search}
                            disabled={searching}
                            className={cn(BTN_SECONDARY, seqFocusRing)}
                        >
                            {searching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Search
                        </button>
                    </div>

                    {error && (
                        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
                    )}

                    <div className="min-h-0 max-h-[46vh] overflow-y-auto">
                        {results.length === 0 ? (
                            <p className="py-8 text-center text-[12.5px] text-gray-500">
                                Search to see numbers available on your account.
                            </p>
                        ) : (
                            results.map((r: any) => (
                                <div
                                    key={r.phoneNumber || r.phone_number}
                                    className="flex items-center gap-3 border-b border-gray-50 py-2.5"
                                >
                                    <span className="flex-1 text-[13px] font-medium tabular-nums text-gray-900">
                                        {r.friendlyName || r.phoneNumber || r.phone_number}
                                    </span>
                                    <span className="flex items-center gap-2 text-gray-400">
                                        <Phone className="h-3.5 w-3.5" />
                                        <MessageSquare className="h-3.5 w-3.5" />
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => buy(r.phoneNumber || r.phone_number)}
                                        disabled={!!buying}
                                        className={cn(BTN_PRIMARY, seqFocusRing)}
                                    >
                                        {buying === (r.phoneNumber || r.phone_number) && (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        )}
                                        Buy
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
