// ═══════════════════════════════════════════════════════════
// RE INVESTOR — STRUCTURED DATA SCHEMA & SHEET CONFIG
// Defines what VAPI extracts from calls and how it maps
// to Google Sheets columns.
// ═══════════════════════════════════════════════════════════

/**
 * JSON Schema for VAPI's analysisPlan.structuredDataSchema.
 * VAPI uses this to extract structured data from the call transcript
 * after every call ends. No separate AI agent needed.
 */
export const RE_STRUCTURED_DATA_SCHEMA = {
    type: "object",
    properties: {
        caller_name: {
            type: "string",
            description: "Full name of the caller",
        },
        caller_phone: {
            type: "string",
            description: "Caller's phone number",
        },
        caller_email: {
            type: "string",
            description: "Caller's email if provided",
        },
        property_address: {
            type: "string",
            description:
                "Full property address including street, city, state, and zip code",
        },
        property_type: {
            type: "string",
            description:
                "Single family, townhouse, condo, mobile home, duplex, etc.",
        },
        bedrooms: {
            type: "string",
            description: "Number of bedrooms",
        },
        bathrooms: {
            type: "string",
            description: "Number of bathrooms",
        },
        square_footage: {
            type: "string",
            description: "Approximate square footage",
        },
        condition: {
            type: "string",
            description:
                "Property condition: poor, fair, good, excellent, or move-in ready",
        },
        major_repairs: {
            type: "string",
            description:
                "Major repairs needed if mentioned (roof, HVAC, foundation, etc.)",
        },
        occupancy: {
            type: "string",
            description: "Owner-occupied, tenant-occupied, or vacant",
        },
        seller_situation: {
            type: "string",
            description:
                "Primary motivation: tired landlord, divorce, inherited, foreclosure, bankruptcy, financial distress, fire/flood, vacant, relocation, listed with realtor, downsizing, upsizing, tax delinquent, or other",
        },
        mortgage_status: {
            type: "string",
            description:
                "Mortgage amount owed, paid off, or unknown",
        },
        asking_price: {
            type: "string",
            description:
                "Seller's asking price or price expectation if mentioned",
        },
        appointment_booked: {
            type: "string",
            description: "Yes or No",
        },
        appointment_date: {
            type: "string",
            description: "Appointment date and time if booked",
        },
        call_disposition: {
            type: "string",
            description:
                "One of: qualified_appointment, qualified_no_appointment, not_interested, wrong_number, voicemail, mailing_removal, vendor, job_inquiry",
        },
        notes: {
            type: "string",
            description:
                "Any other important details from the call not captured above",
        },
    },
};

/**
 * Prompt that guides VAPI's structured data extraction.
 */
export const RE_STRUCTURED_DATA_PROMPT =
    "Extract all available information from this real estate investor call. For any field not discussed or unknown, use an empty string. The caller is a potential home seller contacting a real estate investment company.";

/**
 * Column headers for the auto-created Google Sheet.
 * Order matches the buildSheetRow output.
 */
export const RE_SHEET_HEADERS = [
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
];

/**
 * Maps VAPI structured data + call metadata into a row array
 * matching RE_SHEET_HEADERS order.
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
        structuredData.major_repairs || "",
        structuredData.occupancy || "",
        structuredData.seller_situation || "",
        structuredData.mortgage_status || "",
        structuredData.asking_price || "",
        structuredData.appointment_booked || "",
        structuredData.appointment_date || "",
        structuredData.call_disposition || "",
        structuredData.notes || "",
        callMeta.durationFormatted,
        callMeta.recordingUrl || "",
    ];
}
