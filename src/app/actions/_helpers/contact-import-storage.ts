// Storage helpers for the Contacts import wizard. Server-internal only —
// the user-facing server action that hands a signed upload token to the
// browser lives in src/app/actions/contact-list-actions.ts.
//
// Flow:
//   1. Browser asks `getContactImportUploadUrl` (a server action) for a
//      pre-signed upload token scoped to the `contact-imports` bucket.
//   2. Browser PUTs the raw CSV directly to Supabase Storage using the
//      returned token. This bypasses Vercel's 4.5 MB request body cap.
//   3. Browser sends only the resulting storage path to startContactImportJob
//      (import-job-actions.ts), which enqueues an import_jobs row; the
//      sequencer's import-worker downloads the file via service-role and
//      processes it server-side.

import { supabase } from "@/lib/supabase";

export const CONTACT_IMPORTS_BUCKET = "contact-imports";

// Build a per-tenant, collision-free storage path for one upload.
export function buildContactImportPath(clientId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    return `${clientId}/${Date.now()}-${safeName}`;
}

// Best-effort cleanup after a successful import. Failure to delete is logged
// but not surfaced — the file will age out via a future TTL job if we add one.
export async function deleteContactImportCsv(storagePath: string): Promise<void> {
    if (!storagePath) return;
    const { error } = await supabase.storage
        .from(CONTACT_IMPORTS_BUCKET)
        .remove([storagePath]);
    if (error) console.warn("deleteContactImportCsv:", error.message);
}
