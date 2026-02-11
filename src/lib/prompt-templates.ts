import OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════
// VAPI PROMPT TEMPLATES
// Hybrid approach: static scaffold + LLM-generated sections
// ═══════════════════════════════════════════════════════════

// ─── TYPES ───

export interface TenantProfileData {
    industry: string;
    sub_industry: string;
    business_description: string;
    website: string;
    service_area: { cities: string[]; zip_codes: string[]; radius_miles: number } | null;
    job_types: Array<{ name: string; urgency_tier: string; avg_ticket: string; keywords: string }> | null;
    brand_voice: string;
    custom_phrases: { always_mention: string[]; never_say: string[] } | null;
    greeting_style: string;
    timezone: string;
    business_hours: Record<string, { open: string; close: string; closed: boolean }> | null;
    after_hours_behavior: string;
    emergency_phone: string;
    lead_sources: string[] | null;
    primary_goal: string;
    qualification_criteria: { must_have: string[]; nice_to_have: string[]; disqualifiers: string[] } | null;
}

interface PromptResult {
    systemPrompt: string;
    firstMessage: string;
}

// ─── HELPER FUNCTIONS ───

function buildIndustryContext(industry: string, subIndustry: string): string {
    const industryLabels: Record<string, string> = {
        home_services: 'home services',
        real_estate: 'real estate',
        healthcare: 'healthcare',
        legal: 'legal services',
        automotive: 'automotive',
        restaurant: 'restaurant and food service',
        retail: 'retail',
        professional_services: 'professional services',
    };

    const label = industryLabels[industry] || industry || 'service';
    if (subIndustry) {
        return `${subIndustry} (${label})`;
    }
    return label;
}

function buildServicesText(jobTypes: TenantProfileData['job_types']): string {
    if (!jobTypes || jobTypes.length === 0) return 'General services';

    return jobTypes
        .map((jt) => {
            let text = jt.name;
            if (jt.urgency_tier && jt.urgency_tier !== 'medium') {
                text += ` (${jt.urgency_tier} priority)`;
            }
            return text;
        })
        .join(', ');
}

function buildServiceAreaText(serviceArea: TenantProfileData['service_area']): string {
    if (!serviceArea) return 'Local area';

    const parts: string[] = [];
    if (serviceArea.cities && serviceArea.cities.length > 0) {
        parts.push(serviceArea.cities.join(', '));
    }
    if (serviceArea.radius_miles) {
        parts.push(`within ${serviceArea.radius_miles} miles`);
    }
    return parts.length > 0 ? parts.join(' — ') : 'Local area';
}

function buildBusinessHoursText(
    hours: TenantProfileData['business_hours'],
    timezone: string
): string {
    if (!hours) return 'Standard business hours';

    const dayNames: Record<string, string> = {
        mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
        thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
    };

    const lines: string[] = [];
    for (const [key, label] of Object.entries(dayNames)) {
        const day = hours[key];
        if (!day) continue;
        if (day.closed) {
            lines.push(`${label}: Closed`);
        } else {
            lines.push(`${label}: ${formatTime(day.open)} - ${formatTime(day.close)}`);
        }
    }

    const tz = timezone || 'local time';
    return lines.join('\n') + `\nTimezone: ${tz}`;
}

