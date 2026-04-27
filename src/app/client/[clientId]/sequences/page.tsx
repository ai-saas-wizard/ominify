import { supabase } from "@/lib/supabase";
import {
    SequencesListClient,
    type SequenceCardData,
} from "@/components/sequences/sequences-list-client";

async function getSequencesData(clientId: string): Promise<SequenceCardData[]> {
    const { data, error } = await supabase
        .from("sequences")
        .select(`
            *,
            sequence_steps(id, channel, enable_ai_mutation),
            sequence_enrollments(id, status, is_test)
        `)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("getSequencesData error:", error);
        return [];
    }

    return (data || []).map((seq: any) => {
        const steps = seq.sequence_steps || [];
        const enrollments = (seq.sequence_enrollments || []).filter(
            (e: any) => !e.is_test
        );

        const isTask = seq.metadata?.is_task === true ||
            seq.sequence_strategy?.is_task === true;

        return {
            id: seq.id,
            name: seq.name,
            description: seq.description,
            trigger_type: seq.trigger_type,
            urgency_tier: seq.urgency_tier,
            is_active: seq.is_active,
            generation_mode: seq.generation_mode || null,
            is_task: isTask,
            created_at: seq.created_at,
            updated_at: seq.updated_at || null,
            step_count: steps.length,
            channels: steps.map((s: any) => s.channel).filter(Boolean),
            ai_mutation_steps: steps.filter((s: any) => s.enable_ai_mutation).length,
            enrolled_count: enrollments.filter(
                (e: any) => e.status === "active" || e.status === "paused"
            ).length,
            completed_count: enrollments.filter(
                (e: any) => e.status === "completed" || e.status === "booked"
            ).length,
            replied_count: enrollments.filter((e: any) => e.status === "replied").length,
            booked_count: enrollments.filter((e: any) => e.status === "booked").length,
            failed_count: enrollments.filter((e: any) => e.status === "failed").length,
            total_enrolled: enrollments.length,
        };
    });
}

async function getTenantWizardContext(clientId: string) {
    const [profileResult, agentResult, metaResult, googleAdsResult, metaPagesResult] = await Promise.all([
        supabase
            .from("tenant_profiles")
            .select("industry, emergency_phone, business_name")
            .eq("client_id", clientId)
            .single(),
        supabase
            .from("agents")
            .select("id")
            .eq("client_id", clientId)
            .limit(1),
        // Tables may not exist on every environment yet — wrap in maybeSingle so a
        // missing-table error doesn't crash the page during phased rollout.
        supabase
            .from("tenant_meta_ads")
            .select("is_active")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .maybeSingle(),
        supabase
            .from("tenant_google_ads")
            .select("is_active")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .maybeSingle(),
        supabase
            .from("tenant_meta_ads_pages")
            .select("id")
            .eq("client_id", clientId)
            .eq("subscription_active", true)
            .limit(1),
    ]);

    // Also get the client email from clients table
    const { data: client } = await supabase
        .from("clients")
        .select("email")
        .eq("id", clientId)
        .single();

    const metaAdsConnected =
        !!metaResult.data && (metaPagesResult.data?.length ?? 0) > 0;
    const googleAdsConnected = !!googleAdsResult.data;

    return {
        hasAgent: (agentResult.data?.length ?? 0) > 0,
        metaAdsConnected,
        googleAdsConnected,
        tenantProfile: {
            industry: profileResult.data?.industry || "general",
            phone: profileResult.data?.emergency_phone || "",
            email: client?.email || "",
            business_name: profileResult.data?.business_name || "",
        },
    };
}

export default async function SequencesPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const [sequences, wizardContext] = await Promise.all([
        getSequencesData(clientId),
        getTenantWizardContext(clientId),
    ]);

    return (
        <SequencesListClient
            clientId={clientId}
            sequences={sequences}
            hasAgent={wizardContext.hasAgent}
            metaAdsConnected={wizardContext.metaAdsConnected}
            googleAdsConnected={wizardContext.googleAdsConnected}
            tenantProfile={wizardContext.tenantProfile}
        />
    );
}
