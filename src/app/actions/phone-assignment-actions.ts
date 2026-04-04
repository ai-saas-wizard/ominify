"use server";

import { supabase } from "@/lib/supabase";
import { importPhoneNumber, updatePhoneNumber } from "@/lib/vapi";
import { decrypt } from "@/lib/encryption";
import { revalidatePath } from "next/cache";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.ominify.com";

// ─── Import Phone Number to VAPI ─────────────────────────────────────────────

export async function importPhoneNumberToVapi(clientId: string, phoneNumberDbId: string) {
    try {
        // Fetch phone number record
        const { data: phone, error: phoneErr } = await supabase
            .from("tenant_phone_numbers")
            .select("*")
            .eq("id", phoneNumberDbId)
            .eq("client_id", clientId)
            .single();

        if (phoneErr || !phone) {
            return { success: false, error: "Phone number not found" };
        }

        // Skip if already imported
        if (phone.vapi_phone_number_id) {
            return { success: true, vapiPhoneNumberId: phone.vapi_phone_number_id };
        }

        // Get Twilio account creds (supports both subaccount and BYOT)
        const { data: twilioAccount } = await supabase
            .from("tenant_twilio_accounts")
            .select("subaccount_sid, auth_token_encrypted, external_account_sid, account_type")
            .eq("client_id", clientId)
            .single();

        if (!twilioAccount) {
            return { success: false, error: "Twilio account not found" };
        }

        // Resolve correct SID based on account type
        const resolvedSid = twilioAccount.account_type === "type_a_byoa"
            ? twilioAccount.external_account_sid
            : twilioAccount.subaccount_sid;

        // Resolve VAPI key
        const { data: client } = await supabase
            .from("clients")
            .select("vapi_key")
            .eq("id", clientId)
            .single();

        const vapiKey = client?.vapi_key || undefined;

        // Decrypt the auth token before sending to VAPI
        let authToken: string;
        try {
            authToken = decrypt(twilioAccount.auth_token_encrypted);
        } catch {
            // Fallback: token may have been stored unencrypted before encryption was implemented
            authToken = twilioAccount.auth_token_encrypted;
        }

        // Import to VAPI
        const importResult = await importPhoneNumber(
            {
                twilioPhoneNumber: phone.phone_number,
                twilioAccountSid: resolvedSid,
                twilioAuthToken: authToken,
                name: phone.friendly_name || undefined,
                serverUrl: `${APP_URL}/api/webhooks/vapi`,
            },
            vapiKey
        );

        if (!importResult.data) {
            console.error("VAPI import failed:", importResult.error);
            return { success: false, error: importResult.error || "Failed to import phone number to VAPI" };
        }

        // Store VAPI phone number ID
        await supabase
            .from("tenant_phone_numbers")
            .update({ vapi_phone_number_id: importResult.data.id })
            .eq("id", phoneNumberDbId);

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true, vapiPhoneNumberId: importResult.data.id };
    } catch (err: any) {
        console.error("importPhoneNumberToVapi error:", err);
        return { success: false, error: err.message || "Failed to import phone number" };
    }
}

// ─── Assign Phone Number to Agent ────────────────────────────────────────────