function formatTime(time24: string): string {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${hour12} ${period}` : `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

function buildBrandVoiceDirective(brandVoice: string): string {
    const directives: Record<string, string> = {
        professional: `- Maintain a polished, business-like tone.
- Use proper grammar and clear language.
- Be courteous and respectful at all times.`,
        friendly: `- Be warm, approachable, and conversational.
- Use a genuine, caring tone as if speaking to a neighbor.
- Show empathy and understanding.`,
        casual: `- Keep it relaxed and conversational.
- Use everyday language, feel free to be informal.
- Be approachable and easy-going.`,
        authoritative: `- Project confidence and expertise.
- Speak with authority on industry matters.
- Be decisive and informative.`,
    };
    return directives[brandVoice] || directives.professional;
}

function buildCustomPhrasesRules(customPhrases: TenantProfileData['custom_phrases']): string {
    if (!customPhrases) return '';

    const lines: string[] = [];
    if (customPhrases.always_mention && customPhrases.always_mention.length > 0) {
        lines.push(`- Always try to mention: ${customPhrases.always_mention.join(', ')}`);
    }
    if (customPhrases.never_say && customPhrases.never_say.length > 0) {
        lines.push(`- Never say: ${customPhrases.never_say.join(', ')}`);
    }
    return lines.join('\n');
}

function buildQualificationText(criteria: TenantProfileData['qualification_criteria']): string {
    if (!criteria) return '';

    const lines: string[] = ['[Qualification Criteria]'];
    if (criteria.must_have && criteria.must_have.length > 0) {
        lines.push(`Must-have requirements: ${criteria.must_have.join(', ')}`);
    }
    if (criteria.nice_to_have && criteria.nice_to_have.length > 0) {
        lines.push(`Nice-to-have: ${criteria.nice_to_have.join(', ')}`);
    }
    if (criteria.disqualifiers && criteria.disqualifiers.length > 0) {
        lines.push(`Disqualifiers (politely decline if these apply): ${criteria.disqualifiers.join(', ')}`);
    }
    return lines.join('\n');
}

function buildPrimaryGoalTask(goal: string): string {
    const tasks: Record<string, string> = {
        book_appointment: `Your primary goal is to book an appointment.
1. Understand what service the caller needs.
2. Use the "check_availability" tool to find available time slots.
3. Present two to three options to the caller using natural speech.
<wait for user response>
4. Once they choose a slot, confirm their name and phone number.
5. Use the "book_appointment" tool to finalize the booking.
6. Confirm the appointment details and thank them.`,

        phone_qualification: `Your primary goal is to qualify the caller as a lead.
1. Understand their specific needs and situation.
2. Ask about their timeline and urgency.
3. Ask about their budget range if appropriate for the service.
<wait for user response>
4. Determine if they are within the service area.
5. If qualified, offer to schedule a consultation or have a specialist call them back.
6. Collect their preferred contact method and best time to reach them.`,

        direct_schedule: `Your primary goal is to schedule a service visit directly.
1. Understand what service is needed.
2. Get the service address and confirm it is within the service area.
3. Use the "check_availability" tool to find open slots.
<wait for user response>
4. Book the selected time using the "book_appointment" tool.
5. Confirm all details: service type, address, date, time, and contact info.`,

        collect_info: `Your primary goal is to collect the caller's information for a follow-up.
1. Understand their needs and reason for calling.
2. Collect their full name, phone number, and email if possible.
<wait for user response>
3. Ask about their preferred time for a callback.
4. Summarize what you have collected and let them know someone will follow up.`,

        transfer_to_agent: `Your primary goal is to gather basic information and transfer to a live agent.
1. Get the caller's name and briefly understand their needs.
<wait for user response>
2. Let them know you will connect them with a team member.
3. Silently trigger the transferCall tool — do NOT announce the transfer verbally.`,
    };
    return tasks[goal] || tasks.collect_info;
}

function buildAfterHoursText(behavior: string, emergencyPhone: string): string {
    const behaviors: Record<string, string> = {
        voicemail: 'After hours: Take a message and let the caller know someone will return their call during business hours.',
        emergency_forward: `After hours: For emergencies, offer to forward to the emergency line at ${emergencyPhone || 'the on-call number'}. For non-urgent matters, take a message.`,
        schedule_callback: 'After hours: Offer to schedule a callback during the next available business hours slot.',
        ai_handle: 'After hours: Continue to assist the caller normally. You can book appointments and answer questions at any time.',
    };
    return behaviors[behavior] || behaviors.voicemail;
}

// ─── LLM-GENERATED SECTIONS ───

async function generateConversationFlow(
    businessName: string,
    profile: TenantProfileData,
    agentType: 'inbound' | 'outbound'
): Promise<string> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 15000,
        });

        const context = `
Business: ${businessName}
Industry: ${buildIndustryContext(profile.industry, profile.sub_industry)}
Services: ${buildServicesText(profile.job_types)}
Primary Goal: ${profile.primary_goal}
Brand Voice: ${profile.brand_voice}
Agent Type: ${agentType}
${profile.qualification_criteria ? `Qualification Criteria: ${JSON.stringify(profile.qualification_criteria)}` : ''}
`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 800,
            temperature: 0.7,
            messages: [
                {
                    role: 'system',
                    content: `You write conversation flow scripts for voice AI phone agents. Output ONLY the conversation flow steps — no headers, no explanations.

Rules:
- Use numbered steps with conditional branching (if/else)
- Include <wait for user response> markers after questions
- Keep steps concise — this is for a voice call, not a text chat
- Use markdown-style formatting
- The flow should feel natural, not robotic
- Include 5-8 steps maximum
- Reference tools by name: "check_availability", "book_appointment", "endCall", "transferCall"
- For transfers, say: "Silently trigger the transferCall tool — do NOT say anything before triggering it."
- End with a closing step that triggers endCall`,
                },
                {
                    role: 'user',
                    content: `Write a ${agentType} conversation flow for this business:\n${context}`,
                },
            ],
        });

        return response.choices[0]?.message?.content || buildPrimaryGoalTask(profile.primary_goal);
    } catch (error) {
        console.error('[PROMPT TEMPLATES] Failed to generate conversation flow:', error);
        return buildPrimaryGoalTask(profile.primary_goal);
    }
}

