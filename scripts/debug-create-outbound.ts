/**
 * Debug VAPI assistant creation for the New Agent → Outbound flow.
 *
 * Resolves the same client → umbrella → key chain the wizard does, validates
 * the stored RE structured-output ID against VAPI, then POSTs a minimal
 * outbound assistant and prints VAPI's exact response. Cleans up after itself.
 *
 * Usage: npx tsx scripts/debug-create-outbound.ts <clientId>
 *
 * Required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
 * SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY.
 */

import "dotenv/config";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY;
const VAPI_BASE_URL = "https://api.vapi.ai";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}
if (!ENCRYPTION_KEY_HEX || ENCRYPTION_KEY_HEX.length !== 64) {
    console.error("Missing or malformed ENCRYPTION_KEY (need 64 hex chars)");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Inline decrypt — same algorithm as src/lib/encryption.ts. Inlined so the
// script doesn't pull `server-only` modules through the tsx loader.
function decrypt(encryptedData: string): string {
    const key = Buffer.from(ENCRYPTION_KEY_HEX!, "hex");
    const [ivB64, tagB64, ciphertext] = encryptedData.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return (
        decipher.update(ciphertext, "base64", "utf8") + decipher.final("utf8")
    );
}

const ENCRYPTED_SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
function safeDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!ENCRYPTED_SHAPE.test(value)) return value;
    try {
        return decrypt(value);
    } catch {
        return null;
    }
}

async function main() {
    const clientId = process.argv[2];
    if (!clientId) {
        console.error("Usage: npx tsx scripts/debug-create-outbound.ts <clientId>");
        process.exit(1);
    }

    console.log(`\n=== Debugging outbound deploy for client ${clientId} ===\n`);

    const { data: client, error: clientErr } = await supabase
        .from("clients")
        .select("id, name, account_type")
        .eq("id", clientId)
        .single();
    if (clientErr || !client) {
        console.error(`FAIL client_lookup: ${clientErr?.message || "not found"}`);
        process.exit(1);
    }
    console.log(`client.name = ${client.name}`);
    console.log(`client.account_type = ${client.account_type}`);

    let apiKey: string | null = null;
    let structuredOutputId: string | null = null;

    if (client.account_type === "UMBRELLA") {
        const { data: assignment } = await supabase
            .from("tenant_vapi_assignments")
            .select("umbrella_id")
            .eq("client_id", clientId)
            .single();
        if (!assignment?.umbrella_id) {
            console.error("FAIL umbrella_lookup: no tenant_vapi_assignments row");
            process.exit(1);
        }
        console.log(`umbrella_id = ${assignment.umbrella_id}`);

        const { data: umbrella, error: umbErr } = await supabase
            .from("vapi_umbrellas")
            .select("id, vapi_api_key_encrypted, re_structured_output_id")
            .eq("id", assignment.umbrella_id)
            .single();
        if (umbErr) {
            if ((umbErr as any).code === "42703") {
                console.warn(
                    "WARN: vapi_umbrellas.re_structured_output_id column missing — migration 20260502 not applied. Querying without it."
                );
                const { data: u2 } = await supabase
                    .from("vapi_umbrellas")
                    .select("id, vapi_api_key_encrypted")
                    .eq("id", assignment.umbrella_id)
                    .single();
                apiKey = safeDecrypt(u2?.vapi_api_key_encrypted);
            } else {
                console.error(`FAIL umbrella_read: ${umbErr.message}`);
                process.exit(1);
            }
        } else if (!umbrella) {
            console.error("FAIL umbrella_read: row not found");
            process.exit(1);
        } else {
            apiKey = safeDecrypt(umbrella.vapi_api_key_encrypted);
            structuredOutputId = umbrella.re_structured_output_id ?? null;
            console.log(
                `umbrella.re_structured_output_id = ${structuredOutputId ?? "(null)"}`
            );
        }
    } else {
        const { data: secret } = await supabase
            .from("client_secrets")
            .select("vapi_api_key_encrypted")
            .eq("client_id", clientId)
            .single();
        apiKey = safeDecrypt(secret?.vapi_api_key_encrypted);
    }

    if (!apiKey) {
        console.error("FAIL key_resolve: could not decrypt VAPI API key");
        process.exit(1);
    }
    console.log(`apiKey = sk_***${apiKey.slice(-4)}`);

    if (structuredOutputId) {
        console.log(
            `\n--- Validating stored structured-output ID against VAPI ---`
        );
        const res = await fetch(
            `${VAPI_BASE_URL}/structured-output/${structuredOutputId}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        const body = await res.text();
        console.log(`GET /structured-output/${structuredOutputId} → ${res.status}`);
        console.log(body.slice(0, 500));
        if (!res.ok) {
            console.warn(
                "WARN: stored ID is stale — wizard would also fail on this. The new preflight will null-out and recreate."
            );
        }
    } else {
        console.log("(No stored structured-output ID — skipping validation)");
    }

    console.log(`\n--- Creating throwaway minimal outbound assistant ---`);
    const testPayload: any = {
        name: `DEBUG-DELETE-${Date.now()}`,
        firstMessage: "Debug ping.",
        model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "You are a debug assistant." }],
            tools: [{ type: "endCall" }],
            temperature: 0.7,
        },
        voice: { provider: "11labs", voiceId: "ZRwrL4id6j1HPGFkeCzO" },
        transcriber: { provider: "deepgram", language: "en", model: "nova-2" },
        metadata: { debug: true },
    };
    if (structuredOutputId) {
        testPayload.artifactPlan = {
            structuredOutputIds: [structuredOutputId],
        };
    }

    const createRes = await fetch(`${VAPI_BASE_URL}/assistant`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(testPayload),
    });
    const createBody = await createRes.text();
    console.log(`POST /assistant → ${createRes.status}`);
    console.log(createBody);

    if (!createRes.ok) {
        console.log(`\nFAIL create_assistant: VAPI ${createRes.status}`);
        process.exit(1);
    }

    let createdId: string | undefined;
    try {
        createdId = JSON.parse(createBody)?.id;
    } catch {}

    if (createdId) {
        console.log(`\n--- Cleaning up test assistant ${createdId} ---`);
        const delRes = await fetch(`${VAPI_BASE_URL}/assistant/${createdId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        console.log(`DELETE /assistant/${createdId} → ${delRes.status}`);
    }

    console.log(`\nOK — outbound assistant create round-trips successfully.`);
}

main().catch((err) => {
    console.error("Uncaught error:", err);
    process.exit(1);
});
