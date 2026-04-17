import "server-only";
import Twilio from "twilio";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_WEBHOOK_BASE_URL = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.ominify.com";

// Main account client — used for subaccount creation
function getMainClient() {
    return Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// Subaccount client — used for operations on a specific tenant's subaccount
function getSubClient(subaccountSid: string, authToken: string) {
    return Twilio(subaccountSid, authToken);
}

// ─── Credential Validation ─────────────────────────────────────────────────

export async function validateTwilioCredentials(
    accountSid: string,
    authToken: string
): Promise<{ valid: boolean; friendlyName?: string; error?: string }> {
    try {
        const client = getSubClient(accountSid, authToken);
        const account = await client.api.accounts(accountSid).fetch();
        return { valid: true, friendlyName: account.friendlyName };
    } catch (err: any) {
        const code = err.code || err.status;
        if (code === 20003 || code === 401) {
            return { valid: false, error: "Invalid Account SID or Auth Token" };
        }
        return { valid: false, error: err.message || "Failed to validate credentials" };
    }
}

// ─── Account-Scoped Number Search (for BYOT) ──────────────────────────────

export async function listAvailableNumbersOnAccount(
    accountSid: string,
    authToken: string,
    areaCode?: string,
    country: string = "US",
    limit: number = 10
) {
    const client = getSubClient(accountSid, authToken);
    const options: any = {
        smsEnabled: true,
        voiceEnabled: true,
        limit,
    };
    if (areaCode) {
        options.areaCode = areaCode;
    }

    const numbers = await client
        .availablePhoneNumbers(country)
        .local.list(options);

    return numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        capabilities: {
            sms: n.capabilities.sms,
            voice: n.capabilities.voice,
            mms: n.capabilities.mms,
        },
    }));
}

// ─── Subaccount Management ──────────────────────────────────────────────────

export async function createSubaccount(friendlyName: string) {
    const client = getMainClient();
    const subaccount = await client.api.accounts.create({
        friendlyName: `OMINIFY - ${friendlyName}`,
    });

    return {
        sid: subaccount.sid,
        authToken: subaccount.authToken,
        friendlyName: subaccount.friendlyName,
    };
}

// ─── Phone Number Management ────────────────────────────────────────────────

export async function listAvailableNumbers(
    areaCode?: string,
    country: string = "US",
    limit: number = 10
) {
    const client = getMainClient();
    const options: any = {
        smsEnabled: true,
        voiceEnabled: true,
        limit,
    };
    if (areaCode) {
        options.areaCode = areaCode;
    }

    const numbers = await client
        .availablePhoneNumbers(country)
        .local.list(options);

    return numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        capabilities: {
            sms: n.capabilities.sms,
            voice: n.capabilities.voice,
            mms: n.capabilities.mms,
        },
    }));
}

export async function purchasePhoneNumber(
    subaccountSid: string,
    authToken: string,
    phoneNumber: string,
    tenantId: string
) {
    const subClient = getSubClient(subaccountSid, authToken);

    const purchased = await subClient.incomingPhoneNumbers.create({
        phoneNumber,
        smsUrl: `${TWILIO_WEBHOOK_BASE_URL}/api/webhooks/twilio?type=sms-inbound&tenantId=${tenantId}`,
        voiceUrl: `${TWILIO_WEBHOOK_BASE_URL}/api/webhooks/twilio?type=voice-inbound&tenantId=${tenantId}`,
        statusCallback: `${TWILIO_WEBHOOK_BASE_URL}/api/webhooks/twilio?type=status&tenantId=${tenantId}`,
    });

    return {
        sid: purchased.sid,
        phoneNumber: purchased.phoneNumber,
        friendlyName: purchased.friendlyName,
    };
}

export async function releasePhoneNumber(
    subaccountSid: string,
    authToken: string,
    phoneNumberSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    await subClient.incomingPhoneNumbers(phoneNumberSid).remove();
}

export async function listPurchasedNumbers(
    subaccountSid: string,
    authToken: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const numbers = await subClient.incomingPhoneNumbers.list();

    return numbers.map((n) => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        capabilities: n.capabilities,
        dateCreated: n.dateCreated,
    }));
}

// ─── Messaging Service ──────────────────────────────────────────────────────

export async function createMessagingService(
    subaccountSid: string,
    authToken: string,
    friendlyName: string,
    tenantId: string
) {
    const subClient = getSubClient(subaccountSid, authToken);

    const service = await subClient.messaging.v1.services.create({
        friendlyName: `${friendlyName} - Sequencer`,
        inboundRequestUrl: `${TWILIO_WEBHOOK_BASE_URL}/api/webhooks/twilio?type=messaging&tenantId=${tenantId}`,
        statusCallback: `${TWILIO_WEBHOOK_BASE_URL}/api/webhooks/twilio?type=sms-status&tenantId=${tenantId}`,
        useInboundWebhookOnNumber: false,
    });

    return {
        sid: service.sid,
        friendlyName: service.friendlyName,
    };
}

