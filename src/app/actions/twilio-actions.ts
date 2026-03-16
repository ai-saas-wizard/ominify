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
    // TrustHub Customer Profile
    createSecondaryCustomerProfile,
    createEndUserBusinessInfo,
    createEndUserAuthorizedRep,
    createTrustHubAddress,
    attachEntityToCustomerProfile,
    evaluateCustomerProfile,
    submitCustomerProfile,
    checkCustomerProfileStatus,
    // Trust Product
    createA2PTrustProduct,
    createEndUserA2PProfile,
    attachEntityToTrustProduct,
    evaluateAndSubmitTrustProduct,
    checkTrustProductStatus,
    // Brand & Campaign
    registerBrand,
    registerCampaign,
    checkBrandStatus,
    checkCampaignStatus,
} from "@/lib/twilio";
import { deleteVapiPhoneNumber } from "@/lib/vapi";
import { revalidatePath } from "next/cache";

// ─── Twilio Subaccount Provisioning ─────────────────────────────────────────

export async function provisionTwilioSubaccount(clientId: string) {
    try {
        // Check if already provisioned
        const { data: existing } = await supabase
            .from("tenant_twilio_accounts")
            .select("id")
            .eq("client_id", clientId)
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
            client_id: clientId,
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
        .eq("client_id", clientId)
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
        .eq("client_id", clientId)
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

const FREE_NUMBER_LIMIT = 2;

export async function purchasePhoneNumberForClient(clientId: string, phoneNumber: string) {
    try {
        // Get Twilio subaccount
        const account = await getTwilioAccount(clientId);
        if (!account) {
            return { success: false, error: "Twilio subaccount not provisioned. Please provision first." };
        }

        // Check free number limit for umbrella tenants
        const currentNumbers = await getPhoneNumbers(clientId);
        const activeCount = currentNumbers.filter((n: any) => n.status === "active").length;
        if (activeCount >= FREE_NUMBER_LIMIT) {
            return {
                success: false,
                error: "PAYMENT_REQUIRED",
                message: `You've used your ${FREE_NUMBER_LIMIT} free numbers. Additional numbers cost $10 each.`,
            };
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
            client_id: clientId,
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
            .eq("client_id", clientId)
            .single();

        if (!phoneRecord) {
            return { success: false, error: "Phone number not found" };
        }

        const account = (phoneRecord as any).tenant_twilio_accounts;

        // Clean up VAPI phone number if imported
        if (phoneRecord.vapi_phone_number_id) {
            try {
                // Get VAPI key for this client
                const { data: client } = await supabase
                    .from("clients")
                    .select("vapi_key")
                    .eq("id", clientId)
                    .single();

                await deleteVapiPhoneNumber(phoneRecord.vapi_phone_number_id, client?.vapi_key || undefined);
            } catch (err) {
                console.error("Failed to delete VAPI phone number:", err);
                // Continue with Twilio release even if VAPI cleanup fails
            }
        }

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

// ─── A2P 10DLC Registration Pipeline ──────────────────────────────────────

export interface A2PBusinessInfo {
    legalBusinessName: string;
    businessType: string;
    einTaxId: string;
    businessIndustry: string;
    businessRegistrationIdType: string;
    businessRegionsOfOperation: string;
    websiteUrl: string;
    businessAddress: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
    };
    authorizedRep1: {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        job_title: string;
        job_position: string;
    };
    authorizedRep2: {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        job_title: string;
        job_position: string;
    };
}

// Step 1: Save business info for A2P to tenant_profiles and ensure a2p_registrations row exists
export async function saveA2PBusinessInfo(clientId: string, info: A2PBusinessInfo) {
    try {
        // Save business details to tenant_profiles
        const { error: profileError } = await supabase
            .from("tenant_profiles")
            .update({
                legal_business_name: info.legalBusinessName,
                business_type: info.businessType,
                ein_tax_id: info.einTaxId,
                business_industry: info.businessIndustry,
                business_registration_id_type: info.businessRegistrationIdType,
                business_regions_of_operation: info.businessRegionsOfOperation,
                website: info.websiteUrl,
                business_address: info.businessAddress,
                authorized_rep_1: info.authorizedRep1,
                authorized_rep_2: info.authorizedRep2,
                a2p_business_info_complete: true,
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        if (profileError) {
            console.error("saveA2PBusinessInfo profile error:", profileError);
            return { success: false, error: profileError.message };
        }

        // Upsert a2p registration row
        const { data: existing } = await supabase
            .from("tenant_a2p_registrations")
            .select("id")
            .eq("client_id", clientId)
            .single();

        if (!existing) {
            const { error: insertError } = await supabase.from("tenant_a2p_registrations").insert({
                client_id: clientId,
                current_step: "customer_profile",
                brand_status: "not_started",
                campaign_status: "not_started",
                secondary_profile_status: "not_started",
                trust_product_status: "not_started",
            });
            if (insertError) {
                console.error("saveA2PBusinessInfo insert error:", insertError);
                return { success: false, error: insertError.message };
            }
        } else {
            await supabase
                .from("tenant_a2p_registrations")
                .update({ current_step: "customer_profile" })
                .eq("id", existing.id);
        }

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("saveA2PBusinessInfo error:", err);
        return { success: false, error: err.message || "Failed to save business info" };
    }
}

// Step 2: Create TrustHub Customer Profile (submits to Twilio)
export async function createA2PCustomerProfile(clientId: string) {
    try {
        const account = await getTwilioAccount(clientId);
        if (!account) return { success: false, error: "Twilio subaccount not provisioned." };

        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (!profile || !profile.a2p_business_info_complete) {
            return { success: false, error: "Business information not complete. Fill out the form first." };
        }

        const { data: client } = await supabase
            .from("clients")
            .select("name, email")
            .eq("id", clientId)
            .single();

        const email = client?.email || "support@ominify.com";
        const businessName = profile.legal_business_name || client?.name || "Unknown";
        const address = profile.business_address || {};
        const rep1 = profile.authorized_rep_1 || {};
        const rep2 = profile.authorized_rep_2 || {};

        // 1. Create Secondary Customer Profile
        const customerProfile = await createSecondaryCustomerProfile(
            account.subaccount_sid,
            account.auth_token_encrypted,
            businessName,
            email
        );

        // 2. Create EndUser for business info
        const businessEndUser = await createEndUserBusinessInfo(
            account.subaccount_sid,
            account.auth_token_encrypted,
            {
                businessName,
                businessType: profile.business_type || "LLC",
                businessIndustry: profile.business_industry || "ONLINE",
                businessRegistrationNumber: profile.ein_tax_id || "",
                businessRegistrationIdType: profile.business_registration_id_type || "EIN",
                businessRegionsOfOperation: profile.business_regions_of_operation || "USA_AND_CANADA",
                websiteUrl: profile.website || "",
            }
        );

        // 3. Create EndUser for authorized rep 1
        const rep1EndUser = await createEndUserAuthorizedRep(
            account.subaccount_sid,
            account.auth_token_encrypted,
            1,
            {
                firstName: rep1.first_name || "",
                lastName: rep1.last_name || "",
                email: rep1.email || email,
                phone: rep1.phone || "",
                businessTitle: rep1.job_title || "",
                jobPosition: rep1.job_position || "Other",
            }
        );

        // 4. Create EndUser for authorized rep 2
        const rep2EndUser = await createEndUserAuthorizedRep(
            account.subaccount_sid,
            account.auth_token_encrypted,
            2,
            {
                firstName: rep2.first_name || "",
                lastName: rep2.last_name || "",
                email: rep2.email || email,
                phone: rep2.phone || "",
                businessTitle: rep2.job_title || "",
                jobPosition: rep2.job_position || "Other",
            }
        );

        // 5. Create Address
        const addressResult = await createTrustHubAddress(
            account.subaccount_sid,
            account.auth_token_encrypted,
            {
                customerName: businessName,
                street: address.street || "",
                city: address.city || "",
                region: address.state || "",
                postalCode: address.zip || "",
                isoCountry: address.country || "US",
            }
        );

        // 6. Attach all entities to customer profile
        await attachEntityToCustomerProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            customerProfile.sid, businessEndUser.sid
        );
        await attachEntityToCustomerProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            customerProfile.sid, rep1EndUser.sid
        );
        await attachEntityToCustomerProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            customerProfile.sid, rep2EndUser.sid
        );
        await attachEntityToCustomerProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            customerProfile.sid, addressResult.sid
        );

        // 7. Evaluate
        const evaluation = await evaluateCustomerProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            customerProfile.sid
        );
        console.log("[A2P] Customer Profile evaluation:", evaluation);

        // 8. Submit for review
        await submitCustomerProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            customerProfile.sid
        );

        // 9. Store all SIDs in DB
        await supabase
            .from("tenant_a2p_registrations")
            .update({
                secondary_customer_profile_sid: customerProfile.sid,
                secondary_profile_status: "pending-review",
                customer_profile_sid: customerProfile.sid,
                end_user_business_sid: businessEndUser.sid,
                end_user_rep1_sid: rep1EndUser.sid,
                end_user_rep2_sid: rep2EndUser.sid,
                address_sid: addressResult.sid,
                current_step: "profile_review",
            })
            .eq("client_id", clientId);

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("createA2PCustomerProfile error:", err);
        return { success: false, error: err.message || "Failed to create customer profile" };
    }
}

