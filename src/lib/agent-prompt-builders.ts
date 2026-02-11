import OpenAI from 'openai';
import {
    buildIndustryContext,
    buildServicesText,
    buildServiceAreaText,
    buildBusinessHoursText,
    buildBrandVoiceDirective,
    buildCustomPhrasesRules,
    buildQualificationText,
    buildAfterHoursText,
    type TenantProfileData,
} from './prompt-templates';
import { getAgentTypeDefinition, type AgentTypeId } from './agent-catalog';

// ═══════════════════════════════════════════════════════════
// AGENT PROMPT BUILDERS
// Generates system prompts + first messages for each agent
// type in the catalog. Reuses helpers from prompt-templates.
// ═══════════════════════════════════════════════════════════

interface AgentPromptResult {
    systemPrompt: string;
    firstMessage: string;
}

// ─── LLM HELPERS ───

async function generateAgentConversationFlow(
    businessName: string,
    profile: TenantProfileData,
    agentTypeId: string,
    purpose: string,
    customInstructions?: string
): Promise<string> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 15000,
        });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 800,
            temperature: 0.7,
            messages: [
                {
                    role: 'system',
                    content: `You write conversation flow scripts for voice AI phone agents. Output ONLY the numbered steps — no headers, no explanations.

Rules:
- 5-8 numbered steps with conditional branching
- Include <wait for user response> markers after questions
- Keep steps concise — voice call, not text
- Reference tools: "check_availability", "book_appointment", "endCall", "transferCall"
- For transfers: "Silently trigger the transferCall tool"
- End with a closing step that triggers endCall
${customInstructions ? `\nAdditional instructions from the user: ${customInstructions}` : ''}`,
                },
                {
                    role: 'user',
                    content: `Write a conversation flow for a "${agentTypeId}" agent at ${businessName} (${buildIndustryContext(profile.industry, profile.sub_industry)}).

Purpose: ${purpose}
Services: ${buildServicesText(profile.job_types)}
Brand voice: ${profile.brand_voice}`,
                },
            ],
        });

        return response.choices[0]?.message?.content || purpose;
    } catch (error) {
        console.error(`[PROMPT BUILDERS] Failed to generate flow for ${agentTypeId}:`, error);
        return purpose;
    }
}

async function generateAgentGreeting(
    businessName: string,
    profile: TenantProfileData,
    agentTypeId: string,
    direction: 'inbound' | 'outbound'
): Promise<string> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 10000,
        });

        const agentDef = getAgentTypeDefinition(agentTypeId);
        const agentName = agentDef?.name || agentTypeId;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 100,
            temperature: 0.7,
            messages: [
                {
                    role: 'system',
                    content: `You write short greeting messages for voice AI agents. Output ONLY the greeting — one or two sentences max, no quotes.

Voice style: ${profile.brand_voice || 'professional'}
Agent role: ${agentName}
Direction: ${direction}

Rules:
- Under 20 words
- Natural and human-sounding
- ${direction === 'inbound' ? 'Thank them for calling and ask how you can help' : 'Introduce yourself and your purpose for calling'}
- Use {{customer_name}} placeholder if referring to the person by name
- Spell out numbers as words`,
                },
                {
                    role: 'user',
                    content: `Write a greeting for "${businessName}" (${buildIndustryContext(profile.industry, profile.sub_industry)}).`,
                },
            ],
        });

        const greeting = response.choices[0]?.message?.content;
        if (greeting) return greeting.replace(/^["']|["']$/g, '');

        return direction === 'inbound'
            ? `Thanks for calling ${businessName}! How can I help you today?`
            : `Hi {{customer_name}}, this is the team at ${businessName} calling.`;
    } catch (error) {
        console.error(`[PROMPT BUILDERS] Failed to generate greeting for ${agentTypeId}:`, error);
        return direction === 'inbound'
            ? `Thanks for calling ${businessName}! How can I help you today?`
            : `Hi {{customer_name}}, this is the team at ${businessName} calling.`;
    }
}

// ─── SHARED PROMPT SECTIONS ───

function buildSharedStyleSection(profile: TenantProfileData): string {
    const brandDirective = buildBrandVoiceDirective(profile.brand_voice);
    const phrasesRules = buildCustomPhrasesRules(profile.custom_phrases);

    return `[Style]
${brandDirective}
- Be concise — this is a voice conversation, not a text chat.
- Ask only one question at a time.
- Speak dates using words (e.g., "January fifteenth").
- Speak phone numbers digit by digit with pauses.
- Speak prices naturally (e.g., "two hundred fifty dollars").
- Never say the word "function" or "tool" or mention tool names to the caller.
${phrasesRules}`;
}

function buildSharedContextSection(profile: TenantProfileData): string {
    const servicesText = buildServicesText(profile.job_types);
    const serviceAreaText = buildServiceAreaText(profile.service_area);
    const hoursText = buildBusinessHoursText(profile.business_hours, profile.timezone);

    return `[Context]
Services offered: ${servicesText}
Service area: ${serviceAreaText}

Business hours:
${hoursText}`;
}

