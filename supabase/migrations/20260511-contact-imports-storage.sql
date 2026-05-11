-- Contact Imports Storage Bucket
-- ----------------------------------------------------------------------------
-- Why: Vercel serverless functions cap request bodies at 4.5 MB. Sending a
-- 6 MB+ CSV through a Server Action returns the generic
-- "An unexpected response was received from the server." Fix is to upload the
-- raw CSV directly to Supabase Storage from the browser (via a server-issued
-- signed upload URL) and have the server pull it down by storage path.
--
-- The bucket is private. Browser uploads use short-lived signed upload tokens
-- minted by the server (service-role) — see
-- src/app/actions/contact-list-actions.ts -> getContactImportUploadUrl.
-- The server reads the file with the service-role key, which bypasses
-- storage RLS, so no per-row policies are required for downloads.
--
-- file_size_limit is set to 25 MB — comfortably above the largest realistic
-- CSV at the 10k-row UI cap (the original failure case was 5.9 MB) but a
-- hard ceiling that prevents an attacker from forcing the server action to
-- download a multi-GB file. allowed_mime_types restricts uploads to the
-- text/csv family the parser actually understands.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'contact-imports',
    'contact-imports',
    false,
    26214400, -- 25 MiB
    ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
