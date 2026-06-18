/**
 * Lead Ingestion Routes
 * 
 * Handles inbound leads from various sources:
 * - Google Ads
 * - Facebook Lead Ads
 * - Generic webhooks
 * - CSV uploads
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { supabase } from '../../lib/db.js';
import { isWebhookAuthDisabled } from '../middleware/webhook-auth.js';
import { normalizePhone, phoneLookupCandidates } from '../../lib/phone.js';
import { isContactOptedOut } from '../../lib/opt-out.js';
import { timingSafeEqualStr } from '../../lib/signing.js';
import type { Sequence, Contact } from '../../lib/types.js';
import { addSeconds } from 'date-fns';

interface GoogleAdsLead {
    lead_id: string;
    campaign_id: string;
    form_id: string;
    user_column_data: Array<{ column_name: string; string_value: string }>;
    gcl_id?: string;
}

interface FacebookLead {
    leadgen_id: string;
    page_id: string;
    form_id: string;
    field_data: Array<{ name: string; values: string[] }>;
    created_time: string;
}

interface GenericLead {
    phone: string;
    email?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    source?: string;
    keywords?: string;
    urgency?: string;
    customVariables?: Record<string, any>;
    // Explicit opt-out of auto-enrollment: create the contact only.
    // Auto-enroll stays the default (undefined/true → enroll).
    enroll_in_sequence?: boolean;
}

interface TenantParams {
    tenantId: string;
}

/**
 * Parse Google Ads webhook payload
 */
function parseGoogleAdsLead(payload: GoogleAdsLead): GenericLead {
    const fields: Record<string, string> = {};

    for (const col of payload.user_column_data) {
        fields[col.column_name.toLowerCase()] = col.string_value;
    }

    return {
        phone: fields.phone || fields.phone_number || '',
        email: fields.email,
        name: fields.full_name || `${fields.first_name || ''} ${fields.last_name || ''}`.trim(),
        first_name: fields.first_name,
        last_name: fields.last_name,
        keywords: payload.gcl_id, // Could decode from gclid
        customVariables: {
            google_lead_id: payload.lead_id,
            campaign_id: payload.campaign_id,
        },
    };
}

/**
 * Parse Facebook Lead Ads webhook payload
 */
function parseFacebookLead(payload: FacebookLead): GenericLead {
    const fields: Record<string, string> = {};

    for (const field of payload.field_data) {
        fields[field.name.toLowerCase()] = field.values[0];
    }

    return {
        phone: fields.phone_number || fields.phone || '',
        email: fields.email,
        name: fields.full_name || `${fields.first_name || ''} ${fields.last_name || ''}`.trim(),
        first_name: fields.first_name,
        last_name: fields.last_name,
        customVariables: {
            facebook_lead_id: payload.leadgen_id,
            facebook_page_id: payload.page_id,
        },
    };
}

/**
 * Upsert contact in database
 */
