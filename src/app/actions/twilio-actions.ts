"use server";

import { supabase } from "@/lib/supabase";
import {
    createSubaccount,
    purchasePhoneNumber,
    releasePhoneNumber,
    listAvailableNumbers,
    listPurchasedNumbers,
    createMessagingService,
    addNumberToMessagingService,
    registerBrand,
    registerCampaign,
    checkBrandStatus,
    checkCampaignStatus,
} from "@/lib/twilio";
import { revalidatePath } from "next/cache";

// ─── Twilio Subaccount Provisioning ─────────────────────────────────────────

export async function provisionTwilioSubaccount(clientId: string) {
    try {
        // Check if already provisioned
        const { data: existing } = await supabase
            .from("tenant_twilio_accounts")
            .select("id")
            .eq("tenant_id", clientId)
            .single();

        if (existing) {
            return { success: false, error: "Twilio subaccount already provisioned" };
        }

        // Get client info for friendly name
        const { data: client } = await supabase
            .from("clients")
            .select("name")
            .eq("id", clientId)
            .single();

        if (!client) {
            return { success: false, error: "Client not found" };
        }

        // Create Twilio subaccount
        const subaccount = await createSubaccount(client.name);

        // Store in DB
        const { error } = await supabase.from("tenant_twilio_accounts").insert({
            tenant_id: clientId,
            account_type: "type_b_subaccount",
            subaccount_sid: subaccount.sid,
            auth_token_encrypted: subaccount.authToken, // TODO: encrypt with AES-256-GCM
            friendly_name: subaccount.friendlyName,
            status: "active",
        });

        if (error) {
            console.error("provisionTwilioSubaccount DB error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("provisionTwilioSubaccount error:", err);
        return { success: false, error: err.message || "Failed to provision Twilio subaccount" };
    }
}

// ─── Get Twilio Account ─────────────────────────────────────────────────────

export async function getTwilioAccount(clientId: string) {
    const { data, error } = await supabase
        .from("tenant_twilio_accounts")
        .select("*")
        .eq("tenant_id", clientId)
        .single();

    if (error && error.code !== "PGRST116") {
        console.error("getTwilioAccount error:", error);
    }

    return data;
}

// ─── Phone Number Management ────────────────────────────────────────────────

export async function getPhoneNumbers(clientId: string) {
    const { data, error } = await supabase
        .from("tenant_phone_numbers")
        .select("*")
        .eq("tenant_id", clientId)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("getPhoneNumbers error:", error);
        return [];
    }

    return data || [];
}

export async function searchAvailableNumbers(areaCode?: string, country?: string) {
    try {
        const numbers = await listAvailableNumbers(areaCode, country || "US");
        return { success: true, numbers };
    } catch (err: any) {
        console.error("searchAvailableNumbers error:", err);
        return { success: false, error: err.message, numbers: [] };
    }
}

export async function purchasePhoneNumberForClient(clientId: string, phoneNumber: string) {
    try {
        // Get Twilio subaccount
        const account = await getTwilioAccount(clientId);
        if (!account) {
            return { success: false, error: "Twilio subaccount not provisioned. Please provision first." };
        }

        // Purchase number on subaccount
        const purchased = await purchasePhoneNumber(
            account.subaccount_sid,
            account.auth_token_encrypted, // TODO: decrypt
            phoneNumber,
            clientId
        );

        // Store in DB
        const { error } = await supabase.from("tenant_phone_numbers").insert({
            tenant_id: clientId,
            phone_number: purchased.phoneNumber,
            phone_number_sid: purchased.sid,
            friendly_name: purchased.friendlyName,
            capabilities: { sms: true, voice: true },
            status: "active",
        });

        if (error) {
            console.error("purchasePhoneNumberForClient DB error:", error);
            return { success: false, error: error.message };
        }

        // If messaging service exists, add number to it
        if (account.messaging_service_sid) {
            try {
                await addNumberToMessagingService(
                    account.subaccount_sid,
                    account.auth_token_encrypted,
                    account.messaging_service_sid,
                    purchased.sid
                );
            } catch (err) {
                console.error("Failed to add number to messaging service:", err);
            }
        }

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("purchasePhoneNumberForClient error:", err);
        return { success: false, error: err.message || "Failed to purchase phone number" };
    }
}

export async function releasePhoneNumberForClient(clientId: string, phoneNumberId: string) {
    try {
        // Get the phone number record
        const { data: phoneRecord } = await supabase
            .from("tenant_phone_numbers")
            .select("*, tenant_twilio_accounts!inner(subaccount_sid, auth_token_encrypted)")
            .eq("id", phoneNumberId)
            .eq("tenant_id", clientId)
            .single();

        if (!phoneRecord) {
            return { success: false, error: "Phone number not found" };
        }

        const account = (phoneRecord as any).tenant_twilio_accounts;

        // Release on Twilio
        await releasePhoneNumber(
            account.subaccount_sid,
            account.auth_token_encrypted,
            phoneRecord.phone_number_sid
        );

        // Delete from DB
        await supabase
            .from("tenant_phone_numbers")
            .delete()
            .eq("id", phoneNumberId);

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("releasePhoneNumberForClient error:", err);
        return { success: false, error: err.message || "Failed to release phone number" };
    }
}

// ─── A2P 10DLC Registration ────────────────────────────────────────────────

export async function startA2PRegistration(clientId: string) {
    try {
        // Get Twilio account
        const account = await getTwilioAccount(clientId);
        if (!account) {
            return { success: false, error: "Twilio subaccount not provisioned" };
        }

        // Get tenant profile for business info
        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (!profile) {
            return { success: false, error: "Tenant profile not found. Complete onboarding first." };
        }

        // Get client for email
        const { data: client } = await supabase
            .from("clients")
            .select("name, email")
            .eq("id", clientId)
            .single();

        // Register brand
        const brandResult = await registerBrand(
            account.subaccount_sid,
            account.auth_token_encrypted,
            {
                legalName: profile.company_name || client?.name || "Unknown",
                contactEmail: client?.email || "support@ominify.com",
                customerProfileSid: "", // Will be created by registerBrand
            }
        );

        // Create messaging service if not exists
        let messagingServiceSid = account.messaging_service_sid;
        if (!messagingServiceSid) {
            const msgService = await createMessagingService(
                account.subaccount_sid,
                account.auth_token_encrypted,
                profile.company_name || client?.name || "OMINIFY Tenant",
                clientId
            );
            messagingServiceSid = msgService.sid;

            // Update Twilio account with messaging service SID
            await supabase
                .from("tenant_twilio_accounts")
                .update({ messaging_service_sid: messagingServiceSid })
                .eq("tenant_id", clientId);
        }

        // Store A2P registration
        const { error } = await supabase.from("tenant_a2p_registrations").insert({
            tenant_id: clientId,
            brand_sid: brandResult.brandSid,
            brand_status: "pending",
            customer_profile_sid: brandResult.customerProfileSid,
            campaign_status: "awaiting_brand",
        });

        if (error) {
            console.error("startA2PRegistration DB error:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true, brandStatus: "pending" };
    } catch (err: any) {
        console.error("startA2PRegistration error:", err);
        return { success: false, error: err.message || "Failed to start A2P registration" };
    }
}

export async function checkA2PStatus(clientId: string) {
    try {
        // Get existing registration
        const { data: registration } = await supabase
            .from("tenant_a2p_registrations")
            .select("*")
            .eq("tenant_id", clientId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (!registration) {
            return { success: true, data: null };
        }

        // Get Twilio account
        const account = await getTwilioAccount(clientId);
        if (!account) {
            return { success: true, data: registration };
        }

        let updated = false;

        // Check brand status if pending
        if (registration.brand_sid && registration.brand_status === "pending") {
            const brandStatus = await checkBrandStatus(
                account.subaccount_sid,
                account.auth_token_encrypted,
                registration.brand_sid
            );

            if (brandStatus.status !== registration.brand_status) {
                await supabase
                    .from("tenant_a2p_registrations")
                    .update({ brand_status: brandStatus.status })
                    .eq("id", registration.id);
                registration.brand_status = brandStatus.status;
                updated = true;

                // If brand approved and no campaign yet, try to create campaign
                if (brandStatus.status === "APPROVED" && !registration.campaign_sid) {
                    try {
                        const { data: profile } = await supabase
                            .from("tenant_profiles")
                            .select("company_name, industry, job_types")
                            .eq("client_id", clientId)
                            .single();

                        const campaignResult = await registerCampaign(
                            account.subaccount_sid,
                            account.auth_token_encrypted,
                            account.messaging_service_sid,
                            registration.brand_sid,
                            {
                                description: `Lead follow-up SMS for ${profile?.company_name || "business"} - ${profile?.industry || "services"}`,
                                sampleMessages: [
                                    `Hi {{name}}, this is ${profile?.company_name}. Following up on your request. When works best to chat?`,
                                    `${profile?.company_name} here - just checking if you still need help. Reply YES to schedule.`,
                                ],
                                companyName: profile?.company_name || "Business",
                            }
                        );

                        await supabase
                            .from("tenant_a2p_registrations")
                            .update({
                                campaign_sid: campaignResult.campaignSid,
                                campaign_status: "pending_approval",
                            })
                            .eq("id", registration.id);

                        registration.campaign_sid = campaignResult.campaignSid;
                        registration.campaign_status = "pending_approval";
                    } catch (err) {
                        console.error("Auto-campaign creation failed:", err);
                    }
                }
            }
        }

        // Check campaign status if pending
        if (
            registration.campaign_sid &&
            registration.campaign_status === "pending_approval" &&
            account.messaging_service_sid
        ) {
            const campaignStatus = await checkCampaignStatus(
                account.subaccount_sid,
                account.auth_token_encrypted,
                account.messaging_service_sid,
                registration.campaign_sid
            );

            if (campaignStatus.status !== registration.campaign_status) {
                await supabase
                    .from("tenant_a2p_registrations")
                    .update({ campaign_status: campaignStatus.status })
                    .eq("id", registration.id);
                registration.campaign_status = campaignStatus.status;
                updated = true;
            }
        }

        if (updated) {
            revalidatePath(`/client/${clientId}/phone-numbers`);
        }

        return { success: true, data: registration };
    } catch (err: any) {
        console.error("checkA2PStatus error:", err);
        return { success: false, error: err.message, data: null };
    }
}