// Step 3: Create A2P Trust Product (after customer profile is approved)
export async function createA2PTrustProductAction(clientId: string) {
    try {
        const account = await getTwilioAccount(clientId);
        if (!account) return { success: false, error: "Twilio subaccount not provisioned." };

        const { data: registration } = await supabase
            .from("tenant_a2p_registrations")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (!registration) return { success: false, error: "No A2P registration found." };
        if (registration.secondary_profile_status !== "twilio-approved") {
            return { success: false, error: "Customer profile must be approved first." };
        }

        const { data: profile } = await supabase
            .from("tenant_profiles")
            .select("*")
            .eq("client_id", clientId)
            .single();

        const { data: client } = await supabase
            .from("clients")
            .select("name, email")
            .eq("id", clientId)
            .single();

        const email = client?.email || "support@ominify.com";
        const businessName = profile?.legal_business_name || client?.name || "Unknown";

        // 1. Create Trust Product
        const trustProduct = await createA2PTrustProduct(
            account.subaccount_sid, account.auth_token_encrypted,
            `${businessName} - A2P Trust`,
            email
        );

        // 2. Create A2P Profile EndUser
        const a2pEndUser = await createEndUserA2PProfile(
            account.subaccount_sid, account.auth_token_encrypted,
            {
                businessName,
                brandName: businessName,
                businessType: profile?.business_type || "LLC",
                businessIndustry: profile?.business_industry || "ONLINE",
                businessRegistrationNumber: profile?.ein_tax_id || "",
                businessRegionsOfOperation: profile?.business_regions_of_operation || "USA_AND_CANADA",
                websiteUrl: profile?.website || "",
            }
        );

        // 3. Attach Secondary Customer Profile to Trust Product
        await attachEntityToTrustProduct(
            account.subaccount_sid, account.auth_token_encrypted,
            trustProduct.sid, registration.secondary_customer_profile_sid
        );

        // 4. Attach A2P EndUser to Trust Product
        await attachEntityToTrustProduct(
            account.subaccount_sid, account.auth_token_encrypted,
            trustProduct.sid, a2pEndUser.sid
        );

        // 5. Evaluate and Submit
        await evaluateAndSubmitTrustProduct(
            account.subaccount_sid, account.auth_token_encrypted,
            trustProduct.sid
        );

        // 6. Update DB
        await supabase
            .from("tenant_a2p_registrations")
            .update({
                trust_product_sid: trustProduct.sid,
                trust_product_status: "pending-review",
                end_user_a2p_profile_sid: a2pEndUser.sid,
                current_step: "trust_review",
            })
            .eq("id", registration.id);

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("createA2PTrustProductAction error:", err);
        return { success: false, error: err.message || "Failed to create trust product" };
    }
}