async function generateGreeting(
    businessName: string,
    profile: TenantProfileData,
    agentType: 'inbound' | 'outbound'
): Promise<string> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 10000,
        });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 100,
            temperature: 0.7,
            messages: [
                {
                    role: 'system',
                    content: `You write short, natural greeting messages for voice AI phone agents. Output ONLY the greeting — one or two sentences max. No quotes, no explanations.

Voice style: ${profile.brand_voice || 'professional'}
Rules:
- Keep it under 20 words
- Sound natural and human
- For inbound: thank them for calling and ask how you can help
- For outbound: introduce yourself and ask if they have a moment
- Spell out any numbers as words`,
                },
                {
                    role: 'user',
                    content: `Write a ${agentType} greeting for "${businessName}" (${buildIndustryContext(profile.industry, profile.sub_industry)}).`,
                },
            ],
        });

        const greeting = response.choices[0]?.message?.content;
        if (greeting) return greeting.replace(/^["']|["']$/g, ''); // Strip quotes if LLM added them

        // Fallback
        return agentType === 'inbound'
            ? `Thanks for calling ${businessName}! How can I help you today?`
            : `Hi! This is the team at ${businessName} calling. Do you have a quick moment?`;
    } catch (error) {
        console.error('[PROMPT TEMPLATES] Failed to generate greeting:', error);
        return agentType === 'inbound'
            ? `Thanks for calling ${businessName}! How can I help you today?`
            : `Hi! This is the team at ${businessName} calling. Do you have a quick moment?`;
    }
}

// ─── MAIN TEMPLATE BUILDERS ───

