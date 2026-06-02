// ═══════════════════════════════════════════════════════════
// SAAS COMPANIES — VAPI STRUCTURED OUTPUT (inline analysisPlan)
//
// Schema + extraction prompt for the SaaS outbound sales agent. Attached
// INLINE via `analysisPlan.structuredDataSchema` on the assistant (no
// umbrella-global resource needed for v1).
//
// Field-typing strategy mirrors RE: every field is a string. VAPI's extractor
// handles enum-via-description reliably; numeric/boolean coercion across LLM
// models is fragile. Downstream code parses as needed.
// ═══════════════════════════════════════════════════════════

const str = (description: string) => ({ type: "string", description });

export const SAAS_STRUCTURED_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        // ─── Contact ────────────────────────────────────────────────
        contact_first_name: str("Lead's first name. Empty string if unknown."),
        contact_last_name: str("Lead's last name. Empty string if unknown."),
        contact_phone: str(
            "Lead's primary phone in E.164 if mentioned, else as spoken."
        ),
        contact_email: str("Lead's email address if provided."),
        contact_role: str(
            "The lead's role/title at their company (e.g. 'Head of Sales', 'Founder', 'SDR Manager')."
        ),
        is_decision_maker: str(
            "Whether the lead can decide on buying. One of: yes, no, partial."
        ),

        // ─── Company / Fit ──────────────────────────────────────────
        company_name: str("The lead's company name if mentioned."),
        company_size: str(
            "Approximate company / team size as spoken (e.g. '10 reps', '50 employees', 'just me')."
        ),
        industry: str("The lead's industry/vertical if mentioned."),
        use_case: str(
            "The primary pain or use case the lead described (1-2 sentences in their words)."
        ),
        current_solution: str(
            "What they use today for this (e.g. 'manual SDRs', 'a competitor', 'nothing')."
        ),
        budget_signal: str(
            "Any signal about budget/willingness to pay. One of: has_budget, no_budget, exploring, not_discussed."
        ),
        decision_timeline: str(
            "How soon they'd decide. One of: now, this_month, this_quarter, no_timeline, just_exploring."
        ),

        // ─── Demo / Outcome ─────────────────────────────────────────
        demo_booked: str("Was a demo booked on this call? One of: yes, no."),
        demo_datetime: str(
            "Demo date and time as ISO 8601 if specific (e.g. '2026-06-10T14:00:00'), else as spoken."
        ),
        demo_type: str("Type of demo agreed. One of: zoom, phone, none."),
        qualification_status: str(
            "Lead temperature. One of: hot, warm, cold, not_qualified, dead."
        ),
        objections_raised: str(
            "Comma-separated objections heard: too_expensive, have_a_solution, not_a_priority, need_to_think, ai_concerns, not_decision_maker, bad_timing, other."
        ),

        // ─── Disposition ────────────────────────────────────────────
        call_disposition: str(
            "Final outcome category. One of: demo_booked, qualified_no_demo, follow_up_needed, not_interested, not_qualified, wrong_number, voicemail, dnc_request, hostile, hangup."
        ),
        contacted_status: str(
            "Outbound call result. One of: reached_decision_maker, reached_other_party, voicemail, no_answer, gatekeeper, wrong_number, disconnected, n/a."
        ),
        next_step: str("Free-text description of the agreed next step (1 sentence)."),
        callback_requested: str("One of: yes, no."),
        callback_datetime: str(
            "Requested callback date/time as ISO 8601 if specific, else as spoken."
        ),
        dnc_requested: str(
            "Did the lead ask to be removed from the calling list / never contacted again? One of: yes, no."
        ),
        transferred_to_human: str("One of: yes, no."),
        transfer_reason: str("If transferred, the reason (1 sentence)."),

        // ─── Summary ────────────────────────────────────────────────
        summary_one_liner: str(
            "One-sentence outcome summary suitable for a CRM activity log (max 200 chars)."
        ),
        key_quotes: str(
            "1-3 short verbatim quotes from the lead that best capture interest or objection (semicolon-separated)."
        ),
        additional_notes: str(
            "Any other meaningful detail that doesn't fit the fields above."
        ),
    },
};

export const SAAS_STRUCTURED_OUTPUT_PROMPT = [
    "Extract every available piece of information from this SaaS sales call into the schema below.",
    "",
    "Rules:",
    "- For any field not discussed or unknown, use an empty string. Do NOT invent or infer values.",
    "- For enum fields, use exactly one of the values listed in the field description (lowercase, snake_case).",
    "- This is an OUTBOUND call: the caller is our AI sales agent and the contact is the lead — extract the lead's information.",
    "- Use ISO 8601 (YYYY-MM-DDTHH:MM) for any specific datetime; otherwise reproduce the spoken phrase.",
    "- demo_booked is 'yes' only if a specific demo time was confirmed on the call.",
    "- summary_one_liner should read like a CRM note: action + outcome + key fact.",
].join("\n");