// Step 4: Register Brand (after trust product is approved)
export async function registerBrandAction(clientId: string) {
    try {
        const account = await getTwilioAccount(clientId);
        if (!account) return { success: false, error: "Twilio subaccount not provisioned." };

        const { data: registration } = await supabase
            .from("tenant_a2p_registrations")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (!registration) return { success: false, error: "No A2P registration found." };
        if (registration.trust_product_status !== "twilio-approved") {
            return { success: false, error: "Trust product must be approved first." };
        }

        // Register brand
        const brandResult = await registerBrand(
            account.subaccount_sid,
            account.auth_token_encrypted,
            registration.trust_product_sid,
            registration.secondary_customer_profile_sid
        );

        // Create messaging service if not exists
        let messagingServiceSid = account.messaging_service_sid;
        if (!messagingServiceSid) {
            const { data: profile } = await supabase
                .from("tenant_profiles")
                .select("legal_business_name")
                .eq("client_id", clientId)
                .single();

            const { data: client } = await supabase
                .from("clients")
                .select("name")
                .eq("id", clientId)
                .single();

            const msgService = await createMessagingService(
                account.subaccount_sid,
                account.auth_token_encrypted,
                profile?.legal_business_name || client?.name || "OMINIFY Tenant",
                clientId
            );
            messagingServiceSid = msgService.sid;

            await supabase
                .from("tenant_twilio_accounts")
                .update({ messaging_service_sid: messagingServiceSid })
                .eq("client_id", clientId);
        }

        // Update DB
        await supabase
            .from("tenant_a2p_registrations")
            .update({
                brand_sid: brandResult.brandSid,
                brand_status: "pending",
                current_step: "brand_review",
            })
            .eq("id", registration.id);

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true };
    } catch (err: any) {
        console.error("registerBrandAction error:", err);
        return { success: false, error: err.message || "Failed to register brand" };
    }
}

