/**
 * One-shot migration: encrypt every plaintext row in columns that should
 * hold encrypted credentials. Idempotent — re-running skips rows that are
 * already ciphertext.
 *
 * Usage:
 *   npx tsx scripts/migrate-encrypt-existing-secrets.ts
 *
 * Prerequisites:
 *   - .env.local loaded with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
 *   - The app code that writes new rows is already deployed and emits ciphertext
 *   - safeDecrypt()-based read paths are live so the app works during the overlap window
 *
 * After running:
 *   - Spot check each table: column value should look like `<base64>:<base64>:<base64>`
 *   - Wait two weeks with no regressions, then optionally remove safeDecrypt fallbacks
 *     and switch to strict decrypt() in helper functions.
 */

import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "../src/lib/encryption";
import { isEncrypted } from "../src/lib/encryption-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    process.exit(1);
}
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    console.error("FATAL: ENCRYPTION_KEY must be a 64-char hex string");
    process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface MigrationStats {
    total: number;
    skippedAlreadyEncrypted: number;
    skippedEmpty: number;
    encrypted: number;
    failed: number;
}

async function migrateColumn(
    table: string,
    pkColumn: string,
    targetColumn: string
): Promise<MigrationStats> {
    const stats: MigrationStats = {
        total: 0,
        skippedAlreadyEncrypted: 0,
        skippedEmpty: 0,
        encrypted: 0,
        failed: 0,
    };

    console.log(`\n━━━ ${table}.${targetColumn} ━━━`);

    // Fetch all rows. For small tenant tables this is fine.
    // Cast to `any` because Supabase's generated types don't model dynamic
    // column names passed via a template literal; this script is a one-shot
    // utility, not production code.
    const { data: rows, error: fetchError } = await (supabase as any)
        .from(table)
        .select(`${pkColumn}, ${targetColumn}`);

    if (fetchError) {
        console.error(`  ❌ Failed to fetch ${table}: ${fetchError.message}`);
        return stats;
    }
    if (!rows || rows.length === 0) {
        console.log(`  (table is empty)`);
        return stats;
    }

    stats.total = rows.length;

    for (const row of rows as Array<Record<string, unknown>>) {
        const pk = row[pkColumn] as string;
        const value = row[targetColumn] as string | null | undefined;

        if (!value) {
            stats.skippedEmpty++;
            continue;
        }
        if (isEncrypted(value)) {
            stats.skippedAlreadyEncrypted++;
            continue;
        }

        let ciphertext: string;
        try {
            ciphertext = encrypt(value);
        } catch (err) {
            console.error(`  ❌ encrypt() threw for ${pkColumn}=${pk}:`, err);
            stats.failed++;
            continue;
        }

        const { error: updateError } = await supabase
            .from(table)
            .update({ [targetColumn]: ciphertext })
            .eq(pkColumn, pk);

        if (updateError) {
            console.error(`  ❌ UPDATE failed for ${pkColumn}=${pk}: ${updateError.message}`);
            stats.failed++;
        } else {
            stats.encrypted++;
        }
    }

    console.log(`  Total: ${stats.total}`);
    console.log(`  Already encrypted (skipped): ${stats.skippedAlreadyEncrypted}`);
    console.log(`  Empty/null (skipped): ${stats.skippedEmpty}`);
    console.log(`  Newly encrypted: ${stats.encrypted}`);
    console.log(`  Failed: ${stats.failed}`);

    return stats;
}

async function main() {
    console.log("🔐 Encryption migration — converting plaintext secrets to AES-256-GCM ciphertext");
    console.log("This script is idempotent; rows already matching the encrypted shape are skipped.");

    const targets: Array<[string, string, string]> = [
        // table, primary key column, column to encrypt
        ["vapi_umbrellas",         "id",        "vapi_api_key_encrypted"],
        ["clients",                "id",        "vapi_key"],
        ["tenant_google_calendar", "client_id", "google_access_token_encrypted"],
        ["tenant_google_calendar", "client_id", "google_refresh_token_encrypted"],
        ["tenant_google_sheets",   "client_id", "google_access_token_encrypted"],
        ["tenant_google_sheets",   "client_id", "google_refresh_token_encrypted"],
    ];

    const totalStats: MigrationStats = {
        total: 0,
        skippedAlreadyEncrypted: 0,
        skippedEmpty: 0,
        encrypted: 0,
        failed: 0,
    };

    for (const [table, pk, col] of targets) {
        const s = await migrateColumn(table, pk, col);
        totalStats.total += s.total;
        totalStats.skippedAlreadyEncrypted += s.skippedAlreadyEncrypted;
        totalStats.skippedEmpty += s.skippedEmpty;
        totalStats.encrypted += s.encrypted;
        totalStats.failed += s.failed;
    }

    console.log("\n━━━ SUMMARY ━━━");
    console.log(`  Rows scanned: ${totalStats.total}`);
    console.log(`  Already encrypted: ${totalStats.skippedAlreadyEncrypted}`);
    console.log(`  Empty/null: ${totalStats.skippedEmpty}`);
    console.log(`  Newly encrypted: ${totalStats.encrypted}`);
    console.log(`  Failures: ${totalStats.failed}`);

    if (totalStats.failed > 0) {
        console.error("\n❌ Some rows failed to migrate. Review logs above.");
        process.exit(1);
    }
    console.log("\n✅ Migration complete.");
}

main().catch((err) => {
    console.error("Migration crashed:", err);
    process.exit(1);
});
