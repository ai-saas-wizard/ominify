"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getActiveUmbrellaWithRawKey } from "@/app/actions/umbrella-actions";
import { encrypt } from "@/lib/encryption";
import { isEncrypted } from "@/lib/encryption-helpers";
import { auditLog } from "@/lib/audit";

export async function createClientAction(formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const type = formData.get("type") as string;
    const vapi_key = formData.get("vapi_key") as string;

    // ─── TYPE A (CUSTOM): Requires Vapi Key ───
    if (type === "CUSTOM") {
        if (!name || !vapi_key) {
            return { success: false, error: "Name and Vapi Key are required" };
        }

        const placeholderClerkId = `pending_${crypto.randomUUID()}`;

        const { data: newClient, error } = await supabase.from("clients").insert({
            name,
            email,
            account_type: type,
            vapi_key: encrypt(vapi_key),
            clerk_id: placeholderClerkId,
        }).select("id").single();

        if (error) {
            console.error("Create Client Error:", error);
            return { success: false, error: error.message };
        }

        if (newClient?.id) {
            await auditLog(
                "create_client",
                { type: "client", id: newClient.id },
                { accountType: "CUSTOM", name }
            );
        }

        revalidatePath("/admin/clients");
        return { success: true, clientId: newClient?.id };
    }

    // ─── TYPE B (UMBRELLA): Auto-resolve single umbrella ───
    if (type === "UMBRELLA") {
        const tenantConcurrencyCap = parseInt(formData.get("tenant_concurrency_cap") as string) || 2;

        if (!name) {
            return { success: false, error: "Client name is required" };
        }

        // Auto-resolve the single active umbrella (needs raw ciphertext to copy)
        const umbrella = await getActiveUmbrellaWithRawKey();
        if (!umbrella) {
            return { success: false, error: "No umbrella configured. Create one in Admin → Settings first." };
        }

        // Defensive: if the umbrella row is still legacy plaintext (pre-migration),
        // encrypt it in place before copying to avoid writing plaintext to new rows.
        const umbrellaKey = umbrella.vapi_api_key_encrypted;
        const vapiKeyCiphertext = umbrellaKey
            ? (isEncrypted(umbrellaKey) ? umbrellaKey : encrypt(umbrellaKey))
            : null;

        const placeholderClerkId = `pending_${crypto.randomUUID()}`;

        // Create the client record with umbrella's VAPI credentials (already ciphertext)
        const { data: newClient, error: clientError } = await supabase.from("clients").insert({
            name,
            email,
            account_type: "UMBRELLA",
            vapi_key: vapiKeyCiphertext,
            vapi_org_id: umbrella.vapi_org_id,
            clerk_id: placeholderClerkId,
        }).select("id").single();

        if (clientError || !newClient) {
            console.error("Create UMBRELLA Client Error:", clientError);
            return { success: false, error: clientError?.message || "Failed to create client" };
        }

        const clientId = newClient.id;

        // Create umbrella assignment
        const { error: assignError } = await supabase.from("tenant_vapi_assignments").insert({
            client_id: clientId,
            umbrella_id: umbrella.id,
            tenant_concurrency_cap: tenantConcurrencyCap,
            priority_weight: 1.0,
            assigned_by: "admin",
        });

        if (assignError) {
            console.error("Umbrella Assignment Error:", assignError);
            // Don't fail — client is created, assignment can be retried
        }

        // Create empty tenant profile (to be filled during onboarding)
        const { error: profileError } = await supabase.from("tenant_profiles").insert({
            client_id: clientId,
        });

        if (profileError) {
            console.error("Tenant Profile Error:", profileError);
            // Non-fatal — profile can be created during onboarding
        }

        // Create billing record (same as Type A)
        await supabase.from("client_billing").insert({
            client_id: clientId,
        });

        // Create minute balance (starts at 0)
        await supabase.from("minute_balances").insert({
            client_id: clientId,
            balance_minutes: 0,
            total_purchased_minutes: 0,
            total_used_minutes: 0,
        });

        // Create client_members entry so tenant can access their account on sign-up
        if (email) {
            await supabase.from("client_members").insert({
                client_id: clientId,
                email: email.toLowerCase().trim(),
                role: "owner",
                invited_by: "admin",
            });
        }

        await auditLog(
            "create_client",
            { type: "client", id: clientId },
            { accountType: "UMBRELLA", name, umbrellaId: umbrella.id }
        );

        revalidatePath("/admin/clients");
        return { success: true, clientId };
    }

    return { success: false, error: "Invalid account type" };
}

export async function toggleClientDisabled(clientId: string, disabled: boolean) {
    const { error } = await supabase
        .from("clients")
        .update({ disabled })
        .eq("id", clientId);

    if (error) {
        console.error("Toggle client disabled error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin/clients");
    return { success: true };
}

/**
 * Same admin gate the offers/pricing-tier actions use: the caller must be a
 * row in `admin_users`, matched on either their email or their Clerk id.
 */
async function callerIsAdmin(): Promise<boolean> {
    const { userId } = await auth();
    if (!userId) return false;
    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress;
    return (!!email && (await isAdmin(email))) || (await isAdmin(userId));
}

/**
 * Archive a client, or restore one from the archive.
 *
 * Archiving is a VIEW state for the admin panel only — the client drops out of
 * the default Admin → Clients grid and the onboarding queue so a long list of
 * dead accounts stops getting in the way. It deliberately does NOT change
 * access: `disabled` is what blocks the dashboard, and an archived client that
 * was never disabled keeps working exactly as before. The archive dialog warns
 * when the two disagree so nothing goes quiet by accident.
 */
export async function setClientArchived(clientId: string, archived: boolean) {
    if (!(await callerIsAdmin())) {
        return { success: false, error: "Not authorized" };
    }

    const { error } = await supabase
        .from("clients")
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", clientId);

    if (error) {
        console.error("Archive client error:", error);
        return { success: false, error: error.message };
    }

    await auditLog(
        archived ? "archive_client" : "unarchive_client",
        { type: "client", id: clientId }
    );

    revalidatePath("/admin/clients");
    revalidatePath("/admin/onboarding");
    return { success: true };
}
