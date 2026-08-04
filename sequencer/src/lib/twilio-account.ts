/**
 * Twilio account-SID resolution for `tenant_twilio_accounts`.
 *
 * TYPE B (`type_b_subaccount`) stores the SID in `subaccount_sid`.
 * TYPE A (`type_a_byoa`) stores the customer's own account SID in
 * `external_account_sid` and leaves `subaccount_sid` NULL — reading only
 * `subaccount_sid` made every BYOA tenant silently SMS-incapable (the send
 * path bailed before it could even log, so nothing appeared in
 * sequence_execution_log).
 *
 * `Twilio(accountSid, authToken)` accepts a main-account SID plus its own
 * token, so the resolved SID pairs correctly with `auth_token_encrypted` on
 * both account types. BYOA rows always carry a token: the only writer is
 * connectExternalTwilioAccount (src/app/actions/twilio-actions.ts), which
 * validates the pair against Twilio before inserting.
 *
 * KEEP IN SYNC with src/lib/twilio-account.ts in the main app — separate
 * builds, duplicated deliberately (same arrangement as channel-capabilities).
 */

export interface TwilioAccountSidFields {
    account_type?: string | null;
    subaccount_sid?: string | null;
    external_account_sid?: string | null;
}

/**
 * Resolve the account SID to authenticate with, or null if neither column is
 * populated.
 *
 * Branches on account_type with a two-way fallback rather than a bare
 * `subaccount_sid ?? external_account_sid`: this preserves the BYOA-first
 * semantics already shipped in getAccountCredentials / phone-assignment-actions,
 * while still resolving rows patched by scripts/fix-byoa-sms.mjs (which copied
 * the SID *into* subaccount_sid on a BYOA row).
 */
export function resolveTwilioAccountSid(
    account: TwilioAccountSidFields | null | undefined
): string | null {
    if (!account) return null;
    return account.account_type === 'type_a_byoa'
        ? account.external_account_sid || account.subaccount_sid || null
        : account.subaccount_sid || account.external_account_sid || null;
}
