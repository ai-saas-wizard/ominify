"use server";

import { revalidatePath } from "next/cache";
import {
    saveConnection,
    disconnectCalendly,
    setEventType,
    listEventTypes,
    testConnection,
} from "@/lib/calendly";

export async function connectCalendlyAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    const pat = (formData.get("pat") as string || "").trim();

    if (!clientId || !pat) {
        return { success: false, error: "Missing API key or client ID" };
    }

    const result = await saveConnection(clientId, pat);
    if (result.success) {
        revalidatePath(`/client/${clientId}/settings/integrations`);
        return { success: true };
    }
    return { success: false, error: result.error };
}

export async function testCalendlyPatAction(pat: string) {
    if (!pat) return { success: false as const, error: "API key is required" };
    return testConnection(pat.trim());
}

export async function setCalendlyEventTypeAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    const eventTypeUri = formData.get("eventTypeUri") as string;

    if (!clientId || !eventTypeUri) {
        return { success: false, error: "Missing event type selection" };
    }

    const result = await setEventType(clientId, eventTypeUri);
    revalidatePath(`/client/${clientId}/settings/integrations`);
    return result;
}

export async function disconnectCalendlyAction(formData: FormData) {
    const clientId = formData.get("clientId") as string;
    if (!clientId) return { success: false };

    const ok = await disconnectCalendly(clientId);
    revalidatePath(`/client/${clientId}/settings/integrations`);
    return { success: ok };
}

export async function listCalendlyEventTypesAction(clientId: string) {
    if (!clientId) return [];
    return listEventTypes(clientId);
}