async function upsertContact(tenantId: string, leadData: GenericLead): Promise<Contact> {
    // Store E.164 when the phone parses; fall back to the trimmed raw value
    // so we never drop a lead over an unparseable number.
    const storedPhone = normalizePhone(leadData.phone) ?? leadData.phone.trim();

    // Dedup lookup matches both the E.164 form and the raw form so legacy
    // un-normalized rows are found.
    const candidates = phoneLookupCandidates(leadData.phone);

    const { data: existing, error: lookupError } = await supabase
        .from('contacts')
        .select('*')
        .eq('client_id', tenantId)
        .in('phone', candidates)
        .limit(1)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Contact lookup failed: ${lookupError.message}`);
    }

    if (existing) {
        // Merge custom variables into existing custom_fields (existing values preserved, new ones added)
        const mergedCustomFields = {
            ...(existing.custom_fields || {}),
            ...(leadData.customVariables || {}),
        };

        // Update last touch and merge custom fields
        const { error: updateError } = await supabase
            .from('contacts')
            .update({
                updated_at: new Date().toISOString(),
                name: leadData.name || existing.name,
                email: leadData.email || existing.email,
                first_name: leadData.first_name || existing.first_name,
                last_name: leadData.last_name || existing.last_name,
                company: leadData.company || existing.company,
                custom_fields: mergedCustomFields,
            })
            .eq('id', existing.id);
        if (updateError) {
            console.error(`[LEAD] Failed to update contact ${existing.id}:`, updateError.message);
        }
        return { ...existing, custom_fields: mergedCustomFields } as Contact;
    }

    // Insert new contact with custom variables persisted to custom_fields
    const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
            client_id: tenantId,
            phone: storedPhone,
            email: leadData.email,
            name: leadData.name,
            first_name: leadData.first_name,
            last_name: leadData.last_name,
            company: leadData.company,
            custom_fields: leadData.customVariables || {},
        })
        .select()
        .single();

    // Concurrent ingestion of the same lead can race past the lookup and
    // trip UNIQUE(client_id, phone) — re-fetch the winner instead of 500ing.
    if (error?.code === '23505') {
        const { data: raced } = await supabase
            .from('contacts')
            .select('*')
            .eq('client_id', tenantId)
            .in('phone', candidates)
            .limit(1)
            .maybeSingle();
        if (raced) return raced as Contact;
    }

    if (error || !newContact) {
        throw new Error(`Failed to create contact: ${error?.message}`);
    }

    return newContact as Contact;
}

/**
 * Find matching sequence based on trigger conditions
 */
async function findMatchingSequence(tenantId: string, leadData: GenericLead, source: string): Promise<Sequence | null> {
    const { data: sequences, error } = await supabase
        .from('sequences')
        .select('*')
        .eq('client_id', tenantId)
        .eq('is_active', true)
        .order('urgency_tier', { ascending: true }); // critical first

    if (error || !sequences || sequences.length === 0) {
        return null;
    }

    // Find first matching sequence
    for (const seq of sequences) {
        const conditions = seq.trigger_conditions as Sequence['trigger_conditions'];

        // Match lead source
        if (conditions.lead_source && conditions.lead_source.length > 0) {
            if (!conditions.lead_source.includes(source) && !conditions.lead_source.includes('*')) {
                continue;
            }
        }

        // Match job type keywords
        if (conditions.job_type_keywords && conditions.job_type_keywords.length > 0 && leadData.keywords) {
            const hasMatch = conditions.job_type_keywords.some(kw =>
                leadData.keywords!.toLowerCase().includes(kw.toLowerCase())
            );
            if (!hasMatch) continue;
        }

        // Matched!
        return seq as Sequence;
    }

    // Return default sequence if available (one with no specific conditions)
    const defaultSeq = sequences.find(s => {
        const c = s.trigger_conditions as Sequence['trigger_conditions'];
        return !c.lead_source && !c.job_type_keywords;
    });

    return defaultSeq as Sequence || null;
}

/**
 * Enroll contact in sequence
 */
async function enrollInSequence(
    tenantId: string,
    contactId: string,
    sequence: Sequence,
    source: string,
    customVariables: Record<string, any>
): Promise<string> {
    // Get first step
    const { data: firstStep } = await supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', sequence.id)
        .order('step_order', { ascending: true })
        .limit(1)
        .single();

    const nextStepAt = firstStep
        ? addSeconds(new Date(), (firstStep.delay_minutes ?? 0) * 60)
        : new Date();

    // Create enrollment
    const { data: enrollment, error } = await supabase
        .from('sequence_enrollments')
        .insert({
            tenant_id: tenantId,
            sequence_id: sequence.id,
            contact_id: contactId,
            status: 'active',
            current_step_order: 0,
            next_step_at: nextStepAt.toISOString(),
            enrollment_source: source,
            custom_variables: customVariables,
            sentiment_trend: 'stable',
            last_emotion: null,
            recommended_tone: null,
            is_hot_lead: false,
            is_at_risk: false,
            engagement_score: 50,
            needs_human_intervention: false,
            contact_replied: false,
            contact_answered_call: false,
            appointment_booked: false,
        })
        .select('id')
        .single();

    if (error) {
        // Check for duplicate enrollment
        if (error.code === '23505') {
            console.log(`[LEAD] Contact already enrolled in sequence`);
            return '';
        }
        throw new Error(`Failed to create enrollment: ${error.message}`);
    }

    return enrollment.id;
}

/**
 * Core lead ingestion logic
 */
async function ingestLead(
    tenantId: string,
    leadData: GenericLead,
    source: string,
    autoEnroll = true
): Promise<{ contactId: string; enrollmentId: string | null; skippedOptedOut?: boolean }> {
    console.log(`[LEAD] Ingesting lead: ${leadData.phone} from ${source} for tenant ${tenantId}`);

    // Validate phone
    if (!leadData.phone || typeof leadData.phone !== 'string' || !leadData.phone.trim()) {
        throw new Error('Phone number is required');
    }

    // 1. Upsert contact
    const contact = await upsertContact(tenantId, leadData);
    console.log(`[LEAD] Contact: ${contact.id}`);

    // 2. Honor contact-level opt-out — re-ingestion must NEVER re-enroll a
    // contact who said STOP / unsubscribed.
    if (isContactOptedOut(contact)) {
        console.log(`[LEAD] Contact ${contact.id} is opted out; skipping enrollment`);
        return { contactId: contact.id, enrollmentId: null, skippedOptedOut: true };
    }

    // 3. Explicit enroll_in_sequence: false → contact-only ingestion
    if (!autoEnroll) {
        console.log(`[LEAD] enroll_in_sequence=false; created/updated contact ${contact.id} without enrolling`);
        return { contactId: contact.id, enrollmentId: null };
    }

    // 4. Find matching sequence
    const sequence = await findMatchingSequence(tenantId, leadData, source);

    if (!sequence) {
        console.log(`[LEAD] No matching sequence for tenant ${tenantId}, source ${source}`);
        return { contactId: contact.id, enrollmentId: null };
    }

    console.log(`[LEAD] Matched sequence: ${sequence.name} (${sequence.urgency_tier})`);

    // 5. Enroll in sequence
    const enrollmentId = await enrollInSequence(
        tenantId,
        contact.id,
        sequence,
        source,
        leadData.customVariables || {}
    );

    if (enrollmentId) {
        console.log(`[LEAD] Enrolled: ${enrollmentId}`);
    }

    return { contactId: contact.id, enrollmentId };
}

/**
 * Lead-ingestion auth. Accepts EITHER:
 *  - the global LEAD_INGESTION_API_TOKEN bearer (NOTE: tenant-global — any
 *    holder can ingest leads for every tenant), or
 *  - a per-client API key scoped to the URL's tenantId, validated against
 *    the same client_api_keys table (sha256 hash, is_active) the Next.js
 *    lead endpoint uses. The key may arrive as `x-api-key` or as the bearer.
 */
async function requireLeadAuth(request: FastifyRequest, reply: FastifyReply) {
    if (isWebhookAuthDisabled()) return;

    const header = request.headers['authorization'];
    const bearer = (typeof header === 'string' && header.startsWith('Bearer '))
        ? header.slice(7).trim()
        : undefined;
    const apiKeyHeader = request.headers['x-api-key'];
    const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader.trim() : undefined;

    if (!bearer && !apiKey) {
        reply.status(401).send({ error: 'Missing bearer token or x-api-key' });
        return reply;
    }

    // 1. Global ingestion token (tenant-global)
    const globalToken = process.env.LEAD_INGESTION_API_TOKEN;
    if (globalToken && bearer && timingSafeEqualStr(bearer, globalToken)) {
        return;
    }

    // 2. Per-client API key scoped to the tenant in the URL
    const tenantId = (request.params as { tenantId?: string } | undefined)?.tenantId;
    const candidateKey = apiKey || bearer;
    if (tenantId && candidateKey) {
        const keyHash = createHash('sha256').update(candidateKey).digest('hex');
        const { data: keyRow, error } = await supabase
            .from('client_api_keys')
            .select('id')
            .eq('client_id', tenantId)
            .eq('key_hash', keyHash)
            .eq('is_active', true)
            .maybeSingle();

        if (!error && keyRow) {
            const { error: touchError } = await supabase
                .from('client_api_keys')
                .update({ last_used_at: new Date().toISOString() })
                .eq('id', keyRow.id);
            if (touchError) {
                console.warn(`[LEAD] Failed to update last_used_at for API key ${keyRow.id}:`, touchError.message);
            }
            return;
        }
    }

    reply.status(403).send({ error: 'Invalid token' });
    return reply;
}

export async function leadIngestion(fastify: FastifyInstance) {
    // Every lead-ingestion route requires either the global bearer token or
    // a per-client API key scoped to the URL's tenantId (see requireLeadAuth).
    const leadAuth = requireLeadAuth;

    /**
     * Google Ads Lead webhook
     * POST /webhooks/leads/google-ads/:tenantId
     */
    fastify.post<{ Params: TenantParams; Body: GoogleAdsLead }>(
        '/google-ads/:tenantId',
        { preHandler: leadAuth },
        async (request, reply) => {
            const { tenantId } = request.params;

            let leadData: GenericLead;
            try {
                leadData = parseGoogleAdsLead(request.body);
            } catch (error: any) {
                console.error('[LEAD] Malformed Google Ads payload:', error.message);
                reply.status(400).send({ error: 'Malformed Google Ads payload' });
                return;
            }

            try {
                const result = await ingestLead(tenantId, leadData, 'google_ads');
                reply.status(200).send(result);
            } catch (error: any) {
                console.error('[LEAD] Error:', error.message);
                reply.status(500).send({ error: error.message });
            }
        }
    );

    /**
     * Facebook Lead Ads webhook
     * POST /webhooks/leads/facebook/:tenantId
     */
    fastify.post<{ Params: TenantParams; Body: FacebookLead }>(
        '/facebook/:tenantId',
        { preHandler: leadAuth },
        async (request, reply) => {
            const { tenantId } = request.params;

            let leadData: GenericLead;
            try {
                leadData = parseFacebookLead(request.body);
            } catch (error: any) {
                console.error('[LEAD] Malformed Facebook payload:', error.message);
                reply.status(400).send({ error: 'Malformed Facebook payload' });
                return;
            }

            try {
                const result = await ingestLead(tenantId, leadData, 'facebook');
                reply.status(200).send(result);
            } catch (error: any) {
                console.error('[LEAD] Error:', error.message);
                reply.status(500).send({ error: error.message });
            }
        }
    );

    /**
     * Generic webhook
     * POST /webhooks/leads/generic/:tenantId
     */
    fastify.post<{ Params: TenantParams; Body: GenericLead }>(
        '/generic/:tenantId',
        { preHandler: leadAuth },
        async (request, reply) => {
            const { tenantId } = request.params;
            const leadData = request.body;

            if (!leadData || typeof leadData !== 'object') {
                reply.status(400).send({ error: 'Malformed lead payload' });
                return;
            }

            const source = leadData.source || 'webhook';
            const autoEnroll = leadData.enroll_in_sequence !== false;

            try {
                const result = await ingestLead(tenantId, leadData, source, autoEnroll);
                reply.status(200).send(result);
            } catch (error: any) {
                console.error('[LEAD] Error:', error.message);
                reply.status(500).send({ error: error.message });
            }
        }
    );

    /**
     * CSV bulk import
     * POST /webhooks/leads/csv/:tenantId
     */
    fastify.post<{ Params: TenantParams; Body: { leads: GenericLead[]; enroll_in_sequence?: boolean } }>(
        '/csv/:tenantId',
        { preHandler: leadAuth },
        async (request, reply) => {
            const { tenantId } = request.params;
            const { leads, enroll_in_sequence } = (request.body || {}) as { leads?: GenericLead[]; enroll_in_sequence?: boolean };

            if (!Array.isArray(leads)) {
                reply.status(400).send({ error: 'Body must contain a leads array' });
                return;
            }

            const results = {
                imported: 0,
                enrolled: 0,
                skipped_opted_out: 0,
                errors: [] as string[],
            };

            for (const leadData of leads) {
                try {
                    // Top-level enroll_in_sequence: false applies to the whole
                    // batch; a per-lead flag can also opt a single row out.
                    const autoEnroll = enroll_in_sequence !== false && leadData?.enroll_in_sequence !== false;
                    const result = await ingestLead(tenantId, leadData, 'csv_upload', autoEnroll);
                    results.imported++;
                    if (result.skippedOptedOut) results.skipped_opted_out++;
                    if (result.enrollmentId) results.enrolled++;
                } catch (error: any) {
                    results.errors.push(`${leadData?.phone}: ${error.message}`);
                }
            }

            reply.status(200).send(results);
        }
    );
}
