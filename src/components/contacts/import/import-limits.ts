// Shared limits for the Contacts import wizard. Surfaced in the UI for early
// feedback and re-enforced server-side in contact-list-actions.ts so the UI
// can never bypass the cap.

// Hard cap on rows per import. Sized to fit comfortably under Vercel's 60s
// function timeout when paired with the batched UPSERT path. Larger imports
// should be split into multiple files or routed through the API.
export const MAX_IMPORT_ROWS = 10_000;
