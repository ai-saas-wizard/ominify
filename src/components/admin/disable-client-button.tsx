"use client";

import { useState } from "react";
import { toggleClientDisabled } from "@/app/actions/client-actions";
import { ShieldOff, ShieldCheck, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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

export function DisableClientButton({
    clientId,
    clientName,
    disabled,
}: {
    clientId: string;
    clientName: string;
    disabled: boolean;
}) {
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    async function handleToggle() {
        setLoading(true);
        try {
            await toggleClientDisabled(clientId, !disabled);
        } catch (err) {
            console.error("Failed to toggle client:", err);
        } finally {
            setLoading(false);
            setOpen(false);
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <TooltipProvider delayDuration={300}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <AlertDialogTrigger asChild>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                                    disabled
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                        : "border-gray-200 bg-white text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                }`}
                            >
                                {disabled ? (
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                ) : (
                                    <ShieldOff className="w-3.5 h-3.5" />
                                )}
                                {disabled ? "Enable" : "Disable"}
                            </motion.button>
                        </AlertDialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        {disabled ? "Re-enable client access" : "Disable client access"}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <AlertDialogContent>
                <AlertDialogHeader>
                    <div className="flex items-center gap-3 mb-1">
                        <motion.div
                            initial={{ scale: 0, rotate: -180 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: "spring", stiffness: 260, damping: 20 }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                disabled ? "bg-emerald-100" : "bg-red-100"
                            }`}
                        >
                            {disabled ? (
                                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                            ) : (
                                <ShieldOff className="w-5 h-5 text-red-600" />
                            )}
                        </motion.div>
                        <AlertDialogTitle>
                            {disabled ? "Enable" : "Disable"} {clientName}?
                        </AlertDialogTitle>
                    </div>
                    <AlertDialogDescription>
                        {disabled
                            ? "This will restore access to the dashboard for all members of this client account."
                            : "This will block all non-admin users from accessing this client\u2019s dashboard. You can re-enable access at any time."}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleToggle}
                        disabled={loading}
                        className={
                            disabled
                                ? "bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-600"
                                : "bg-red-600 hover:bg-red-500 focus-visible:ring-red-600"
                        }
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : null}
                        {disabled ? "Enable Client" : "Disable Client"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
