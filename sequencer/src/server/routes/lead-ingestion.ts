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
import { supabase } from '../../lib/db.js';
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
    // Check if contact exists
    const { data: existing } = await supabase
        .from('contacts')
        .select('*')
        .eq('client_id', tenantId)
        .eq('phone', leadData.phone)
        .single();

    if (existing) {
        // Merge custom variables into existing custom_fields (existing values preserved, new ones added)
        const mergedCustomFields = {
            ...(existing.custom_fields || {}),
            ...(leadData.customVariables || {}),
        };

        // Update last touch and merge custom fields
        await supabase
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
        return { ...existing, custom_fields: mergedCustomFields } as Contact;
    }

    // Insert new contact with custom variables persisted to custom_fields
    const { data: newContact, error } = await supabase
        .from('contacts')
        .insert({
            client_id: tenantId,
            phone: leadData.phone,
            email: leadData.email,
            name: leadData.name,
            first_name: leadData.first_name,
            last_name: leadData.last_name,
            company: leadData.company,
            custom_fields: leadData.customVariables || {},
        })
        .select()
        .single();

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
        .eq('tenant_id', tenantId)
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
        ? addSeconds(new Date(), firstStep.delay_seconds)
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
    source: string
): Promise<{ contactId: string; enrollmentId: string | null }> {
    console.log(`[LEAD] Ingesting lead: ${leadData.phone} from ${source} for tenant ${tenantId}`);

    // Validate phone
    if (!leadData.phone) {
        throw new Error('Phone number is required');
    }

    // 1. Upsert contact
    const contact = await upsertContact(tenantId, leadData);
    console.log(`[LEAD] Contact: ${contact.id}`);

    // 2. Find matching sequence
    const sequence = await findMatchingSequence(tenantId, leadData, source);

    if (!sequence) {
        console.log(`[LEAD] No matching sequence for tenant ${tenantId}, source ${source}`);
        return { contactId: contact.id, enrollmentId: null };
    }

    console.log(`[LEAD] Matched sequence: ${sequence.name} (${sequence.urgency_tier})`);

    // 3. Enroll in sequence
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

export async function leadIngestion(fastify: FastifyInstance) {
    /**
     * Google Ads Lead webhook
     * POST /webhooks/leads/google-ads/:tenantId
     */
    fastify.post<{ Params: TenantParams; Body: GoogleAdsLead }>(
        '/google-ads/:tenantId',
        async (request, reply) => {
            const { tenantId } = request.params;
            const leadData = parseGoogleAdsLead(request.body);

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
        async (request, reply) => {
            const { tenantId } = request.params;
            const leadData = parseFacebookLead(request.body);

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
        async (request, reply) => {
            const { tenantId } = request.params;
            const leadData = request.body;
            const source = leadData.source || 'webhook';

            try {
                const result = await ingestLead(tenantId, leadData, source);
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
    fastify.post<{ Params: TenantParams; Body: { leads: GenericLead[] } }>(
        '/csv/:tenantId',
        async (request, reply) => {
            const { tenantId } = request.params;
            const { leads } = request.body;

            const results = {
                imported: 0,
                enrolled: 0,
                errors: [] as string[],
            };

            for (const leadData of leads) {
                try {
                    const result = await ingestLead(tenantId, leadData, 'csv_upload');
                    results.imported++;
                    if (result.enrollmentId) results.enrolled++;
                } catch (error: any) {
                    results.errors.push(`${leadData.phone}: ${error.message}`);
                }
            }

            reply.status(200).send(results);
        }
    );
}
