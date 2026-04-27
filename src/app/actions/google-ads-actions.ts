"use server";

import { revalidatePath } from "next/cache";
import {
    generateGoogleAdsWebhook,
    rotateGoogleAdsKey,
    disconnectGoogleAds,
    getGoogleAdsSigningKey,
} from "@/lib/google-ads";

export async function generateGoogleAdsWebhookAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    if (!clientId) {
        return { success: false as const, error: "Missing clientId" };
    }
    try {
        const result = await generateGoogleAdsWebhook(clientId);
        revalidatePath(`/client/${clientId}/settings/integrations`);
        return {
            success: true as const,
            webhookUrl: result.webhookUrl,
            signingKey: result.signingKey,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate webhook";
        return { success: false as const, error: message };
    }
}

export async function rotateGoogleAdsKeyAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    if (!clientId) {
        return { success: false as const, error: "Missing clientId" };
    }
    try {
        const result = await rotateGoogleAdsKey(clientId);
        revalidatePath(`/client/${clientId}/settings/integrations`);
        return { success: true as const, signingKey: result.signingKey };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to rotate key";
        return { success: false as const, error: message };
    }
}

export async function showGoogleAdsKeyAction(clientId: string) {
    if (!clientId) return { signingKey: null as string | null };
    const signingKey = await getGoogleAdsSigningKey(clientId);
    return { signingKey };
}

export async function disconnectGoogleAdsAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    if (!clientId) return { success: false };
    const ok = await disconnectGoogleAds(clientId);
    revalidatePath(`/client/${clientId}/settings/integrations`);
    return { success: ok };
}
