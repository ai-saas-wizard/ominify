// ═══════════════════════════════════════════════════════════
// RE INVESTOR — GLOBAL VAPI STRUCTURED OUTPUT
//
// Defines the schema, name, description, and extraction prompt for the
// umbrella-scoped VAPI Structured Output that every UMBRELLA RE assistant
// (inbound + outbound) attaches to via `artifactPlan.structuredOutputIds`.
//
// One resource per VAPI org (one per umbrella). Created via ensure-once
// pattern in umbrella-structured-outputs-actions.ts.
//
// Field-typing strategy: every field is a string. VAPI's extractor handles
// enum-via-description reliably; numeric/boolean coercion across LLM models
// is fragile. Downstream code parses as needed (e.g. sheets row, contact
// extraction).
// ═══════════════════════════════════════════════════════════

export const RE_STRUCTURED_OUTPUT_NAME = "Omnify RE Investor Call Extraction";

export const RE_STRUCTURED_OUTPUT_DESCRIPTION =
    "Comprehensive extraction of every meaningful data point from a real estate investor call: caller details, property identity & condition, occupancy, financials, pricing, motivation, timeline, competing offers, objections, disposition, and appointment outcome. Used by UMBRELLA RE inbound + outbound agents.";

const str = (description: string) => ({ type: "string", description });

