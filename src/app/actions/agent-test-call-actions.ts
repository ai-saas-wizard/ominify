"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
import { canAccessClient } from "@/lib/auth";
import { canPlaceCall } from "@/lib/access";
import { getClientVapiKey } from "@/lib/client-secrets";
import { getCallTimeVariables } from "@/lib/call-variables";
import { createPhoneCall } from "@/lib/vapi";
import { formatVapiError } from "@/lib/vapi-errors";
import { normalizeToE164 } from "@/lib/phone-utils";

/**
 * "Test Agent" on the agent detail page — place a REAL outbound call from an
 * agent to a phone number the operator types, so they can hear the agent
 * before wiring it into a sequence.
 *
 * This deliberately goes through the same telephony path as production
 * (tenant caller ID, tenant VAPI key, the tenant's minute balance) rather than
 * a browser/mic web call, so what you hear is what a lead hears.
 */

export type TestCallErrorCode =
    | "unauthenticated"
    | "forbidden"
    | "invalid_phone"
    | "agent_not_synced"
    | "no_caller_id"
    | "caller_id_not_synced"
    | "no_vapi_key"
    | "no_access"
    | "vapi_error";

export type StartAgentTestCallResult =
    | { success: true; callId: string; from: string; to: string }
    | {
          success: false;
          error: string;
          code: TestCallErrorCode;
          fixHref?: string;
          fixLabel?: string;
      };

/**
 * Resolve the outbound caller ID for a test call.
 *
 * Mirrors the sequencer's resolution (scheduler-worker.ts) but AGENT-FIRST:
 * the agent page's Deployment card tells the operator "outbound calls use this
 * as caller ID", so a test call must honour that promise before falling back
 * to the tenant default.
 *
 * Returns the row plus a discriminator, because "no number at all" and "number
 * exists but was never imported into VAPI" are different problems with
 * different fixes — and the latter is invisible on the page today, which only
 * selects id/phone_number/friendly_name/agent_id.
 */
async function resolveOutboundPhone(
    clientId: string,
    agentDbId: string
): Promise<
    | { kind: "ok"; vapiPhoneNumberId: string; phoneNumber: string }
    | { kind: "none" }
    | { kind: "not_synced"; phoneNumber: string }