export async function assignPhoneNumberToAgent(
    clientId: string,
    phoneNumberDbId: string,
    agentDbId: string
) {
    try {
        // Verify phone belongs to this client
        const { data: phone } = await supabase
            .from("tenant_phone_numbers")
            .select("*")
            .eq("id", phoneNumberDbId)
            .eq("client_id", clientId)
            .single();

        if (!phone) {
            return { success: false, error: "Phone number not found" };
        }

        // Verify agent belongs to this client
        const { data: agent } = await supabase
            .from("agents")
            .select("id, vapi_id")
            .eq("id", agentDbId)
            .eq("client_id", clientId)
            .single();

        if (!agent) {
            return { success: false, error: "Agent not found" };
        }

        // Get VAPI key
        const { data: client } = await supabase
            .from("clients")
            .select("vapi_key")
            .eq("id", clientId)
            .single();

        const vapiKey = client?.vapi_key || undefined;

        // If agent already has a different number → unassign the old one
        const { data: existingPhoneForAgent } = await supabase
            .from("tenant_phone_numbers")
            .select("id, vapi_phone_number_id")
            .eq("agent_id", agentDbId)
            .eq("client_id", clientId)
            .neq("id", phoneNumberDbId)
            .single();

        if (existingPhoneForAgent) {
            // Clear VAPI assistantId on old number
            if (existingPhoneForAgent.vapi_phone_number_id) {
                await updatePhoneNumber(
                    existingPhoneForAgent.vapi_phone_number_id,
                    { assistantId: null },
                    vapiKey
                );
            }
            // Clear DB assignment
            await supabase
                .from("tenant_phone_numbers")
                .update({ agent_id: null, purpose: "sequencer" })
                .eq("id", existingPhoneForAgent.id);
        }

        // If phone already has a different agent → clear that assignment
        if (phone.agent_id && phone.agent_id !== agentDbId) {
            if (phone.vapi_phone_number_id) {
                await updatePhoneNumber(
                    phone.vapi_phone_number_id,
                    { assistantId: null },
                    vapiKey
                );
            }
        }

        // Lazy import: if not yet imported to VAPI, do it now
        let vapiPhoneNumberId = phone.vapi_phone_number_id;
        if (!vapiPhoneNumberId) {
            const importResult = await importPhoneNumberToVapi(clientId, phoneNumberDbId);
            if (!importResult.success) {
                return { success: false, error: importResult.error || "Failed to import to VAPI" };
            }
            vapiPhoneNumberId = importResult.vapiPhoneNumberId;
        }

        // Set assistantId on VAPI phone number
        if (vapiPhoneNumberId && agent.vapi_id) {
            const updated = await updatePhoneNumber(
                vapiPhoneNumberId,
                { assistantId: agent.vapi_id },
                vapiKey
            );
            if (!updated) {
                return { success: false, error: "Failed to link phone number to agent in VAPI" };
            }
        }

        // Update DB
        await supabase
            .from("tenant_phone_numbers")
            .update({ agent_id: agentDbId, purpose: "dedicated" })
            .eq("id", phoneNumberDbId);

        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("assignPhoneNumberToAgent error:", err);
        return { success: false, error: err.message || "Failed to assign phone number" };
    }
}

// ─── Unassign Phone Number from Agent ────────────────────────────────────────

export async function unassignPhoneNumberFromAgent(clientId: string, phoneNumberDbId: string) {
    try {
        // Verify ownership
        const { data: phone } = await supabase
            .from("tenant_phone_numbers")
            .select("*")
            .eq("id", phoneNumberDbId)
            .eq("client_id", clientId)
            .single();

        if (!phone) {
            return { success: false, error: "Phone number not found" };
        }

        // Clear VAPI assistantId
        if (phone.vapi_phone_number_id) {
            const { data: client } = await supabase
                .from("clients")
                .select("vapi_key")
                .eq("id", clientId)
                .single();

            await updatePhoneNumber(
                phone.vapi_phone_number_id,
                { assistantId: null },
                client?.vapi_key || undefined
            );
        }

        // Clear DB assignment
        await supabase
            .from("tenant_phone_numbers")
            .update({ agent_id: null, purpose: "sequencer" })
            .eq("id", phoneNumberDbId);

        revalidatePath(`/client/${clientId}/agents`);
        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("unassignPhoneNumberFromAgent error:", err);
        return { success: false, error: err.message || "Failed to unassign phone number" };
    }
}

// ─── Get Agent's Phone Number ────────────────────────────────────────────────

export async function getAgentPhoneNumber(clientId: string, agentId: string) {
    const { data } = await supabase
        .from("tenant_phone_numbers")
        .select("*")
        .eq("client_id", clientId)
        .eq("agent_id", agentId)
        .single();

    return data;
}
