// Shared limits for the Contacts import wizard. Surfaced in the UI for early
// feedback and re-enforced server-side in contact-list-actions.ts so the UI
// can never bypass the cap.

// Hard cap on rows per import. No longer a Vercel-timeout constraint (imports
// run as server-side jobs on the sequencer's import-worker); kept as a sanity
// bound on file size and worker memory. Mirrored in
// sequencer/src/lib/import-processor.ts — change both together.
export const MAX_IMPORT_ROWS = 10_000;