// Campaign submission
export interface CampaignSubmission {
    description: string;
    messageFlow: string;
    sampleMessages: [string, string];
    optInMessage: string;
    optOutMessage: string;
    helpMessage: string;
}

export async function submitA2PCampaign(clientId: string, campaign: CampaignSubmission) {
    try {
        const { data: registration } = await supabase
            .from("tenant_a2p_registrations")
            .select("*")
            .eq("client_id", clientId)
            .single();

        if (!registration) {
            return { success: false, error: "No A2P registration found." };
        }

        if (registration.brand_status !== "APPROVED") {
            return { success: false, error: "Brand must be approved before submitting a campaign." };
        }

        if (registration.campaign_sid) {
            return { success: false, error: "Campaign already submitted." };
        }

        const account = await getTwilioAccount(clientId);
        if (!account) return { success: false, error: "Twilio subaccount not found." };
        if (!account.messaging_service_sid) return { success: false, error: "Messaging service not configured." };

        const campaignResult = await registerCampaign(
            account.subaccount_sid,
            account.auth_token_encrypted,
            account.messaging_service_sid,
            registration.brand_sid,
            {
                description: campaign.description,
                messageFlow: campaign.messageFlow,
                sampleMessages: campaign.sampleMessages,
                optInMessage: campaign.optInMessage,
                optOutMessage: campaign.optOutMessage,
                helpMessage: campaign.helpMessage,
            }
        );

        await supabase
            .from("tenant_a2p_registrations")
            .update({
                campaign_sid: campaignResult.campaignSid,
                campaign_status: "pending_approval",
                current_step: "campaign_review",
            })
            .eq("id", registration.id);

        revalidatePath(`/client/${clientId}/phone-numbers`);
        return { success: true, campaignStatus: "pending_approval" };
    } catch (err: any) {
        console.error("submitA2PCampaign error:", err);
        return { success: false, error: err.message || "Failed to submit campaign" };
    }
}

