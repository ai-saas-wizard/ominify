// Browser-side CSV upload to Supabase Storage. Shared by the Imports wizard
// (step-upload) and the sequences task dialog: both PUT the raw file straight
// to the `contact-imports` bucket with a server-issued signed token, then pass
// only the storage path to startContactImportJob. This bypasses Vercel's
// 4.5 MB body cap and gives the import-worker a durable copy of the file.

import { createClient } from "@supabase/supabase-js";
import { getContactImportUploadUrl } from "@/app/actions/contact-list-actions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const STORAGE_BUCKET = "contact-imports";

// Uploads the file and returns its storage path. Throws with a user-facing
// message on failure. No session/auth involved — the signed token IS the
// authorization (anon-key client).
export async function uploadCsvToStorage(clientId: string, file: File): Promise<string> {
    const r = await getContactImportUploadUrl(clientId, file.name);
    if (!r.success || !r.data) {
        throw new Error(r.error || "Failed to get upload URL");
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: upErr } = await sb.storage
        .from(STORAGE_BUCKET)
        .uploadToSignedUrl(r.data.storagePath, r.data.token, file, {
            contentType: "text/csv",
            upsert: false,
        });
    if (upErr) throw new Error(upErr.message);
    return r.data.storagePath;
}
