import "server-only";
import { google } from "googleapis";
import { supabase } from "@/lib/supabase";
import { encrypt } from "@/lib/encryption";
import { safeDecrypt } from "@/lib/encryption-helpers";
import { RE_SHEET_HEADERS } from "@/lib/verticals/real-estate-investor/sheets-schema";

// ═══════════════════════════════════════════════════════════
// GOOGLE SHEETS INTEGRATION
// OAuth + Auto-create spreadsheet + Append rows
// Mirrors google-calendar.ts patterns exactly.
// ═══════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!;
const GOOGLE_SHEETS_REDIRECT_URI = process.env.GOOGLE_SHEETS_REDIRECT_URI!;

function getOAuth2Client() {
    return new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        GOOGLE_SHEETS_REDIRECT_URI
    );
}

// ─── OAUTH HELPERS ───

export function getSheetsAuthorizationUrl(clientId: string): string {
    const oauth2Client = getOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file",
        ],
        state: clientId,
    });
}

export async function exchangeSheetsCodeForTokens(
    code: string,
    clientId: string
) {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    const { error } = await supabase.from("tenant_google_sheets").upsert(
        {
            client_id: clientId,
            google_access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
            google_refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            token_expires_at: tokens.expiry_date
                ? new Date(tokens.expiry_date).toISOString()
                : null,
            is_active: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" }
    );

    if (error) {
        console.error("[GOOGLE SHEETS] Failed to save tokens:", error);
        throw new Error("Failed to save sheets connection");
    }

    return tokens;
}

// ─── TOKEN MANAGEMENT ───

interface SheetsConfig {
    access_token: string;
    refresh_token: string | null;
    sheet_id: string | null;
    sheet_url: string | null;
    token_expires_at: string | null;
}

async function getSheetsConfig(
    clientId: string
): Promise<SheetsConfig | null> {
    const { data, error } = await supabase
        .from("tenant_google_sheets")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .single();

    if (error || !data) return null;

    const accessToken = safeDecrypt(data.google_access_token_encrypted);
    if (!accessToken) return null;

    return {
        access_token: accessToken,
        refresh_token: safeDecrypt(data.google_refresh_token_encrypted),
        sheet_id: data.google_sheet_id,
        sheet_url: data.google_sheet_url,
        token_expires_at: data.token_expires_at,
    };
}

async function getAuthenticatedSheetsClient(clientId: string) {
    const config = await getSheetsConfig(clientId);
    if (!config) return null;

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
        access_token: config.access_token,
        refresh_token: config.refresh_token,
    });

    // Check if token needs refresh
    const expiresAt = config.token_expires_at
        ? new Date(config.token_expires_at)
        : null;
    const isExpired =
        expiresAt && expiresAt.getTime() < Date.now() + 60_000; // 1 min buffer

    if (isExpired && config.refresh_token) {
        try {
            const { credentials } =
                await oauth2Client.refreshAccessToken();
            // Update stored tokens — re-encrypt before writing back
            await supabase
                .from("tenant_google_sheets")
                .update({
                    google_access_token_encrypted: credentials.access_token
                        ? encrypt(credentials.access_token)
                        : null,
                    token_expires_at: credentials.expiry_date
                        ? new Date(credentials.expiry_date).toISOString()
                        : null,
                    updated_at: new Date().toISOString(),
                })
                .eq("client_id", clientId);

            oauth2Client.setCredentials(credentials);
        } catch (err) {
            console.error("[GOOGLE SHEETS] Token refresh failed:", err);
            return null;
        }
    }

    return { oauth2Client, config };
}

// ─── SHEET OPERATIONS ───

/**
 * Creates a new Google Sheet with pre-configured column headers.
 * Called during OAuth callback after tokens are saved.
 */
