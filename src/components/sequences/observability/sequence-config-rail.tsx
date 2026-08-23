"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Bot,
    CalendarClock,
    ChevronRight,
    Flag,
    Loader2,
    Mail,
    MessageSquare,
    Phone,
    Shuffle,
    UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seqFocusRing } from "@/components/sequences/theme";
import {
    CallingScheduleCard,
    callingScheduleSummary,
} from "@/components/sequences/calling-schedule-card";
import { NumberRotationCard } from "@/components/sequences/number-rotation-card";
import { EnrollListCard } from "@/components/sequences/enroll-list-card";
import { listOutboundAgents, updateSequence } from "@/app/actions/sequence-actions";

const CHANNEL_META: Record<string, { icon: typeof MessageSquare; label: string }> = {
    sms: { icon: MessageSquare, label: "SMS" },
    voice: { icon: Phone, label: "Voice" },
    email: { icon: Mail, label: "Email" },
};

const GOAL_LABELS: Record<string, string> = {
    missed_call_followup: "Follow up on missed calls",
    dormant_reengagement: "Re-engage dormant leads",
    new_lead_nurture: "Nurture new leads",
    post_appointment: "Post-appointment follow-up",
    win_back_quotes: "Win back open quotes",
    meta_ads_lead: "Convert Meta Ads leads",
    google_ads_lead: "Convert Google Ads leads",
    custom: "Custom goal",
};

/** The AI's brief, in the same precedence the strategy card has always used. */
export function strategyBrief(sequence: any): string {
    const s = sequence?.sequence_strategy || {};
    return (
        s.custom_goal_description ||
        GOAL_LABELS[s.goal] ||
        s.goal ||
        sequence?.description ||
        "Follow up with leads"
    );
}

type SectionId = "agent" | "schedule" | "numbers" | "enroll";

function Section({
    id,
    icon: Icon,
    title,
    summary,
    open,
    onToggle,
    children,
}: {
    id: SectionId;
    icon: typeof Bot;
    title: string;
    summary: string;
    open: boolean;
    onToggle: (id: SectionId) => void;
    children: React.ReactNode;
}) {
    return (
        <div className="border-b border-gray-100">
            <button
                type="button"
                onClick={() => onToggle(id)}
                aria-expanded={open}
                className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-gray-50",
                    seqFocusRing
                )}
            >
                <Icon className="h-[15px] w-[15px] flex-none text-gray-500" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[12.5px] font-semibold text-gray-900">{title}</span>
                    <span className="truncate text-[11.5px] text-gray-500">{summary}</span>
                </span>
                <ChevronRight
                    className={cn(
                        "h-[15px] w-[15px] flex-none text-gray-400 transition-transform duration-150",
                        open && "rotate-90"
                    )}
                />
            </button>
            {open && <div className="px-4 pb-3.5">{children}</div>}
        </div>
    );
}

/**
 * Right rail of the sequence detail view: the AI's brief up top (read-only —
 * the strategy is authored in the wizard), then every operational setting as a
 * collapsed section whose header states its current value, so the whole
 * configuration is legible without opening anything.
 *
 * Schedule, rotation and the bound agent share one save bar: they are three
 * separate writes, but from the operator's side they are one edit to "how this
 * campaign runs". Enrolling a list keeps its own button — it starts real
 * outreach rather than changing a setting.
 */
