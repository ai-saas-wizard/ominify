"use server";

import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export async function createClientAction(formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const type = formData.get("type") as string;
    const vapi_key = formData.get("vapi_key") as string;

    // Basic validation
    if (!name || !vapi_key) {
        return { success: false, error: "Name and Vapi Key are required" };
    }

    // Insert into Supabase
    // Note: 'clerk_id' is marked unique/not null in the schema I wrote.
    // BUT, we are creating this from Admin. We don't have a clerk_id for them yet unless we invite them.
    // For this MVP, I might need to make clerk_id optional or generate a placeholder.
    // The schema said: clerk_id text unique not null.
    // This is a problem if we are creating "Organization" placeholders before they sign up.
    // Or maybe we treat `id` as the reference.
    // Let's perform a hack: use a uuid for clerk_id placeholder.

    const placeholderClerkId = `pending_${crypto.randomUUID()}`;

    const { error } = await supabase.from('clients').insert({
        name,
        email,
        account_type: type,
        vapi_key,
        clerk_id: placeholderClerkId
    });

    if (error) {
        console.error("Create Client Error:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/dashboard/admin");
    return { success: true };
}
