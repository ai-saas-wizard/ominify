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

// ─── A2P 10DLC Brand Registration ──────────────────────────────────────────

export async function registerBrand(
    subaccountSid: string,
    authToken: string,
    businessInfo: {
        legalName: string;
        contactEmail: string;
        customerProfileSid: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);

    // Create customer profile in Trust Hub
    const customerProfile = await subClient.trusthub.v1.customerProfiles.create({
        friendlyName: businessInfo.legalName,
        email: businessInfo.contactEmail,
        policySid: "RNb0d4771c2c98518d916a3d4cd70a8f8b", // Twilio A2P Trust policy
    });

    // Register brand
    const brand = await subClient.messaging.v1.brandRegistrations.create({
        customerProfileBundleSid: customerProfile.sid,
        a2PProfileBundleSid: customerProfile.sid,
        brandType: "STANDARD",
    });

    return {
        brandSid: brand.sid,
        brandStatus: brand.status,
        customerProfileSid: customerProfile.sid,
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
        sampleMessages: string[];
        companyName: string;
    }
) {
    const subClient = getSubClient(subaccountSid, authToken);

    const campaign = await subClient.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson.create({
            brandRegistrationSid: brandSid,
            description: campaignInfo.description,
            messageFlow: campaignInfo.description,
            messageSamples: campaignInfo.sampleMessages,
            usAppToPersonUsecase: "MIXED",
            hasEmbeddedLinks: true,
            hasEmbeddedPhone: true,
            optInKeywords: ["START", "YES", "SUBSCRIBE"],
            optOutKeywords: ["STOP", "UNSUBSCRIBE", "CANCEL"],
            helpKeywords: ["HELP", "INFO"],
            optInMessage: `You're now receiving messages from ${campaignInfo.companyName}. Reply STOP to opt out.`,
            optOutMessage: `You've been unsubscribed from ${campaignInfo.companyName}. Reply START to re-subscribe.`,
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
