import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { NewAgentWizard } from "@/components/new-agent/new-agent-wizard";
import type {
    REInvestorFormData,
    TransferSpecialist,
    TransferMode,
} from "@/lib/verticals/types";

export default async function NewAgentPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await props.params;

    const { data: client } = await supabase
        .from("clients")
        .select("id, name, account_type")
        .eq("id", clientId)
        .single();

    if (!client) {
        return (
            <div className="p-8 text-center text-red-600">Client not found</div>
        );
    }

    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("onboarding_completed, timezone, emergency_phone")
        .eq("client_id", clientId)
        .single();

    if (!profile?.onboarding_completed) {
        redirect(`/client/${clientId}/onboarding`);
    }

    // Pull the most recent RE vertical agent's config so the outbound flow
    // can pre-fill company name, persona, markets, deal types, etc.
    const { data: existingAgent } = await supabase
        .from("agents")
        .select("name, agent_config, agent_type")
        .eq("client_id", clientId)
        .not("agent_config", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);

    type ReAgentConfig = {
        vertical?: string;
        persona_name?: string;
        markets?: string;
        deal_types?: string[];
        appointment_type?: string;
        business_phone?: string;
        transfer?: {
            first_name?: string;
            role?: string;
            phone?: string;
            mode?: string;
        };
    };

    const reAgent = existingAgent?.find(
        (a) =>
            (a.agent_config as ReAgentConfig | null)?.vertical ===
            "real_estate_investor"
    );
    const cfg = (reAgent?.agent_config as ReAgentConfig | null) ?? null;
    const companyNameFromAgent: string | undefined = reAgent?.name
        ? reAgent.name.replace(/\s*-\s*(Inbound|Outbound).*$/i, "").trim() ||
          undefined
        : undefined;

    const transferFromCfg: TransferSpecialist | undefined = cfg?.transfer
        ? {
              firstName: String(cfg.transfer.first_name ?? ""),
              role: String(cfg.transfer.role ?? "lead manager"),
              phone: String(cfg.transfer.phone ?? ""),
              mode: (cfg.transfer.mode ?? "warm-summary") as TransferMode,
          }
        : undefined;

    const outboundDefaults: Partial<REInvestorFormData> | undefined = cfg
        ? {
              companyName: companyNameFromAgent,
              agentPersonaName: cfg.persona_name || undefined,
              markets: cfg.markets || undefined,
              dealTypes: Array.isArray(cfg.deal_types)
                  ? cfg.deal_types
                  : undefined,
              appointmentType: cfg.appointment_type || undefined,
              businessPhone: cfg.business_phone || undefined,
              timezone: profile.timezone || undefined,
              // Use the inbound agent's transfer specialist as the starting
              // point for both directions; user can edit outbound-specific
              // values in the next step.
              inboundTransfer:
                  reAgent?.agent_type === "inbound"
                      ? transferFromCfg
                      : undefined,
              outboundTransfer:
                  reAgent?.agent_type === "outbound"
                      ? transferFromCfg
                      : transferFromCfg,
          }
        : undefined;

    return (
        <NewAgentWizard
            clientId={clientId}
            clientName={client.name}
            tenantTimezone={profile.timezone || ""}
            outboundDefaults={outboundDefaults}
        />
    );
}