export async function buildInboundPrompt(
    businessName: string,
    profile: TenantProfileData
): Promise<PromptResult> {
    const industryContext = buildIndustryContext(profile.industry, profile.sub_industry);
    const servicesText = buildServicesText(profile.job_types);
    const serviceAreaText = buildServiceAreaText(profile.service_area);
    const hoursText = buildBusinessHoursText(profile.business_hours, profile.timezone);
    const brandDirective = buildBrandVoiceDirective(profile.brand_voice);
    const phrasesRules = buildCustomPhrasesRules(profile.custom_phrases);
    const qualificationText = buildQualificationText(profile.qualification_criteria);
    const afterHoursText = buildAfterHoursText(profile.after_hours_behavior, profile.emergency_phone);

    // Generate LLM sections in parallel
    const [conversationFlow, firstMessage] = await Promise.all([
        generateConversationFlow(businessName, profile, 'inbound'),
        profile.greeting_style
            ? Promise.resolve(profile.greeting_style.replace('[Business Name]', businessName))
            : generateGreeting(businessName, profile, 'inbound'),
    ]);

    const systemPrompt = `[Identity]
You are the virtual receptionist for ${businessName}, a ${industryContext} business.
${profile.business_description ? `About the business: ${profile.business_description}` : ''}

[Style]
${brandDirective}
- Be concise — this is a voice conversation, not a text chat.
- Ask only one question at a time.
- Speak dates using words (e.g., "January fifteenth") not numbers.
- Speak phone numbers digit by digit with pauses.
- Speak prices naturally (e.g., "two hundred fifty dollars").
- Never say the word "function" or "tool" or mention tool names to the caller.
${phrasesRules}

[Context]
Services offered: ${servicesText}
Service area: ${serviceAreaText}

Business hours:
${hoursText}

${afterHoursText}

[Response Guidelines]
- Always confirm the caller's name and contact number early in the conversation.
- If the caller asks about pricing, provide general ranges if available or offer to have someone follow up with a detailed quote.
- Never fabricate information. If you do not know something, say so and offer to have a team member call back.
- If the caller mentions an emergency or urgent issue, prioritize accordingly.
${qualificationText}

[Task]
${conversationFlow}

[Tool Instructions]
- If the caller wants to book an appointment, use the "check_availability" tool to find open slots, then use "book_appointment" to confirm.
- When transferring the call, do NOT say anything — silently trigger the transferCall tool.
- When the conversation is naturally complete, use the endCall tool.

[Dynamic Variables]
- {{customer_context}} contains information about returning callers. Use it to personalize the conversation.
- {{customer_name}} is the caller's name if known.

[Error Handling]
- If the caller's response is unclear, ask a clarifying question.
- If you encounter any issue, apologize politely and offer to have someone call them back.
- If the caller becomes frustrated, empathize and offer to connect them with a team member.`;

    return { systemPrompt, firstMessage };
}

export async function buildOutboundPrompt(
    businessName: string,
    profile: TenantProfileData
): Promise<PromptResult> {
    const industryContext = buildIndustryContext(profile.industry, profile.sub_industry);
    const servicesText = buildServicesText(profile.job_types);
    const serviceAreaText = buildServiceAreaText(profile.service_area);
    const hoursText = buildBusinessHoursText(profile.business_hours, profile.timezone);
    const brandDirective = buildBrandVoiceDirective(profile.brand_voice);
    const phrasesRules = buildCustomPhrasesRules(profile.custom_phrases);
    const qualificationText = buildQualificationText(profile.qualification_criteria);

    const [conversationFlow, firstMessage] = await Promise.all([
        generateConversationFlow(businessName, profile, 'outbound'),
        generateGreeting(businessName, profile, 'outbound'),
    ]);

    const systemPrompt = `[Identity]
You are a follow-up specialist for ${businessName}, a ${industryContext} business.
${profile.business_description ? `About the business: ${profile.business_description}` : ''}
You are making an outbound call to follow up on a recent inquiry or lead.

[Style]
${brandDirective}
- Be concise and respectful of the person's time.
- Ask only one question at a time.
- Speak dates, numbers, and prices naturally using words.
- Be warm but purposeful — you are calling for a reason.
- Never say the word "function" or "tool" or mention tool names to the caller.
${phrasesRules}

[Context]
Services offered: ${servicesText}
Service area: ${serviceAreaText}

Business hours:
${hoursText}

[Response Guidelines]
- This is an outbound follow-up call. The person may not remember their inquiry, so provide context.
- Never be pushy or aggressive. If the person is not interested, thank them and end the call gracefully.
- Focus on understanding their needs and whether ${businessName} can help.
- Confirm their contact information for records.
${qualificationText}

[Task]
${conversationFlow}

[Conversation Memory]
- {{customer_context}} contains the full history of previous interactions. Use it to personalize.
- Reference previous conversations naturally — "I see you reached out about..."

[Tool Instructions]
- If the person wants to schedule, use "check_availability" then "book_appointment".
- When transferring, trigger the transferCall tool silently without announcing it.
- Use endCall when the conversation is complete.

[Voicemail Instructions]
If you reach voicemail, leave a brief, friendly message:
"Hi, this is the team at ${businessName} following up on your recent inquiry. We'd love to help you with your ${profile.sub_industry || 'project'}. Please give us a call back at your convenience. Thank you!"

[Error Handling]
- If the person seems confused about why you are calling, explain clearly and offer to call back at a better time.
- If you encounter any issue, apologize and offer to have a team member follow up.`;

    return { systemPrompt, firstMessage };
}
