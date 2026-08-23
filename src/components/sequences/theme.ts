/**
 * Sequences section design tokens — "quiet confidence" restyle.
 *
 * Scoped to src/components/sequences/* only; the rest of the app keeps its
 * current look. Color discipline:
 *   - emerald  → primary actions + live states ONLY
 *   - sky      → in-flight (currently enrolled / running)
 *   - amber    → paused / warning
 *   - red      → failed / destructive
 *   - everything else → neutral ink (gray-900 values, gray-500 labels)
 * Radii scale: cards rounded-xl, buttons rounded-lg, small controls rounded-md.
 */

export const seqFocusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2";

const seqBtnBase = `inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ${seqFocusRing}`;

export const seqBtnPrimary = `${seqBtnBase} bg-emerald-600 text-white hover:bg-emerald-700`;

export const seqBtnSecondary = `${seqBtnBase} border border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50`;

export const seqBtnGhost = `${seqBtnBase} text-gray-500 hover:bg-gray-100 hover:text-gray-900`;

/** Interactive card: hairline border, 1px lift + soft shadow on hover, ≤200ms. */
export const seqCardInteractive =
    "rounded-xl border border-gray-200 bg-white shadow-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:border-gray-300 hover:shadow-sm motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** Static card: hairline border, no shadow, no hover response. */
export const seqCardStatic = "rounded-xl border border-gray-200 bg-white shadow-none";

/** Selectable option (wizard cards, pills, condition rows) — unselected. */
export const seqOption =
    "border border-gray-200 bg-white transition-colors duration-150 hover:border-gray-300";

/** Selectable option — selected. ring-1 doubles the hairline without layout shift. */
export const seqOptionSelected = "border border-emerald-600 ring-1 ring-emerald-600 bg-emerald-50/40";

/** Status → dot + label styling. Dot color is the only non-ink element. */
export const SEQ_STATUS = {
    live: { dot: "bg-emerald-500", text: "text-emerald-700", label: "Live" },
    draft: { dot: "bg-gray-300", text: "text-gray-500", label: "Draft" },
    inflight: { dot: "bg-sky-500", text: "text-sky-700", label: "Active" },
    paused: { dot: "bg-amber-500", text: "text-amber-700", label: "Paused" },
    failed: { dot: "bg-red-500", text: "text-red-700", label: "Failed" },
    completed: { dot: "bg-gray-900", text: "text-gray-700", label: "Completed" },
} as const;

export type SeqStatusKey = keyof typeof SEQ_STATUS;

/**
 * Contract that lets the config cards live inside the sequence detail rail's
 * accordion instead of standing alone as cards.
 *
 * `bare` drops the card chrome + title + own save button (the accordion header
 * carries the title and the rail carries one save bar); `onDirtyChange` and
 * `registerSave` let the rail's single save bar count and commit the edits.
 * All optional — omitting them leaves the card exactly as it behaves today in
 * the flow sidebar.
 */
export interface SeqRailPanelProps {
    /** Render without the card wrapper, heading, and per-panel save button. */
    bare?: boolean;
    /** Fires whenever the panel gains or loses unsaved edits. */
    onDirtyChange?: (dirty: boolean) => void;
    /**
     * Hands the parent a save function to call from a unified save bar, or
     * null on unmount. Resolves to an error string when the save fails.
     */
    registerSave?: (fn: (() => Promise<string | null>) | null) => void;
}
