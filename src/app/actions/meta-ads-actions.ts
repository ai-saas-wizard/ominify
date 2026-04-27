"use server";

import { revalidatePath } from "next/cache";
import {
    listUserPages,
    subscribePages,
    unsubscribePage,
    disconnectMetaAds,
} from "@/lib/meta-ads";

export async function listMetaPagesAction(clientId: string) {
    if (!clientId) return [];
    const pages = await listUserPages(clientId);
    // Strip access tokens before returning to the client.
    return pages.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
    }));
}

export async function subscribeMetaPagesAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    const pageIdsRaw = formData.getAll("pageIds");
    const pageIds = pageIdsRaw.map((v) => String(v)).filter(Boolean);

    if (!clientId || pageIds.length === 0) {
        return {
            success: false as const,
            error: "Pick at least one Page to subscribe",
        };
    }

    const result = await subscribePages(clientId, pageIds);
    revalidatePath(`/client/${clientId}/settings/integrations`);

    if (result.subscribed.length === 0) {
        return {
            success: false as const,
            error:
                result.failed[0]?.error ||
                "Failed to subscribe Pages — check your Meta App permissions",
        };
    }
    return {
        success: true as const,
        subscribedCount: result.subscribed.length,
        failedCount: result.failed.length,
    };
}

export async function unsubscribeMetaPageAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    const pageId = formData.get("pageId") as string;
    if (!clientId || !pageId) return { success: false };
    const ok = await unsubscribePage(clientId, pageId);
    revalidatePath(`/client/${clientId}/settings/integrations`);
    return { success: ok };
}

export async function disconnectMetaAdsAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    if (!clientId) return { success: false };
    const ok = await disconnectMetaAds(clientId);
    revalidatePath(`/client/${clientId}/settings/integrations`);
    return { success: ok };
}
