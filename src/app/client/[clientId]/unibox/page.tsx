import { supabase } from "@/lib/supabase";
import { syncVapiCallsForClient } from "@/app/actions/vapi-sync-actions";
import {
    buildThreads,
    type CallRow,
    type ContactRow,
    type EnrollmentRow,
    type InteractionRow,
} from "@/lib/unibox/build-threads";
import { normalizePhone } from "@/lib/unibox/parse";
import type { UniboxAgentOption } from "@/lib/unibox/types";
import { UniboxPageClient } from "@/components/unibox/unibox-page-client";

const CONTACT_COLS =
    "id, phone, name, email, custom_fields, engagement_score, sentiment_trend, pipeline_stage_id, opted_out_at";

// PostgREST caps every response at 1000 rows regardless of the `limit()` we
// ask for, so a bare `.limit(2000)` silently dropped the oldest touches and
// left statuses derived from half a conversation. Pull explicit pages instead
// and stop as soon as one comes back short.
const PAGE_SIZE = 1000;
const MAX_INTERACTIONS = 2000;

async function fetchInteractions(clientId: string): Promise<InteractionRow[]> {
    const rows: InteractionRow[] = [];
    for (let from = 0; from < MAX_INTERACTIONS; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("contact_interactions")
            .select(
                "id, contact_id, step_id, channel, direction, content_body, content_subject, content_summary, outcome, sentiment, intent, call_duration_seconds, call_disposition, appointment_booked, provider_id, created_at"
            )
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .range(from, Math.min(from + PAGE_SIZE, MAX_INTERACTIONS) - 1);
        if (error) {
            console.error("[UNIBOX] interactions fetch failed:", error.message);
            break;
        }
        rows.push(...((data ?? []) as InteractionRow[]));
        if ((data?.length ?? 0) < PAGE_SIZE) return rows;
    }
    console.warn(
        `[UNIBOX] client ${clientId} has more than ${MAX_INTERACTIONS} interactions; older touches are not shown.`
    );
    return rows;
}

// PostgREST `in()` filters ride in the query string, so large id lists are
// split into URL-safe batches and fetched concurrently.
function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function fetchContacts(clientId: string, ids: string[], phones: string[]): Promise<ContactRow[]> {
    const queries = [
        ...chunk(ids, 150).map((batch) =>
            supabase.from("contacts").select(CONTACT_COLS).eq("client_id", clientId).in("id", batch)
        ),
        ...chunk(phones, 150).map((batch) =>
            supabase.from("contacts").select(CONTACT_COLS).eq("client_id", clientId).in("phone", batch)
        ),
    ];
    const results = await Promise.all(queries);
    const seen = new Map<string, ContactRow>();
    for (const r of results) {
        if (r.error) {
            console.error("[UNIBOX] contacts fetch failed:", r.error.message);
            continue;
        }
        for (const row of (r.data ?? []) as ContactRow[]) seen.set(row.id, row);
    }
    return [...seen.values()];
}

async function fetchEnrollments(clientId: string, contactIds: string[]): Promise<EnrollmentRow[]> {
    const results = await Promise.all(
        chunk(contactIds, 150).map((batch) =>
            supabase
                .from("sequence_enrollments")
                .select(
                    "id, contact_id, sequence_id, status, current_step_order, enrolled_at, appointment_booked, is_hot_lead, completed_reason, sequences ( name, agent_id )"
                )
                .eq("tenant_id", clientId)
                .in("contact_id", batch)
        )
    );
    const rows: EnrollmentRow[] = [];
    for (const r of results) {
        if (r.error) {
            console.error("[UNIBOX] enrollments fetch failed:", r.error.message);
            continue;
        }
        rows.push(...((r.data ?? []) as unknown as EnrollmentRow[]));
    }
    return rows;
}

async function fetchStepCounts(sequenceIds: string[]): Promise<Record<string, number>> {
    if (sequenceIds.length === 0) return {};
    // Only template steps count toward "Step 2 of 5"; dynamic steps are
    // generated per enrollment and carry an enrollment_id.
    const { data, error } = await supabase
        .from("sequence_steps")
        .select("sequence_id")
        .in("sequence_id", sequenceIds)
        .is("enrollment_id", null);
    if (error) {
        console.error("[UNIBOX] step counts fetch failed:", error.message);
        return {};
    }
    const counts: Record<string, number> = {};
    for (const row of data ?? []) counts[row.sequence_id] = (counts[row.sequence_id] ?? 0) + 1;
    return counts;
}

export default async function UniboxPage({
    params,
    searchParams,
}: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ agent?: string }>;
}) {
    const { clientId } = await params;
    const { agent: initialAgentVapiId } = await searchParams;

    const [clientRes, agentsRes, stagesRes] = await Promise.all([
        supabase.from("clients").select("account_type").eq("id", clientId).maybeSingle(),
        supabase.from("agents").select("id, vapi_id, name, agent_type").eq("client_id", clientId).order("name"),
        supabase.from("pipeline_stages").select("id, name").eq("client_id", clientId),
    ]);

    const agentRows = (agentsRes.data ?? []) as Array<{ id: string; vapi_id: string; name: string; agent_type: string }>;
    const agents: UniboxAgentOption[] = agentRows.map((a) => ({
        id: a.id,
        vapiId: a.vapi_id,
        name: a.name,
        agentType: a.agent_type,
    }));
    const stageNames: Record<string, string> = {};
    for (const s of stagesRes.data ?? []) stageNames[s.id] = s.name;

    // CUSTOM accounts own their VAPI key, so their calls are pulled from VAPI
    // before we read. The action resolves the decrypted key internally.
    if (clientRes.data?.account_type === "CUSTOM") {
        await syncVapiCallsForClient(clientId, agentRows);
    }

    const [callsRes, interactions] = await Promise.all([
        supabase
            .from("calls")
            .select(
                "vapi_call_id, customer_number, status, ended_reason, transcript, recording_url, summary, started_at, created_at, type, duration_seconds, agents ( vapi_id, name )"
            )
            .eq("client_id", clientId)
            .eq("is_hidden", false)
            .order("started_at", { ascending: false, nullsFirst: false })
            .limit(500),
        fetchInteractions(clientId),
    ]);

    if (callsRes.error) console.error("[UNIBOX] calls fetch failed:", callsRes.error.message);

    const calls = (callsRes.data ?? []) as unknown as CallRow[];

    const contactIds = [...new Set(interactions.map((i) => i.contact_id))];
    const callPhones = [
        ...new Set(calls.map((c) => normalizePhone(c.customer_number)).filter((p): p is string => !!p)),
    ];

    const contacts = await fetchContacts(clientId, contactIds, callPhones);
    const enrollments = await fetchEnrollments(
        clientId,
        contacts.map((c) => c.id)
    );
    const stepCounts = await fetchStepCounts([...new Set(enrollments.map((e) => e.sequence_id))]);

    const threads = buildThreads({ contacts, interactions, calls, enrollments, agents, stageNames, stepCounts });

    return (
        <div className="h-screen overflow-hidden">
            <UniboxPageClient
                threads={threads}
                agents={agents}
                clientId={clientId}
                initialAgentVapiId={initialAgentVapiId ?? null}
            />
        </div>
    );
}