export async function createLeadSheet(
    clientId: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string } | null> {
    const authResult = await getAuthenticatedSheetsClient(clientId);
    if (!authResult) return null;

    const { oauth2Client } = authResult;
    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    // Get company name for the sheet title
    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("industry, business_description")
        .eq("client_id", clientId)
        .single();

    // Extract company name from business description or use fallback
    let companyName = "My Company";
    if (profile?.business_description) {
        // business_description is like "Tennessee Homebuyers - Real estate investment..."
        const dashIndex = profile.business_description.indexOf(" - ");
        companyName =
            dashIndex > 0
                ? profile.business_description.substring(0, dashIndex)
                : profile.business_description.substring(0, 30);
    }

    try {
        // Create the spreadsheet
        const response = await sheets.spreadsheets.create({
            requestBody: {
                properties: {
                    title: `${companyName} - AI Call Leads`,
                },
                sheets: [
                    {
                        properties: {
                            title: "Leads",
                            gridProperties: {
                                frozenRowCount: 1,
                            },
                        },
                    },
                ],
            },
        });

        const spreadsheetId = response.data.spreadsheetId!;
        const spreadsheetUrl = response.data.spreadsheetUrl!;

        // Write header row
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "Leads!A1",
            valueInputOption: "RAW",
            requestBody: {
                values: [RE_SHEET_HEADERS],
            },
        });

        // Bold the header row
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        repeatCell: {
                            range: {
                                sheetId: 0,
                                startRowIndex: 0,
                                endRowIndex: 1,
                            },
                            cell: {
                                userEnteredFormat: {
                                    textFormat: { bold: true },
                                    backgroundColor: {
                                        red: 0.93,
                                        green: 0.93,
                                        blue: 0.93,
                                    },
                                },
                            },
                            fields: "userEnteredFormat(textFormat,backgroundColor)",
                        },
                    },
                    // Auto-resize columns
                    {
                        autoResizeDimensions: {
                            dimensions: {
                                sheetId: 0,
                                dimension: "COLUMNS",
                                startIndex: 0,
                                endIndex: RE_SHEET_HEADERS.length,
                            },
                        },
                    },
                ],
            },
        });

        // Save spreadsheet ID and URL to DB
        await supabase
            .from("tenant_google_sheets")
            .update({
                google_sheet_id: spreadsheetId,
                google_sheet_url: spreadsheetUrl,
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        console.log(
            "[GOOGLE SHEETS] Created lead sheet:",
            spreadsheetId,
            "for client:",
            clientId
        );

        return { spreadsheetId, spreadsheetUrl };
    } catch (err) {
        console.error("[GOOGLE SHEETS] Failed to create lead sheet:", err);
        return null;
    }
}

/**
 * Appends a single row to the client's connected Google Sheet.
 * Used by the VAPI webhook handler after each qualifying call.
 */
export async function appendLeadRow(
    clientId: string,
    rowData: string[]
): Promise<boolean> {
    const authResult = await getAuthenticatedSheetsClient(clientId);
    if (!authResult) {
        console.error(
            "[GOOGLE SHEETS] No authenticated client for:",
            clientId
        );
        return false;
    }

    const { oauth2Client, config } = authResult;

    if (!config.sheet_id) {
        console.error(
            "[GOOGLE SHEETS] No sheet_id configured for client:",
            clientId
        );
        return false;
    }

    const sheets = google.sheets({ version: "v4", auth: oauth2Client });

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: config.sheet_id,
            range: "Leads!A1",
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: {
                values: [rowData],
            },
        });

        console.log(
            "[GOOGLE SHEETS] Row appended for client:",
            clientId
        );
        return true;
    } catch (err) {
        console.error("[GOOGLE SHEETS] Failed to append row:", err);
        return false;
    }
}

// ─── CONNECTION STATUS ───

export async function getSheetsConnectionStatus(clientId: string) {
    const { data } = await supabase
        .from("tenant_google_sheets")
        .select(
            "is_active, connected_at, google_sheet_id, google_sheet_url"
        )
        .eq("client_id", clientId)
        .single();

    return data;
}

export async function disconnectSheets(clientId: string) {
    const { error } = await supabase
        .from("tenant_google_sheets")
        .update({
            is_active: false,
            google_access_token_encrypted: null,
            google_refresh_token_encrypted: null,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);

    return !error;
}
