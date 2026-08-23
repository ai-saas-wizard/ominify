/**
 * One definition of "this tenant is A2P registered", shared by the server
 * actions and the channel capability check.
 *
 * Two things made a registered business read as unregistered:
 *
 *  1. Status was read only from our own tenant_a2p_registrations table, so a
 *     business that completed 10DLC directly with Twilio had no row at all.
 *  2. The comparison was against lowercase "approved", while Twilio returns
 *     "APPROVED" for a brand and "VERIFIED" for a campaign, so even our own
 *     completed registrations failed the test.
 *
 * Keeping the predicate here means a fix lands in both places at once.
 */

/** Brand states Twilio reports as usable. */
const BRAND_OK = new Set(["APPROVED"]);

/** Campaign states Twilio reports as usable. Both spellings appear in the wild. */
const CAMPAIGN_OK = new Set(["VERIFIED", "APPROVED", "ACTIVE"]);

export interface A2PStatusFields {
    brand_status?: string | null;
    campaign_status?: string | null;
}

export function isA2PRegistered(registration: A2PStatusFields | null | undefined): boolean {
    if (!registration) return false;
    const brand = String(registration.brand_status || "").toUpperCase();
    const campaign = String(registration.campaign_status || "").toUpperCase();
    return BRAND_OK.has(brand) && CAMPAIGN_OK.has(campaign);
}

/** True when the campaign alone is good enough to send at full throughput. */
export function isCampaignApproved(campaignStatus: string | null | undefined): boolean {
    return CAMPAIGN_OK.has(String(campaignStatus || "").toUpperCase());
}