function buildOverrideVariablesSection(agentTypeId: string): string {
    const def = getAgentTypeDefinition(agentTypeId);
    if (!def || def.override_variables.length === 0) return '';

    const lines = def.override_variables.map(
        (v) => `- {{${v.name}}} — ${v.description}${v.default_value ? ` (defaults to "${v.default_value}")` : ''}`
    );

    return `[Dynamic Variables]
${lines.join('\n')}`;
}

function buildErrorHandlingSection(): string {
    return `[Error Handling]
- If the caller's response is unclear, ask a clarifying question.
- If you encounter any issue, apologize politely and offer to have someone call back.
- If the caller becomes frustrated, empathize and offer to connect them with a team member.`;
}

// ─── AGENT-SPECIFIC BUILDERS ───

async function buildInboundReceptionistPrompt(
    businessName: string,
    profile: TenantProfileData,
    customInstructions?: string
): Promise<AgentPromptResult> {
    const industryContext = buildIndustryContext(profile.industry, profile.sub_industry);
    const afterHoursText = buildAfterHoursText(profile.after_hours_behavior, profile.emergency_phone);
    const qualificationText = buildQualificationText(profile.qualification_criteria);

    const [conversationFlow, firstMessage] = await Promise.all([
        generateAgentConversationFlow(businessName, profile, 'inbound_receptionist',
            'Handle incoming calls: answer questions, qualify needs, and book appointments.',
            customInstructions),
        profile.greeting_style
            ? Promise.resolve(profile.greeting_style.replace('[Business Name]', businessName))
            : generateAgentGreeting(businessName, profile, 'inbound_receptionist', 'inbound'),
    ]);

    const systemPrompt = `[Identity]
You are the virtual receptionist for ${businessName}, a ${industryContext} business.
${profile.business_description ? `About the business: ${profile.business_description}` : ''}

${buildSharedStyleSection(profile)}

${buildSharedContextSection(profile)}

${afterHoursText}

[Response Guidelines]
- Always confirm the caller's name and contact number early.
- If asked about pricing, provide general ranges or offer a detailed quote follow-up.
- Never fabricate information. Offer to have a team member call back if unsure.
- Prioritize emergency/urgent issues.
${qualificationText}
${customInstructions ? `\n[Custom Instructions]\n${customInstructions}` : ''}

[Task]
${conversationFlow}

[Tool Instructions]
- Use "check_availability" to find open slots, then "book_appointment" to confirm.
- When transferring, silently trigger transferCall — do NOT announce it.
- Use endCall when the conversation is naturally complete.

${buildOverrideVariablesSection('inbound_receptionist')}

${buildErrorHandlingSection()}`;

    return { systemPrompt, firstMessage };
}

async function buildOutboundAgentPrompt(
    agentTypeId: string,
    businessName: string,
    profile: TenantProfileData,
    purpose: string,
    roleDescription: string,
    additionalGuidelines: string,
    customInstructions?: string
): Promise<AgentPromptResult> {
    const industryContext = buildIndustryContext(profile.industry, profile.sub_industry);
    const qualificationText = buildQualificationText(profile.qualification_criteria);

    const [conversationFlow, firstMessage] = await Promise.all([
        generateAgentConversationFlow(businessName, profile, agentTypeId, purpose, customInstructions),
        generateAgentGreeting(businessName, profile, agentTypeId, 'outbound'),
    ]);

    const systemPrompt = `[Identity]
You are the ${roleDescription} for ${businessName}, a ${industryContext} business.
${profile.business_description ? `About the business: ${profile.business_description}` : ''}
You are making an outbound call. ${purpose}

${buildSharedStyleSection(profile)}

${buildSharedContextSection(profile)}

[Response Guidelines]
- This is an outbound call. The person may not be expecting it, so be respectful of their time.
- Never be pushy or aggressive. If not interested, thank them and end gracefully.
${additionalGuidelines}
${qualificationText}
${customInstructions ? `\n[Custom Instructions]\n${customInstructions}` : ''}

[Task]
${conversationFlow}

[Conversation Memory]
- {{customer_context}} contains full history of previous interactions. Use it to personalize.
- Reference previous conversations naturally.

[Tool Instructions]
- Use "check_availability" then "book_appointment" to schedule.
- When transferring, trigger transferCall silently.
- Use endCall when the conversation is complete.

[Voicemail Instructions]
If you reach voicemail, leave a brief, friendly message mentioning ${businessName} and the reason for calling. Keep it under 15 seconds.

${buildOverrideVariablesSection(agentTypeId)}

${buildErrorHandlingSection()}`;

    return { systemPrompt, firstMessage };
}

// ─── MAIN DISPATCH ───

