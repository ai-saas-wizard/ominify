"use server";

import { supabase } from "@/lib/supabase";
import OpenAI from "openai";
import { getAgentTypeDefinition, type SequenceStepTemplate } from "@/lib/agent-catalog";
import type { TenantProfileData } from "@/lib/prompt-templates";

// ═══════════════════════════════════════════════════════════
// AUTO-SEQUENCE CREATION
// Generates sequence + steps with AI-written content for
// each agent type during deployment.
// ═══════════════════════════════════════════════════════════

async function generateStepContent(
    businessName: string,
    profile: TenantProfileData,
    stepTemplate: SequenceStepTemplate,
    vapiAssistantId?: string
): Promise<Record<string, unknown>> {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 15000,
    });

    if (stepTemplate.channel === "voice" && vapiAssistantId) {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 200,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Generate a greeting for an outbound voice call. Output JSON: {"first_message": "..."}

Business: ${businessName}
Industry: ${profile.industry}
Brand Voice: ${profile.brand_voice}
Step Purpose: ${stepTemplate.content_purpose}

Rules: Under 20 words, natural, reference the purpose, use {{customer_name}} if referring by name.`,
                },
                { role: "user", content: "Generate the first message." },
            ],
        });

        const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
        return {
            first_message: parsed.first_message || `Hi, this is the team at ${businessName} calling.`,
            system_prompt: "",
            vapi_assistant_id: vapiAssistantId,
        };
    }

    if (stepTemplate.channel === "sms") {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 300,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Generate an SMS message for a business outreach step. Output JSON: {"body": "..."}

Business: ${businessName}
Industry: ${profile.industry}
Brand Voice: ${profile.brand_voice}
Step Purpose: ${stepTemplate.content_purpose}

Rules: Under 160 characters, use {{customer_name}} for personalization, clear CTA, match brand voice, sound human.`,
                },
                { role: "user", content: "Generate the SMS body." },
            ],
        });

        const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
        return { body: parsed.body || "" };
    }

    if (stepTemplate.channel === "email") {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 800,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Generate an email for a business outreach step. Output JSON: {"subject": "...", "body_html": "...", "body_text": "..."}

Business: ${businessName}
Industry: ${profile.industry}
Brand Voice: ${profile.brand_voice}
Step Purpose: ${stepTemplate.content_purpose}

Rules: Subject under 60 chars, simple HTML with <p> tags, use {{customer_name}}, include business name, 3-4 short paragraphs max.`,
                },
                { role: "user", content: "Generate the email content." },
            ],
        });

        const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
        return {
            subject: parsed.subject || "",
            body_html: parsed.body_html || "",
            body_text: parsed.body_text || "",
        };
    }

    // Voice without pre-created assistant
    if (stepTemplate.channel === "voice") {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: 1000,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Generate a voice agent config for an outbound call. Output JSON: {"first_message": "...", "system_prompt": "..."}

Business: ${businessName}
Industry: ${profile.industry}
Brand Voice: ${profile.brand_voice}
Step Purpose: ${stepTemplate.content_purpose}

first_message: Under 20 words, natural, use {{customer_name}}.
system_prompt: Structured with [Identity], [Style], [Task], [Error Handling], under 500 words.`,
                },
                { role: "user", content: "Generate the voice agent configuration." },
            ],
        });

        const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
        return {
            first_message: parsed.first_message || `Hi, this is the team at ${businessName}.`,
            system_prompt: parsed.system_prompt || "",
        };
    }

    return {};
}

export async function createAgentSequence(
    clientId: string,
    agentId: string,
    vapiAssistantId: string,
    agentTypeId: string,
    businessName: string,
    profile: TenantProfileData
): Promise<{ success: boolean; sequenceId?: string; error?: string }> {
    const agentDef = getAgentTypeDefinition(agentTypeId);
    if (!agentDef || !agentDef.sequence_template) {
        return { success: true }; // No sequence needed
    }

    const template = agentDef.sequence_template;
    const sequenceName = template.name_template.replace("{{business_name}}", businessName);

    // 1. Create the sequence
    const { data: sequence, error: seqError } = await supabase
        .from("sequences")
        .insert({
            client_id: clientId,
            agent_id: agentId,
            name: sequenceName,
            description: template.description_template,
            trigger_type: template.trigger_type,
            urgency_tier: template.urgency_tier,
            respect_business_hours: template.respect_business_hours,
            ai_generated: true,
            auto_created: true,
            is_active: true,
        })
        .select("id")
        .single();

    if (seqError || !sequence) {
        console.error("[AUTO-SEQUENCE] Error creating sequence:", seqError);
        return { success: false, error: seqError?.message || "Failed to create sequence" };
    }

    // 2. Generate content and create steps in parallel
    const stepPromises = template.steps.map(async (stepTemplate) => {
        try {
            const contentTemplate = await generateStepContent(
                businessName,
                profile,
                stepTemplate,
                stepTemplate.channel === "voice" ? vapiAssistantId : undefined
            );

            return supabase.from("sequence_steps").insert({
                sequence_id: sequence.id,
                step_order: stepTemplate.step_order,
                channel: stepTemplate.channel,
                delay_minutes: stepTemplate.delay_minutes,
                delay_type: stepTemplate.delay_type,
                content: contentTemplate,
                enable_ai_mutation: stepTemplate.enable_ai_mutation,
                skip_conditions: stepTemplate.skip_conditions,
                on_success: stepTemplate.on_success,
                on_failure: stepTemplate.on_failure,
                is_active: true,
            });
        } catch (err) {
            console.error(`[AUTO-SEQUENCE] Error creating step ${stepTemplate.step_order}:`, err);
            return null;
        }
    });

    await Promise.allSettled(stepPromises);

    console.log(
        `[AUTO-SEQUENCE] Created "${sequenceName}" with ${template.steps.length} steps for ${agentTypeId}`
    );

    return { success: true, sequenceId: sequence.id };
}