export async function addNumberToMessagingService(
    subaccountSid: string,
    authToken: string,
    messagingServiceSid: string,
    phoneNumberSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    await subClient.messaging.v1
        .services(messagingServiceSid)
        .phoneNumbers.create({ phoneNumberSid });
}

// ─── A2P 10DLC — TrustHub Customer Profile ─────────────────────────────────

const SECONDARY_CUSTOMER_PROFILE_POLICY_SID = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_TRUST_PRODUCT_POLICY_SID = "RNb0d4771c2c98518d916a3d4cd70a8f8b";
const TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID || "";

// Step 1: Create Secondary Customer Profile (the tenant's TrustHub profile)
export async function createSecondaryCustomerProfile(
    subaccountSid: string,
    authToken: string,
    friendlyName: string,
    email: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const profile = await subClient.trusthub.v1.customerProfiles.create({
        friendlyName,
        email,
        policySid: SECONDARY_CUSTOMER_PROFILE_POLICY_SID,
    });
    return { sid: profile.sid, status: profile.status };
}

// Step 2: Create EndUser for business information
export async function createEndUserBusinessInfo(
    subaccountSid: string,
    authToken: string,
    businessInfo: {
        businessName: string;
        businessType: string;
        businessIndustry: string;
        businessRegistrationNumber: string;
        businessRegistrationIdType: string;
        businessRegionsOfOperation: string;
        websiteUrl: string;
        socialMediaProfileUrls?: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const endUser = await subClient.trusthub.v1.endUsers.create({
        friendlyName: `${businessInfo.businessName} - Business Info`,
        type: "customer_profile_business_information",
        attributes: {
            business_name: businessInfo.businessName,
            business_identity: "direct_customer",
            business_type: businessInfo.businessType,
            business_industry: businessInfo.businessIndustry,
            business_registration_identifier: businessInfo.businessRegistrationIdType,
            business_registration_number: businessInfo.businessRegistrationNumber,
            business_regions_of_operation: businessInfo.businessRegionsOfOperation,
            website_url: businessInfo.websiteUrl,
            social_media_profile_urls: businessInfo.socialMediaProfileUrls || businessInfo.websiteUrl,
        },
    });
    return { sid: endUser.sid };
}

// Step 3: Create EndUser for authorized representative
export async function createEndUserAuthorizedRep(
    subaccountSid: string,
    authToken: string,
    repNumber: 1 | 2,
    repInfo: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        businessTitle: string;
        jobPosition: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const endUser = await subClient.trusthub.v1.endUsers.create({
        friendlyName: `${repInfo.firstName} ${repInfo.lastName} - Auth Rep ${repNumber}`,
        type: `authorized_representative_${repNumber}`,
        attributes: {
            first_name: repInfo.firstName,
            last_name: repInfo.lastName,
            email: repInfo.email,
            phone_number: repInfo.phone,
            business_title: repInfo.businessTitle,
            job_position: repInfo.jobPosition,
        },
    });
    return { sid: endUser.sid };
}

// Step 4: Create address for TrustHub
export async function createTrustHubAddress(
    subaccountSid: string,
    authToken: string,
    addressInfo: {
        customerName: string;
        street: string;
        city: string;
        region: string;
        postalCode: string;
        isoCountry: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const address = await subClient.addresses.create({
        customerName: addressInfo.customerName,
        street: addressInfo.street,
        city: addressInfo.city,
        region: addressInfo.region,
        postalCode: addressInfo.postalCode,
        isoCountry: addressInfo.isoCountry || "US",
    });
    return { sid: address.sid };
}

// Step 5: Attach entity to customer profile via EntityAssignment
export async function attachEntityToCustomerProfile(
    subaccountSid: string,
    authToken: string,
    profileSid: string,
    objectSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    await subClient.trusthub.v1
        .customerProfiles(profileSid)
        .customerProfilesEntityAssignments.create({ objectSid });
}

// Step 6: Evaluate customer profile against policy
export async function evaluateCustomerProfile(
    subaccountSid: string,
    authToken: string,
    profileSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const evaluation = await subClient.trusthub.v1
        .customerProfiles(profileSid)
        .customerProfilesEvaluations.create({
            policySid: SECONDARY_CUSTOMER_PROFILE_POLICY_SID,
        });
    return { status: evaluation.status, results: evaluation.results };
}

// Step 7: Submit customer profile for review
export async function submitCustomerProfile(
    subaccountSid: string,
    authToken: string,
    profileSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const updated = await subClient.trusthub.v1
        .customerProfiles(profileSid)
        .update({ status: "pending-review" });
    return { sid: updated.sid, status: updated.status };
}

// Step 8: Check customer profile status
export async function checkCustomerProfileStatus(
    subaccountSid: string,
    authToken: string,
    profileSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const profile = await subClient.trusthub.v1.customerProfiles(profileSid).fetch();
    return { sid: profile.sid, status: profile.status };
}

// ─── A2P 10DLC — Trust Product ──────────────────────────────────────────────

// Create A2P Trust Product (links customer profile to A2P use case)
export async function createA2PTrustProduct(
    subaccountSid: string,
    authToken: string,
    friendlyName: string,
    email: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const trustProduct = await subClient.trusthub.v1.trustProducts.create({
        friendlyName,
        email,
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
    });
    return { sid: trustProduct.sid, status: trustProduct.status };
}

// Create EndUser for A2P profile information
export async function createEndUserA2PProfile(
    subaccountSid: string,
    authToken: string,
    profileInfo: {
        businessName: string;
        brandName: string;
        businessType: string;
        businessIndustry: string;
        businessRegistrationNumber: string;
        businessRegionsOfOperation: string;
        websiteUrl: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const endUser = await subClient.trusthub.v1.endUsers.create({
        friendlyName: `${profileInfo.businessName} - A2P Profile`,
        type: "a2p_profile_information",
        attributes: {
            business_name: profileInfo.businessName,
            brand_name: profileInfo.brandName || profileInfo.businessName,
            business_type: profileInfo.businessType,
            business_industry: profileInfo.businessIndustry,
            business_registration_number: profileInfo.businessRegistrationNumber,
            business_regions_of_operation: profileInfo.businessRegionsOfOperation,
            website_url: profileInfo.websiteUrl,
        },
    });
    return { sid: endUser.sid };
}

// Attach entity to Trust Product
export async function attachEntityToTrustProduct(
    subaccountSid: string,
    authToken: string,
    trustProductSid: string,
    objectSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    await subClient.trusthub.v1
        .trustProducts(trustProductSid)
        .trustProductsEntityAssignments.create({ objectSid });
}

// Evaluate and submit Trust Product
export async function evaluateAndSubmitTrustProduct(
    subaccountSid: string,
    authToken: string,
    trustProductSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);

    // Evaluate
    const evaluation = await subClient.trusthub.v1
        .trustProducts(trustProductSid)
        .trustProductsEvaluations.create({
            policySid: A2P_TRUST_PRODUCT_POLICY_SID,
        });

    // Submit for review
    const updated = await subClient.trusthub.v1
        .trustProducts(trustProductSid)
        .update({ status: "pending-review" });

    return { sid: updated.sid, status: updated.status, evaluationStatus: evaluation.status };
}

// Check Trust Product status
export async function checkTrustProductStatus(
    subaccountSid: string,
    authToken: string,
    trustProductSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const product = await subClient.trusthub.v1.trustProducts(trustProductSid).fetch();
    return { sid: product.sid, status: product.status };
}

// ─── A2P 10DLC — Brand Registration ────────────────────────────────────────

export async function registerBrand(
    subaccountSid: string,
    authToken: string,
    a2PProfileBundleSid: string,
    customerProfileBundleSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);

    const brand = await subClient.messaging.v1.brandRegistrations.create({
        customerProfileBundleSid,
        a2PProfileBundleSid,
        brandType: "STARTER",
    });

    return {
        brandSid: brand.sid,
        brandStatus: brand.status,
    };
}

export async function checkBrandStatus(
    subaccountSid: string,
    authToken: string,
    brandSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const brand = await subClient.messaging.v1.brandRegistrations(brandSid).fetch();

    return {
        status: brand.status,
        brandSid: brand.sid,
    };
}

// ─── A2P 10DLC Campaign Registration ───────────────────────────────────────

export async function registerCampaign(
    subaccountSid: string,
    authToken: string,
    messagingServiceSid: string,
    brandSid: string,
    campaignInfo: {
        description: string;
        messageFlow: string;
        sampleMessages: string[];
        optInMessage: string;
        optOutMessage: string;
        helpMessage: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);

    const campaign = await subClient.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson.create({
            brandRegistrationSid: brandSid,
            description: campaignInfo.description,
            messageFlow: campaignInfo.messageFlow,
            messageSamples: campaignInfo.sampleMessages,
            usAppToPersonUsecase: "LOW_VOLUME",
            hasEmbeddedLinks: true,
            hasEmbeddedPhone: true,
            optInKeywords: ["START", "YES", "SUBSCRIBE"],
            optOutKeywords: ["STOP", "UNSUBSCRIBE", "CANCEL"],
            helpKeywords: ["HELP", "INFO"],
            optInMessage: campaignInfo.optInMessage,
            optOutMessage: campaignInfo.optOutMessage,
            helpMessage: campaignInfo.helpMessage,
        });

    return {
        campaignSid: campaign.sid,
        campaignStatus: campaign.campaignStatus,
    };
}

export async function checkCampaignStatus(
    subaccountSid: string,
    authToken: string,
    messagingServiceSid: string,
    campaignSid: string
) {
    const subClient = getSubClient(subaccountSid, authToken);
    const campaign = await subClient.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson(campaignSid)
        .fetch();

    return {
        campaignSid: campaign.sid,
        status: campaign.campaignStatus,
    };
}

// ─── SMS Sending ────────────────────────────────────────────────────────────

export async function sendSMS(
    subaccountSid: string,
    authToken: string,
    from: string,
    to: string,
    body: string
) {
    const subClient = getSubClient(subaccountSid, authToken);

    const message = await subClient.messages.create({
        from,
        to,
        body,
    });

    return {
        sid: message.sid,
        status: message.status,
    };
}