export async function buildAgentPrompt(
    agentTypeId: string,
    businessName: string,
    profile: TenantProfileData,
    customInstructions?: string
): Promise<AgentPromptResult> {
    switch (agentTypeId) {
        case 'inbound_receptionist':
            return buildInboundReceptionistPrompt(businessName, profile, customInstructions);

        case 'lead_follow_up':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Follow up with new leads within minutes of their inquiry to qualify needs and book appointments.',
                'lead follow-up specialist',
                `- Reference the lead's specific inquiry and source ({{lead_source}}, {{ad_campaign}}).
- The lead recently submitted a form or inquiry, so provide context about why you're calling.
- Focus on understanding their needs and booking an appointment.`,
                customInstructions
            );

        case 'appointment_reminder':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Confirm upcoming appointments and handle rescheduling requests.',
                'appointment reminder specialist',
                `- Reference the specific appointment: {{appointment_date}} at {{appointment_time}} for {{service_type}}.
- Keep the call brief — this is a confirmation, not a sales call.
- If they need to reschedule, use check_availability and book_appointment.
- If they confirm, thank them and end the call promptly.`,
                customInstructions
            );

        case 'no_show_recovery':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Re-engage customers who missed their scheduled appointment to reschedule.',
                'customer care specialist',
                `- Be understanding and empathetic — do not blame or guilt the customer.
- Reference the missed appointment: {{missed_appointment_date}} for {{service_type}}.
- Ask if something came up and offer to reschedule at their convenience.
- If they're no longer interested, thank them gracefully.`,
                customInstructions
            );

        case 'review_collector':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Check on customer satisfaction after service and ask happy customers to leave a Google review.',
                'customer satisfaction specialist',
                `- First gauge satisfaction before asking for a review.
- Reference the specific service: {{service_type}} completed on {{service_completed_date}}.
- If they express concerns, listen carefully and offer to resolve — do NOT ask for a review.
- If they are happy, gently ask if they'd be willing to leave a Google review.
- Mention the review link will be texted to them.`,
                customInstructions
            );

        case 'win_back_caller':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Re-engage dormant customers who haven\'t visited in a while.',
                'customer relationship specialist',
                `- Reference their last interaction: {{last_service_type}} on {{last_service_date}}.
- Mention seasonal relevance or maintenance schedules if applicable.
- If there's a special offer ({{special_offer}}), present it naturally.
- Focus on reconnecting, not hard-selling.`,
                customInstructions
            );

        case 'lead_qualifier':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Pre-qualify leads from ad sources by assessing needs, timeline, budget, and service area.',
                'lead qualification specialist',
                `- Reference the lead source: {{lead_source}} and campaign: {{ad_campaign}}.
- Ask about their specific needs, timeline, and budget range (if appropriate).
- Determine if they're within the service area.
- If qualified: offer to book an appointment or transfer to a specialist.
- If not qualified: thank them politely and end the call.`,
                customInstructions
            );

        case 'upsell_cross_sell':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Follow up with customers about complementary services based on their recent experience.',
                'service advisor',
                `- Reference their recent service: {{last_service}}.
- Explain the benefit of {{recommended_service}} in relation to what they already had done.
- If there's a special offer ({{offer_details}}), present it naturally.
- Be helpful and advisory, not salesy. Let the customer decide.`,
                customInstructions
            );

        case 'event_promo_announcer':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Inform customers about current promotions, events, or seasonal offers.',
                'promotions specialist',
                `- Lead with the value proposition: {{event_name}} — {{offer_details}}.
- If there's a promo code ({{promo_code}}), mention it clearly and offer to text it.
- Create excitement but don't be overwhelming. Keep it brief.
- Offer to book an appointment at the promotional rate if interested.`,
                customInstructions
            );

        case 'survey_collector':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Conduct a brief post-service satisfaction survey.',
                'customer feedback specialist',
                `- Reference the specific service: {{service_type}} on {{service_date}}.
- Ask 3-5 structured questions: overall satisfaction (1-5), quality, professionalism, would they recommend, anything to improve.
- Keep it conversational, not robotic. Thank them after each answer.
- If they mention issues, acknowledge them and note for follow-up.
- Keep the call under 3 minutes.`,
                customInstructions
            );

        case 'referral_requester':
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                'Ask satisfied customers if they know anyone who might need similar services.',
                'customer relations specialist',
                `- Thank them for their business first.
- Reference their recent service: {{service_type}}.
- Ask casually if they know friends, family, or neighbors who might need similar services.
- If there's a referral incentive ({{referral_incentive}}), mention it.
- Keep it warm, brief, and no-pressure.`,
                customInstructions
            );

        default:
            // For custom agents created via chat, use a generic outbound builder
            return buildOutboundAgentPrompt(
                agentTypeId, businessName, profile,
                customInstructions || 'Assist the customer with their needs.',
                'AI assistant',
                '- Be helpful and professional.',
                customInstructions
            );
    }
}
