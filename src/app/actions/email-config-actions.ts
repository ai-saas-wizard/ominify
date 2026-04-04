"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { encrypt, decrypt } from "@/lib/encryption";

// ─── PUBLIC TYPES ───

export interface EmailAccountConfig {
    id: string;
    provider: "smtp" | "gmail";
    from_email: string;
    from_name: string | null;
    smtp_host: string | null;
    smtp_port: number;
    smtp_user: string | null;
    smtp_secure: boolean;
    reply_to_email: string | null;
    is_active: boolean;
    is_verified: boolean;
    last_verified_at: string | null;
    verification_error: string | null;
    daily_send_limit: number;
    // Password is never returned — only a boolean indicating if one is set
    has_smtp_password: boolean;
}

// ─── READ ───

export async function getEmailConfig(clientId: string): Promise<EmailAccountConfig | null> {
    const { data, error } = await supabase
        .from("tenant_email_accounts")
        .select("*")
        .eq("client_id", clientId)
        .single();

    if (error || !data) {
        return null;
    }

    return {
        id: data.id,
        provider: data.provider,
        from_email: data.from_email,
        from_name: data.from_name,
        smtp_host: data.smtp_host,
        smtp_port: data.smtp_port ?? 587,
        smtp_user: data.smtp_user,
        smtp_secure: data.smtp_secure ?? false,
        reply_to_email: data.reply_to_email,
        is_active: data.is_active ?? true,
        is_verified: data.is_verified ?? false,
        last_verified_at: data.last_verified_at,
        verification_error: data.verification_error,
        daily_send_limit: data.daily_send_limit ?? 500,
        has_smtp_password: !!data.smtp_pass_encrypted,
    };
}

// ─── SAVE / UPDATE ───

export async function saveEmailConfig(
    clientId: string,
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    const provider = (formData.get("provider") as string) || "smtp";
    const from_email = formData.get("from_email") as string;
    const from_name = formData.get("from_name") as string;
    const smtp_host = formData.get("smtp_host") as string;
    const smtp_port = parseInt(formData.get("smtp_port") as string) || 587;
    const smtp_user = formData.get("smtp_user") as string;
    const smtp_pass = formData.get("smtp_pass") as string;
    const smtp_secure = formData.get("smtp_secure") === "true";
    const reply_to_email = formData.get("reply_to_email") as string;
    const daily_send_limit = parseInt(formData.get("daily_send_limit") as string) || 500;

    if (!from_email) {
        return { success: false, error: "From email is required" };
    }

    // Build the upsert payload
    const payload: Record<string, unknown> = {
        client_id: clientId,
        provider,
        from_email,
        from_name: from_name || null,
        smtp_host: smtp_host || null,
        smtp_port,
        smtp_user: smtp_user || null,
        smtp_secure,
        reply_to_email: reply_to_email || null,
        daily_send_limit,
        is_active: true,
        updated_at: new Date().toISOString(),
    };

    // Only encrypt and update password if a new one was provided
    if (smtp_pass && smtp_pass.trim().length > 0) {
        try {
            payload.smtp_pass_encrypted = encrypt(smtp_pass);
        } catch (err) {
            console.error("Encryption error:", err);
            return { success: false, error: "Failed to encrypt password. Check ENCRYPTION_KEY." };
        }
    }

    const { error } = await supabase
        .from("tenant_email_accounts")
        .upsert(payload, { onConflict: "client_id" });

    if (error) {
        console.error("saveEmailConfig error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}/settings/email`);
    revalidatePath(`/client/${clientId}/settings`);
    return { success: true };
}

// ─── TEST CONNECTION ───

export async function testEmailConnection(
    clientId: string
): Promise<{ success: boolean; error?: string }> {
    // Fetch the full config including encrypted password
    const { data, error: fetchError } = await supabase
        .from("tenant_email_accounts")
        .select("*")
        .eq("client_id", clientId)
        .single();

    if (fetchError || !data) {
        return { success: false, error: "No email configuration found. Save your settings first." };
    }

    if (data.provider !== "smtp") {
        return { success: false, error: "Gmail API testing is not yet supported. Use SMTP." };
    }

    if (!data.smtp_host || !data.smtp_user || !data.smtp_pass_encrypted) {
        return { success: false, error: "SMTP host, user, and password are all required." };
    }

    // Decrypt password
    let smtpPass: string;
    try {
        smtpPass = decrypt(data.smtp_pass_encrypted);
    } catch (err) {
        return { success: false, error: "Failed to decrypt SMTP password. Re-enter your password." };
    }

    // Dynamically import nodemailer (server-side only)
    try {
        const nodemailer = await import("nodemailer");

        const transporter = nodemailer.createTransport({
            host: data.smtp_host,
            port: data.smtp_port || 587,
            secure: data.smtp_secure || false,
            auth: {
                user: data.smtp_user,
                pass: smtpPass,
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
        });

        // Verify the connection
        await transporter.verify();

        // Update verification status
        await supabase
            .from("tenant_email_accounts")
            .update({
                is_verified: true,
                last_verified_at: new Date().toISOString(),
                verification_error: null,
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        revalidatePath(`/client/${clientId}/settings/email`);
        return { success: true };
    } catch (err: any) {
        const errorMsg = err.message || "Connection failed";

        // Save the error for display
        await supabase
            .from("tenant_email_accounts")
            .update({
                is_verified: false,
                verification_error: errorMsg,
                updated_at: new Date().toISOString(),
            })
            .eq("client_id", clientId);

        revalidatePath(`/client/${clientId}/settings/email`);
        return { success: false, error: errorMsg };
    }
}

// ─── DELETE ───

export async function deleteEmailConfig(
    clientId: string
): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
        .from("tenant_email_accounts")
        .delete()
        .eq("client_id", clientId);

    if (error) {
        console.error("deleteEmailConfig error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath(`/client/${clientId}/settings/email`);
    revalidatePath(`/client/${clientId}/settings`);
    return { success: true };
}