> {
    // 1. Number assigned to this agent
    const { data: agentPhone } = await supabase
        .from("tenant_phone_numbers")
        .select("phone_number, vapi_phone_number_id")
        .eq("client_id", clientId)
        .eq("agent_id", agentDbId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

    if (agentPhone) {
        return agentPhone.vapi_phone_number_id
            ? {
                  kind: "ok",
                  vapiPhoneNumberId: agentPhone.vapi_phone_number_id,
                  phoneNumber: agentPhone.phone_number,
              }
            : { kind: "not_synced", phoneNumber: agentPhone.phone_number };
    }

    // 2. Tenant's explicit default outbound number
    const { data: tenantDefault } = await supabase
        .from("tenant_profiles")
        .select("default_outbound_phone_id")
        .eq("client_id", clientId)
        .maybeSingle();

    if (tenantDefault?.default_outbound_phone_id) {
        const { data: defaultPhone } = await supabase
            .from("tenant_phone_numbers")
            .select("phone_number, vapi_phone_number_id, status")
            .eq("id", tenantDefault.default_outbound_phone_id)
            .maybeSingle();

        if (defaultPhone?.status === "active" && defaultPhone.vapi_phone_number_id) {
            return {
                kind: "ok",
                vapiPhoneNumberId: defaultPhone.vapi_phone_number_id,
                phoneNumber: defaultPhone.phone_number,
            };
        }
    }

    // 3. Any active tenant number that's registered with VAPI
    const { data: fallback } = await supabase
        .from("tenant_phone_numbers")
        .select("phone_number, vapi_phone_number_id")
        .eq("client_id", clientId)
        .eq("status", "active")
        .not("vapi_phone_number_id", "is", null)
        .limit(1)
        .maybeSingle();

    if (fallback?.vapi_phone_number_id) {
        return {
            kind: "ok",
            vapiPhoneNumberId: fallback.vapi_phone_number_id,
            phoneNumber: fallback.phone_number,
        };
    }

    // Nothing usable. Distinguish "you own a number but it isn't in VAPI"
    // from "you own no numbers", since the first is one click to fix.
    const { data: anyNumber } = await supabase
        .from("tenant_phone_numbers")
        .select("phone_number")
        .eq("client_id", clientId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

    return anyNumber
        ? { kind: "not_synced", phoneNumber: anyNumber.phone_number }
        : { kind: "none" };
}

export async function startAgentTestCall(input: {
    clientId: string;
    /** The VAPI assistant id — i.e. the `[id]` route param on the agent page. */
    vapiAssistantId: string;
    phone: string;
    name?: string;
}): Promise<StartAgentTestCallResult> {
    const { clientId, vapiAssistantId, phone, name } = input;

    try {
        const { userId } = await auth();
        if (!userId) {
            return { success: false, error: "Not authenticated", code: "unauthenticated" };
        }

        const user = await currentUser();
        const lookupKey = user?.emailAddresses[0]?.emailAddress || userId;
        if (!(await canAccessClient(lookupKey, clientId))) {
            return { success: false, error: "Forbidden", code: "forbidden" };
        }

        const toNumber = normalizeToE164(phone);
        if (!toNumber) {
            return {
                success: false,
                error: "That doesn't look like a valid phone number.",
                code: "invalid_phone",
            };
        }

        // Scoping this by client_id is the authorization proof that this
        // assistant belongs to the tenant — never trust the route param alone.
        const { data: agentRecord } = await supabase
            .from("agents")
            .select("id, vapi_id")
            .eq("vapi_id", vapiAssistantId)
            .eq("client_id", clientId)
            .maybeSingle();

        if (!agentRecord) {
            return {
                success: false,
                error: "This agent isn't synced to the database yet, so we can't place a call from it.",
                code: "agent_not_synced",
            };
        }

        // Same minutes/subscription gate the sequencer applies before dialling.
        const access = await canPlaceCall(clientId);
        if (!access.allowed) {
            const billingHref = `/client/${clientId}/billing`;
            const message =
                access.reason === "no_minutes"
                    ? "You have 0 voice minutes left, so the call can't be placed."
                    : access.reason === "past_due"
                      ? "Your subscription is past due, so calls are paused."
                      : access.reason === "canceled"
                        ? "Your subscription isn't active, so calls are paused."
                        : access.reason === "no_subscription"
                          ? "This client has no active subscription, so calls are paused."
                          : "This client can't place calls right now.";
            return {
                success: false,
                error: message,
                code: "no_access",
                fixHref: billingHref,
                fixLabel: access.reason === "no_minutes" ? "Add minutes" : "View billing",
            };
        }

        const caller = await resolveOutboundPhone(clientId, agentRecord.id);
        if (caller.kind === "none") {
            return {
                success: false,
                error: "No outbound phone number is available for this client.",
                code: "no_caller_id",
                fixHref: `/client/${clientId}/phone-numbers`,
                fixLabel: "Get a number",
            };
        }
        if (caller.kind === "not_synced") {
            return {
                success: false,
                error: `${caller.phoneNumber} is not registered with VAPI yet — sync it from the Phone Numbers page first.`,
                code: "caller_id_not_synced",
                fixHref: `/client/${clientId}/phone-numbers`,
                fixLabel: "Sync number",
            };
        }

        const vapiKey = await getClientVapiKey(clientId);
        if (!vapiKey) {
            return {
                success: false,
                error: "No VAPI key is configured for this client.",
                code: "no_vapi_key",
            };
        }

        const { currentDate, tenantTimezone } = await getCallTimeVariables(clientId);

        // Variable names match the sequencer's dispatch (scheduler-worker.ts) so
        // wizard-built prompts using {{customer_name}} / {{first_name}} render
        // the same way they will in a real sequence.
        const displayName = name?.trim() || "there";
        const variableValues: Record<string, string> = {
            currentDate,
            tenantTimezone,
            name: displayName,
            customer_name: displayName,
            contact_name: displayName,
            first_name: displayName.split(/\s+/)[0],
            phone: toNumber,
        };

        const result = await createPhoneCall(
            {
                assistantId: vapiAssistantId,
                phoneNumberId: caller.vapiPhoneNumberId,
                customer: {
                    number: toNumber,
                    ...(name?.trim() ? { name: name.trim() } : {}),
                },
                assistantOverrides: { variableValues },
                // Deliberately NO enrollmentId: the VAPI webhook forwards to the
                // sequencer only when metadata.enrollmentId is present, and a
                // bogus one would make the sequencer try to advance a
                // nonexistent enrollment and leak a concurrency slot.
                metadata: {
                    tenantId: clientId,
                    agentId: agentRecord.id,
                    source: "agent_test_call",
                },
            },
            vapiKey
        );

        if (!result.data?.id) {
            return {
                success: false,
                error: formatVapiError(result.error),
                code: "vapi_error",
            };
        }

        return {
            success: true,
            callId: result.data.id,
            from: caller.phoneNumber,
            to: toNumber,
        };
    } catch (error: any) {
        console.error("startAgentTestCall error:", error);
        return {
            success: false,
            error: error?.message || "Internal error",
            code: "vapi_error",
        };
    }
}
