"use client";

import { useState } from "react";
import { setClientArchived } from "@/app/actions/client-actions";
import { Archive, ArchiveRestore, Loader2, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
} from "@/components/ui/tooltip";

/**
 * Icon-only companion to <DisableClientButton>. Archiving only hides the client
 * from the default admin grid — it never touches access, so when the client is
 * still enabled the dialog says so out loud rather than quietly implying the
 * account has been shut off.
 */
export function ArchiveClientButton({
    clientId,
    clientName,
    archived,
    clientDisabled,
}: {
    clientId: string;
    clientName: string;
    archived: boolean;
    clientDisabled: boolean;
}) {
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const stillLive = !archived && !clientDisabled;

    async function handleToggle() {
        setLoading(true);
        setError(null);
        try {
            const res = await setClientArchived(clientId, !archived);
            if (!res?.success) {
                setError(res?.error ?? "Something went wrong");
                return;
            }
            setOpen(false);
        } catch (err) {
            console.error("Failed to archive client:", err);
            setError("Something went wrong");
        } finally {
            setLoading(false);
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) setError(null);
            }}
        >
            <TooltipProvider delayDuration={300}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <AlertDialogTrigger asChild>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                aria-label={archived ? `Restore ${clientName}` : `Archive ${clientName}`}
                                className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                                    archived
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                        : "border-gray-200 bg-white text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                }`}
                            >
                                {archived ? (
                                    <ArchiveRestore className="w-3.5 h-3.5" />
                                ) : (
                                    <Archive className="w-3.5 h-3.5" />
                                )}
                            </motion.button>
                        </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        {archived ? "Restore to the active list" : "Archive — hide from the client list"}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <div className="flex items-center gap-3 mb-1">
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 260, damping: 20 }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                archived ? "bg-emerald-100" : "bg-gray-100"
                            }`}
                        >
                            {archived ? (
                                <ArchiveRestore className="w-5 h-5 text-emerald-600" />
                            ) : (
                                <Archive className="w-5 h-5 text-gray-600" />
                            )}
                        </motion.div>
                        <AlertDialogTitle>
                            {archived ? "Restore" : "Archive"} {clientName}?
                        </AlertDialogTitle>
                    </div>
                    <AlertDialogDescription>
                        {archived
                            ? "This client moves back into the active client list. Nothing else changes — their access stays exactly as it is now."
                            : "This hides the client from the client list and the onboarding queue. Nothing is deleted, and you can restore them any time from the Archived tab."}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {stillLive && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                            This client is still <strong>enabled</strong> — archiving does not cut
                            off their dashboard, calls, or billing. Disable them first if that is
                            what you want.
                        </span>
                    </div>
                )}

                {error && (
                    <p className="text-xs text-red-600" role="alert">
                        {error}
                    </p>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            // Keep the dialog mounted while the action runs so the
                            // spinner (and any error) is actually visible.
                            e.preventDefault();
                            handleToggle();
                        }}
                        disabled={loading}
                        className={
                            archived
                                ? "bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-600"
                                : "bg-gray-900 hover:bg-gray-800 focus-visible:ring-gray-900"
                        }
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                        {archived ? "Restore Client" : "Archive Client"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