// Poll all pending stages
export async function checkA2PStatus(clientId: string) {
    try {
        const { data: registration } = await supabase
            .from("tenant_a2p_registrations")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        if (!registration) {
            return { success: true, data: null };
        }

        const account = await getTwilioAccount(clientId);
        if (!account) {
            return { success: true, data: registration };
        }

        let updated = false;
        const updates: Record<string, string> = {};

        // Check customer profile status
        if (
            registration.secondary_customer_profile_sid &&
            (registration.secondary_profile_status === "pending-review" || registration.secondary_profile_status === "in-review")
        ) {
            try {
                const profileStatus = await checkCustomerProfileStatus(
                    account.subaccount_sid, account.auth_token_encrypted,
                    registration.secondary_customer_profile_sid
                );
                if (profileStatus.status !== registration.secondary_profile_status) {
                    updates.secondary_profile_status = profileStatus.status;
                    registration.secondary_profile_status = profileStatus.status;
                    if (profileStatus.status === "twilio-approved") {
                        updates.current_step = "trust_product";
                    }
                    updated = true;
                }
            } catch (err) {
                console.error("[A2P] Check profile status error:", err);
            }
        }

        // Check trust product status
        if (
            registration.trust_product_sid &&
            (registration.trust_product_status === "pending-review" || registration.trust_product_status === "in-review")
        ) {
            try {
                const trustStatus = await checkTrustProductStatus(
                    account.subaccount_sid, account.auth_token_encrypted,
                    registration.trust_product_sid
                );
                if (trustStatus.status !== registration.trust_product_status) {
                    updates.trust_product_status = trustStatus.status;
                    registration.trust_product_status = trustStatus.status;
                    if (trustStatus.status === "twilio-approved") {
                        updates.current_step = "brand_registration";
                    }
                    updated = true;
                }
            } catch (err) {
                console.error("[A2P] Check trust product status error:", err);
            }
        }

        // Check brand status
        if (registration.brand_sid && registration.brand_status === "pending") {
            try {
                const brandStatus = await checkBrandStatus(
                    account.subaccount_sid, account.auth_token_encrypted,
                    registration.brand_sid
                );
                if (brandStatus.status !== registration.brand_status) {
                    updates.brand_status = brandStatus.status;
                    registration.brand_status = brandStatus.status;
                    if (brandStatus.status === "APPROVED") {
                        updates.current_step = "campaign";
                    }
                    updated = true;
                }
            } catch (err) {
                console.error("[A2P] Check brand status error:", err);
            }
        }

        // Check campaign status
        if (
            registration.campaign_sid &&
            registration.campaign_status === "pending_approval" &&
            account.messaging_service_sid
        ) {
            try {
                const campaignStatus = await checkCampaignStatus(
                    account.subaccount_sid, account.auth_token_encrypted,
                    account.messaging_service_sid, registration.campaign_sid
                );
                if (campaignStatus.status !== registration.campaign_status) {
                    updates.campaign_status = campaignStatus.status;
                    registration.campaign_status = campaignStatus.status;
                    if (campaignStatus.status === "VERIFIED") {
                        updates.current_step = "complete";
                    }
                    updated = true;
                }
            } catch (err) {
                console.error("[A2P] Check campaign status error:", err);
            }
        }

        if (updated) {
            await supabase
                .from("tenant_a2p_registrations")
                .update(updates)
                .eq("id", registration.id);
            revalidatePath(`/client/${clientId}/phone-numbers`);
        }

        return { success: true, data: registration };
    } catch (err: any) {
        console.error("checkA2PStatus error:", err);
        return { success: false, error: err.message, data: null };
    }
}
