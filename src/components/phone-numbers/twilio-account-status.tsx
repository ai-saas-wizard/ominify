"use client";

import { useState, useCallback } from "react";
import { Server, Unplug, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { disconnectTwilioAccount } from "@/app/actions/twilio-actions";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
    twilioAccount: any;
    activeNumberCount: number;
}

export function TwilioAccountStatus({ clientId, twilioAccount, activeNumberCount }: Props) {
    const router = useRouter();
    const [disconnecting, setDisconnecting] = useState(false);
    const [error, setError] = useState("");

    const isBYOT = twilioAccount.account_type === "type_a_byoa";
    const displaySid = isBYOT
        ? twilioAccount.external_account_sid
        : twilioAccount.subaccount_sid;
    const maskedSid = isBYOT && displaySid
        ? `${displaySid.slice(0, 6)}...${displaySid.slice(-4)}`
        : displaySid;

    const handleDisconnect = useCallback(async () => {
        setDisconnecting(true);
        setError("");
        try {
            const result = await disconnectTwilioAccount(clientId);
            if (!result.success) {
                setError(result.error || "Failed to disconnect");
            } else {
                router.refresh();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDisconnecting(false);
        }
    }, [clientId, router]);

    return (
        <Card>
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-xl ${isBYOT ? "bg-blue-100" : "bg-emerald-100"}`}>
                            <Server className={`w-5 h-5 ${isBYOT ? "text-blue-600" : "text-emerald-600"}`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-0.5">
                                <h3 className="font-semibold text-gray-900">Twilio Account</h3>
                                <Badge className={isBYOT
                                    ? "bg-blue-100 text-blue-700 border-blue-200"
                                    : "bg-emerald-100 text-emerald-700 border-emerald-200"
                                }>
                                    {isBYOT ? "BYOT" : "Managed"}
                                </Badge>
                                <Badge className="bg-green-100 text-green-700 border-green-200">
                                    Active
                                </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                <span className="font-mono">{maskedSid}</span>
                                {twilioAccount.friendly_name && (
                                    <>
                                        <span className="text-gray-300">|</span>
                                        <span>{twilioAccount.friendly_name}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-red-600"
                                disabled={disconnecting}
                            >
                                {disconnecting ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Unplug className="w-4 h-4" />
                                )}
                                Disconnect
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Disconnect Twilio Account</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {activeNumberCount > 0 ? (
                                        <>
                                            You have {activeNumberCount} active phone number
                                            {activeNumberCount !== 1 ? "s" : ""}. Please release
                                            all phone numbers before disconnecting.
                                        </>
                                    ) : (
                                        <>
                                            This will remove your Twilio account connection and any
                                            A2P registration progress. This action cannot be undone.
                                        </>
                                    )}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                {activeNumberCount === 0 && (
                                    <AlertDialogAction
                                        onClick={handleDisconnect}
                                        className="bg-red-600 hover:bg-red-700 text-white"
                                    >
                                        Disconnect
                                    </AlertDialogAction>
                                )}
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>

                {error && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {error}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
