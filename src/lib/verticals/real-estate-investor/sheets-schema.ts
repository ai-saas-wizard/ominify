// ═══════════════════════════════════════════════════════════
// RE INVESTOR — SHEET CONFIG
//
// Sheet column layout + row builder for the auto-created Google Sheet.
//
// The structured-data schema itself now lives in `structured-output.ts`.
// We re-export it here under the legacy names because the CUSTOM-account
// fallback path still inlines it via `analysisPlan.structuredDataSchema`
// (UMBRELLA accounts attach the global structured output by ID instead).
// ═══════════════════════════════════════════════════════════

export {
    RE_STRUCTURED_OUTPUT_SCHEMA as RE_STRUCTURED_DATA_SCHEMA,
    RE_STRUCTURED_OUTPUT_PROMPT as RE_STRUCTURED_DATA_PROMPT,
} from "./structured-output";

/**
 * Column headers for the auto-created Google Sheet. Order matches
 * `buildSheetRow` exactly. The first 21 columns are preserved from the
 * pre-expansion layout so existing sheets continue to receive rows in the
 * same positions; the rest are appended to the right.
 */
export const RE_SHEET_HEADERS = [
    // ─ Original 21 columns (preserved order for backwards compat with
    //   existing sheets that already have these headers) ─
    "Date",
    "Caller Name",
    "Phone",
    "Email",
    "Property Address",
    "Type",
    "Beds",
    "Baths",
    "SqFt",
    "Condition",
    "Repairs",
    "Occupancy",
    "Situation",
    "Mortgage",
    "Asking Price",
    "Appointment",
    "Appt Date",
    "Disposition",
    "Notes",
    "Duration",
    "Recording",
    // ─ Expanded columns from the global structured output ─
    "City",
    "State",
    "Zip",
    "Year Built",
    "Mortgage Status",
    "Months Behind",
    "Timeline",
    "Urgency",
    "Qualification",
    "Objections",
    "Callback?",
    "Callback Date",
    "DNC?",
    "Summary",
    "Red Flags",
];

/**
 * Maps VAPI structured data + call metadata into a row array
 * matching `RE_SHEET_HEADERS` order. The webhook normalizer
 * (`extractStructuredData`) already backfills `caller_name` from
 * `caller_first_name + caller_last_name`, so legacy sheets keep working
 * even after assistants migrate to the new global structured output.
 */
export function buildSheetRow(
    structuredData: Record<string, any>,
    callMeta: {
        date: string;
        durationFormatted: string;
        recordingUrl: string | null;
        callerPhone: string | null;
    }
): string[] {
    return [
        // Original 21
        callMeta.date,
        structuredData.caller_name || "",
        structuredData.caller_phone || callMeta.callerPhone || "",
        structuredData.caller_email || "",
        structuredData.property_address || "",
        structuredData.property_type || "",
        structuredData.bedrooms || "",
        structuredData.bathrooms || "",
        structuredData.square_footage || "",
        structuredData.condition || "",
        structuredData.needed_repairs || structuredData.major_repairs || "",
        structuredData.occupancy || "",
        structuredData.seller_situation || "",
        structuredData.mortgage_balance || structuredData.mortgage_status || "",
        structuredData.asking_price || "",
        structuredData.appointment_booked || "",
        structuredData.appointment_datetime || structuredData.appointment_date || "",
        structuredData.call_disposition || "",
        structuredData.additional_notes || structuredData.notes || "",
        callMeta.durationFormatted,
        callMeta.recordingUrl || "",
        // Expanded
        structuredData.property_city || "",
        structuredData.property_state || "",
        structuredData.property_zip || "",
        structuredData.year_built || "",
        structuredData.mortgage_status || "",
        structuredData.months_behind || "",
        structuredData.timeline_to_sell || "",
        structuredData.urgency_level || "",
        structuredData.qualification_status || "",
        structuredData.objections_raised || "",
        structuredData.callback_requested || "",
        structuredData.callback_datetime || "",
        structuredData.dnc_requested || "",
        structuredData.summary_one_liner || "",
        structuredData.red_flags || "",
    ];
}