export const RE_STRUCTURED_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        // ─── Caller / Contact ───────────────────────────────────────
        caller_first_name: str("Caller's first name. Empty string if unknown."),
        caller_last_name: str("Caller's last name. Empty string if unknown."),
        caller_phone: str(
            "Caller's primary phone number in E.164 if mentioned, else as spoken."
        ),
        callback_phone: str(
            "A separate callback number if the caller asked us to reach them at a different number than the one they called from."
        ),
        caller_email: str("Caller's email address if provided."),
        caller_relationship_to_property: str(
            "Caller's relationship to the property. One of: owner, co_owner, agent, executor, family_member, attorney, friend, none, other."
        ),
        is_decision_maker: str(
            "Whether the caller is the sole decision-maker on selling. One of: yes, no, partial. Use 'partial' if they need a spouse/sibling/partner to agree."
        ),
        additional_decision_makers: str(
            "Names or relationships of others who must agree to the sale (e.g. 'spouse Jane', 'brother', 'co-owner')."
        ),

        // ─── Property Identity ──────────────────────────────────────
        property_address: str(
            "Full property address as spoken (street + city + state + zip when available)."
        ),
        property_street: str("Property street address only (no city/state/zip)."),
        property_city: str("Property city."),
        property_state: str("Property state (2-letter code if possible, e.g. FL)."),
        property_zip: str("Property zip/postal code."),
        property_type: str(
            "Property type. One of: single_family, multi_family, townhouse, condo, mobile_home, manufactured_home, duplex, triplex, fourplex, land, commercial, mixed_use, other."
        ),

        // ─── Property Characteristics ───────────────────────────────
        bedrooms: str("Number of bedrooms (e.g. '3')."),
        bathrooms: str("Number of bathrooms, full + half if mentioned (e.g. '2.5')."),
        square_footage: str("Approximate interior square footage as a number string."),
        year_built: str("Year the property was built, if mentioned."),
        lot_size: str("Lot size as spoken (e.g. '0.25 acres', '7500 sqft')."),
        garage: str("Garage details. One of: none, 1_car, 2_car, 3_car_plus, carport, unknown."),
        pool: str("Pool present. One of: yes, no, unknown."),
        additional_features: str(
            "Other notable features mentioned: fireplace, basement, attic, central air, septic vs sewer, well vs city water, fenced yard, etc."
        ),

        // ─── Property Condition ─────────────────────────────────────
        condition: str(
            "Overall condition. One of: poor, fair, good, excellent, move_in_ready, uninhabitable, unknown."
        ),
        needed_repairs: str(
            "Comma-separated list of repairs/issues mentioned: roof, hvac, foundation, plumbing, electrical, kitchen, bathroom, paint, flooring, windows, mold, fire_damage, water_damage, termite, structural, cosmetic_only."
        ),
        repair_estimate_mentioned: str(
            "Dollar estimate of repairs if the seller mentioned a number (e.g. '20000')."
        ),
        last_renovation: str(
            "When major work was last done (e.g. 'kitchen remodeled 2018', 'never', 'roof replaced 2 years ago')."
        ),

        // ─── Occupancy & Tenants ────────────────────────────────────
        occupancy: str(
            "Current occupancy. One of: owner_occupied, tenant_occupied, vacant, family_member_occupied, squatter, unknown."
        ),
        tenant_paying: str(
            "If tenant-occupied, are they paying rent? One of: yes, no, partial, unknown, n/a."
        ),
        monthly_rent: str("Current monthly rent if mentioned."),
        lease_end_date: str("Lease end date if mentioned, ISO format YYYY-MM-DD when possible."),
        eviction_status: str(
            "Eviction situation. One of: none, considering, in_progress, completed, n/a."
        ),

        // ─── Financial ──────────────────────────────────────────────
        mortgage_balance: str("Approximate remaining mortgage balance if mentioned."),
        mortgage_status: str(
            "Mortgage payment status. One of: paid_off, current, behind, in_forbearance, in_foreclosure, unknown."
        ),
        months_behind: str("If behind, how many months (e.g. '3')."),
        monthly_payment: str("Current monthly mortgage payment if mentioned."),
        has_second_mortgage: str("One of: yes, no, unknown."),
        liens: str(
            "Liens on the property. Comma-separated from: tax, mechanics, judgment, hoa, irs, other, none."
        ),
        back_taxes_amount: str("Amount of back property taxes owed if mentioned."),
        hoa_status: str("One of: yes, no, unknown."),
        hoa_dues: str("Monthly or annual HOA dues if mentioned."),
        utility_status: str(
            "Are utilities on at the property? One of: all_on, partial, all_off, unknown."
        ),

        // ─── Pricing ────────────────────────────────────────────────
        asking_price: str("Seller's asking price or expectation, if any number was mentioned."),
        price_flexibility: str(
            "How flexible the seller is on price. One of: firm, somewhat_flexible, very_flexible, no_number_given."
        ),
        lowest_acceptable_price: str(
            "Lowest the seller said they would accept, if mentioned."
        ),
        price_basis: str(
            "What the asking price is based on. One of: zillow, redfin, appraisal, what_owed, intuition, comps, agent_advice, none_given."
        ),

        // ─── Motivation & Timeline ──────────────────────────────────
        seller_situation: str(
            "Primary motivation. One of: tired_landlord, divorce, inherited_probate, foreclosure, bankruptcy, financial_distress, fire, flood, vacant_burden, relocation, downsizing, upsizing, tax_delinquent, code_violation, health, retirement, job_loss, just_curious, other."
        ),
        reason_for_selling: str(
            "Free-text reason in the seller's own words (1-2 sentences)."
        ),
        timeline_to_sell: str(
            "How quickly the seller needs to close. One of: asap, 30_days, 60_days, 90_days, 6_months, no_rush, just_exploring."
        ),
        urgency_level: str("Subjective urgency. One of: high, medium, low."),
        previously_listed: str("One of: yes, no, unknown."),
        listing_status: str(
            "Current listing status. One of: currently_listed_with_realtor, listed_fsbo, expired_listing, withdrawn, never_listed, unknown."
        ),

        // ─── Competing Offers ───────────────────────────────────────
        has_received_offers: str("One of: yes, no, unknown."),
        highest_offer: str("Highest offer the seller has received so far, if mentioned."),
        willing_to_consider_creative_finance: str(
            "Whether the seller is open to creative finance (subject-to, seller finance, lease option). One of: yes, no, unsure, not_discussed."
        ),

        // ─── Disposition / Outcome ──────────────────────────────────
        call_disposition: str(
            "Final outcome category. One of: qualified_appointment, qualified_no_appointment, follow_up_needed, not_interested, not_qualified, wrong_number, voicemail, mailing_removal, vendor_solicitation, job_inquiry, hostile, language_barrier, dnc_request, hangup."
        ),
        qualification_status: str(
            "Lead temperature. One of: hot, warm, cold, not_qualified, dead."
        ),
        objections_raised: str(
            "Comma-separated objections heard: price_too_low, want_retail, need_to_think, talk_to_spouse, just_listed, bad_timing, dont_trust_investors, fees, other."
        ),
        next_step: str("Free-text description of the agreed next step (1 sentence)."),
        callback_requested: str("One of: yes, no."),
        callback_datetime: str(
            "Requested callback date and time as ISO 8601 if specific (e.g. '2026-05-10T14:00:00'), else as spoken."
        ),
        dnc_requested: str(
            "Did the caller ask to be removed from the calling list / never contacted again? One of: yes, no."
        ),
        transferred_to_human: str("One of: yes, no."),
        transfer_reason: str("If transferred, the reason (e.g. 'qualified seller wants offer now')."),
        follow_up_required: str("One of: yes, no."),

        // ─── Appointment ────────────────────────────────────────────
        appointment_booked: str("One of: yes, no."),
        appointment_type: str(
            "Type of appointment. One of: in_person_offer, phone_consult, video_consult, walkthrough, none."
        ),
        appointment_datetime: str(
            "Appointment date and time as ISO 8601 if specific, else as spoken."
        ),
        appointment_address: str(
            "Address for the appointment if different from the property address."
        ),
        appointment_attendees: str(
            "Who will attend the appointment besides the seller (e.g. 'spouse', 'attorney', 'just the seller')."
        ),

        // ─── Outbound-Specific ──────────────────────────────────────
        contacted_status: str(
            "Outbound call result. One of: reached_decision_maker, reached_other_party, voicemail, no_answer, gatekeeper, wrong_number, disconnected, n/a."
        ),
        prior_context_acknowledged: str(
            "Did the contact recall the original inquiry / prior interaction? One of: yes, no, unsure, n/a."
        ),
        ready_to_proceed: str(
            "Are they ready to move forward today? One of: yes, no, needs_more_info, n/a."
        ),

        // ─── Summary ────────────────────────────────────────────────
        summary_one_liner: str(
            "One-sentence outcome summary suitable for a CRM activity log (max 200 chars)."
        ),
        key_quotes: str(
            "1-3 short verbatim quotes from the seller that best capture motivation or condition (semicolon-separated)."
        ),
        red_flags: str(
            "Anything suspicious: realtor posing as owner, fraud signals, inconsistent story, hostile tone, etc. Empty if none."
        ),
        additional_notes: str(
            "Any other meaningful detail that doesn't fit the fields above."
        ),
    },
};

export const RE_STRUCTURED_OUTPUT_PROMPT = [
    "Extract every available piece of information from this real estate investor call into the schema below.",
    "",
    "Rules:",
    "- For any field not discussed or unknown, use an empty string. Do NOT invent or infer values.",
    "- For enum fields, use exactly one of the values listed in the field description (lowercase, snake_case).",
    "- Parse the property address into street/city/state/zip components when possible.",
    "- Use ISO 8601 (YYYY-MM-DDTHH:MM) for any specific datetime; otherwise reproduce the spoken phrase.",
    "- Numeric fields stay as plain digit strings, no currency symbols, commas, or units (e.g. '250000' not '$250,000').",
    "- The caller is typically a potential home seller. On outbound calls, the caller is our agent and the contact is the seller — extract the seller's information regardless of who initiated.",
    "- summary_one_liner should read like a CRM note: action + outcome + key fact.",
].join("\n");