export function SequenceConfigRail({
    clientId,
    sequenceId,
    sequence,
    openSection: initialOpen = "schedule",
}: {
    clientId: string;
    sequenceId: string;
    sequence: any;
    openSection?: SectionId | null;
}) {
    const router = useRouter();
    const [open, setOpen] = useState<SectionId | null>(initialOpen);
    const [briefExpanded, setBriefExpanded] = useState(false);

    // Bumping this remounts the child panels, which resets their drafts from
    // the server row — that is exactly what Discard means here.
    const [resetKey, setResetKey] = useState(0);

    const strategy = sequence.sequence_strategy || {};
    const handoff = sequence.handoff_rules || {};
    const channels: string[] = strategy.available_channels || [];
    const successConditions: string[] = handoff.success_conditions || [];
    const brief = strategyBrief(sequence);

    // --- Bound agent ------------------------------------------------------
    const serverAgentId: string = sequence.agent_id || "";
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
    const [agentsLoaded, setAgentsLoaded] = useState(false);
    const [agentId, setAgentId] = useState(serverAgentId);

    useEffect(() => {
        listOutboundAgents(clientId).then((list) => {
            setAgents(list);
            setAgentsLoaded(true);
        });
    }, [clientId]);

    // React's "reset state when a prop changes" pattern (same as
    // NumberRotationCard): re-sync during render rather than in an effect, so a
    // server refresh or a Discard paints the synced value in the same pass.
    const agentSyncKey = `${serverAgentId}|${resetKey}`;
    const [syncedAgentKey, setSyncedAgentKey] = useState(agentSyncKey);
    if (syncedAgentKey !== agentSyncKey) {
        setSyncedAgentKey(agentSyncKey);
        setAgentId(serverAgentId);
    }

    const agentDirty = agentId !== serverAgentId;
    const agentName =
        agents.find((a) => a.id === agentId)?.name ||
        (agentId ? "Current agent" : "No agent bound");

    // --- Unified save -----------------------------------------------------
    const [scheduleDirty, setScheduleDirty] = useState(false);
    const [rotationDirty, setRotationDirty] = useState(false);
    const [scheduleSave, setScheduleSave] = useState<(() => Promise<string | null>) | null>(
        null
    );
    const [rotationSave, setRotationSave] = useState<(() => Promise<string | null>) | null>(
        null
    );
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Child panels call these on every render pass, so they must be stable or
    // the registration effect would loop. setState with a function argument
    // treats it as an updater, hence the extra wrapper.
    const registerSchedule = useCallback(
        (fn: (() => Promise<string | null>) | null) => setScheduleSave(() => fn),
        []
    );
    const registerRotation = useCallback(
        (fn: (() => Promise<string | null>) | null) => setRotationSave(() => fn),
        []
    );

    const dirtyCount =
        (agentDirty ? 1 : 0) + (scheduleDirty ? 1 : 0) + (rotationDirty ? 1 : 0);

    async function handleSave() {
        setSaving(true);
        setSaveError(null);

        const errors: string[] = [];
        if (agentDirty) {
            const fd = new FormData();
            fd.set("agent_id", agentId);
            const res = await updateSequence(sequenceId, fd);
            if (!res?.success) errors.push(res?.error || "Could not update the bound agent");
        }
        // Sequential rather than parallel: all three write the same sequences
        // row, and a partial failure is easier to report one cause at a time.
        for (const save of [scheduleSave, rotationSave]) {
            if (!save) continue;
            const err = await save();
            if (err) errors.push(err);
        }

        setSaving(false);
        if (errors.length > 0) {
            setSaveError(errors.join(" · "));
            return;
        }
        router.refresh();
    }

    function handleDiscard() {
        setSaveError(null);
        setAgentId(serverAgentId);
        setResetKey((k) => k + 1);
    }

    const scheduleSummary =
        callingScheduleSummary(sequence) || "No cap or window — dials on business hours";

    const rotationSummary = sequence.rotate_phone_numbers
        ? `${(sequence.rotation_phone_number_ids || []).length} number${
              (sequence.rotation_phone_number_ids || []).length === 1 ? "" : "s"
          } in rotation`
        : "Off — single number";

    return (
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-gray-200 bg-white">
            <div className="min-h-0 flex-1 overflow-y-auto">
                {/* AI strategy — read-only; the brief is authored in the wizard. */}
                <div className="flex flex-col gap-2.5 border-b border-gray-100 px-4 py-3.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500">
                        AI strategy
                    </span>

                    <p
                        className={cn(
                            "text-[12.5px] leading-[1.55] text-gray-600",
                            !briefExpanded && "line-clamp-3"
                        )}
                    >
                        {brief}
                    </p>
                    {brief.length > 150 && (
                        <button
                            type="button"
                            onClick={() => setBriefExpanded((v) => !v)}
                            className={cn(
                                "self-start rounded text-[11.5px] font-medium text-emerald-700 hover:underline",
                                seqFocusRing
                            )}
                        >
                            {briefExpanded ? "Show less" : "Read full brief"}
                        </button>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                        {channels.map((ch) => {
                            const meta = CHANNEL_META[ch];
                            if (!meta) return null;
                            const Icon = meta.icon;
                            return (
                                <span
                                    key={ch}
                                    className="inline-flex h-[22px] items-center gap-1.5 rounded-md border border-gray-200 px-2 text-[11px] text-gray-900"
                                >
                                    <Icon className="h-3 w-3 text-emerald-600" />
                                    {meta.label}
                                </span>
                            );
                        })}
                        {strategy.max_steps != null && (
                            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md border border-gray-200 px-2 text-[11px] tabular-nums text-gray-900">
                                <Flag className="h-3 w-3 text-gray-400" />
                                {strategy.max_steps} touchpoints
                            </span>
                        )}
                        {strategy.cadence_per_week != null && strategy.duration_weeks != null && (
                            <span className="inline-flex h-[22px] items-center rounded-md border border-gray-200 px-2 text-[11px] tabular-nums text-gray-900">
                                {strategy.cadence_per_week}/week · {strategy.duration_weeks} week
                                {strategy.duration_weeks !== 1 ? "s" : ""}
                            </span>
                        )}
                    </div>

                    {successConditions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-500">
                                Stops on
                            </span>
                            {successConditions.map((c) => (
                                <span
                                    key={c}
                                    className="inline-flex h-5 items-center rounded bg-gray-100 px-1.5 text-[11px] text-gray-600"
                                >
                                    {c.replace(/_/g, " ")}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <Section
                    id="agent"
                    icon={Bot}
                    title="Bound agent"
                    summary={agentName}
                    open={open === "agent"}
                    onToggle={(id) => setOpen(open === id ? null : id)}
                >
                    <div className="flex flex-col gap-2">
                        {/* AI sequences require an agent — swapping is allowed,
                            unbinding is not (also enforced in updateSequenceCore). */}
                        <select
                            aria-label="Bound agent"
                            value={agentId}
                            onChange={(e) => e.target.value && setAgentId(e.target.value)}
                            disabled={!agentsLoaded || saving}
                            className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-[12.5px] text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60"
                        >
                            {!agentId && (
                                <option value="" disabled>
                                    Select an agent
                                </option>
                            )}
                            {agentId && !agents.some((a) => a.id === agentId) && (
                                <option value={agentId}>Current agent</option>
                            )}
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                        </select>
                        <p className="text-[11.5px] leading-relaxed text-gray-500">
                            Drives voice calls and the SMS persona for every touch in this
                            sequence.
                        </p>
                    </div>
                </Section>

                <Section
                    id="schedule"
                    icon={CalendarClock}
                    title="Calling schedule"
                    summary={scheduleSummary}
                    open={open === "schedule"}
                    onToggle={(id) => setOpen(open === id ? null : id)}
                >
                    <CallingScheduleCard
                        key={`schedule-${resetKey}`}
                        bare
                        sequenceId={sequenceId}
                        sequence={sequence}
                        onDirtyChange={setScheduleDirty}
                        registerSave={registerSchedule}
                    />
                </Section>

                <Section
                    id="numbers"
                    icon={Shuffle}
                    title="Number rotation"
                    summary={rotationSummary}
                    open={open === "numbers"}
                    onToggle={(id) => setOpen(open === id ? null : id)}
                >
                    <NumberRotationCard
                        key={`rotation-${resetKey}`}
                        bare
                        sequenceId={sequenceId}
                        clientId={clientId}
                        sequence={sequence}
                        onDirtyChange={setRotationDirty}
                        registerSave={registerRotation}
                    />
                </Section>

                <Section
                    id="enroll"
                    icon={UserPlus}
                    title="Enroll a list"
                    summary="Add every contact on a saved list"
                    open={open === "enroll"}
                    onToggle={(id) => setOpen(open === id ? null : id)}
                >
                    <EnrollListCard bare sequenceId={sequenceId} clientId={clientId} />
                </Section>
            </div>

            {/* Always mounted: a save control that only appears once you have already
                edited something reads as a missing button. State carries the message. */}
            <div className="flex flex-none flex-col gap-2 border-t border-gray-200 bg-gray-50 px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-gray-600">
                            <span
                                className={cn(
                                    "h-1.5 w-1.5 flex-none rounded-full",
                                    dirtyCount > 0 ? "bg-amber-500" : "bg-gray-300"
                                )}
                            />
                            {dirtyCount === 0
                                ? "No unsaved changes"
                                : dirtyCount === 1
                                ? "1 unsaved change"
                                : `${dirtyCount} unsaved changes`}
                        </span>
                        <button
                            type="button"
                            onClick={handleDiscard}
                            disabled={saving || dirtyCount === 0}
                            className={cn(
                                "h-[30px] rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40",
                                seqFocusRing
                            )}
                        >
                            Discard
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving || dirtyCount === 0}
                            className={cn(
                                "inline-flex h-[30px] items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50",
                                seqFocusRing
                            )}
                        >
                            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                            {saving ? "Saving" : "Save changes"}
                        </button>
                    </div>
                    {saveError && <p className="text-[11.5px] text-red-600">{saveError}</p>}
            </div>
        </aside>
    );
}
