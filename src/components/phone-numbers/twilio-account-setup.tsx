"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Server,
    KeyRound,
    Plus,
    Loader2,
    CheckCircle2,
    XCircle,
    ArrowRight,
    ShieldCheck,
    Zap,
    Clock,
} from "lucide-react";

const COMING_SOON_MANAGED_TWILIO = true;
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fadeIn } from "@/lib/settings-animations";
import {
    provisionTwilioSubaccount,
    connectExternalTwilioAccount,
    validateTwilioCredentialsAction,
} from "@/app/actions/twilio-actions";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
}

export function TwilioAccountSetup({ clientId }: Props) {
    const router = useRouter();
    const [mode, setMode] = useState<"choice" | "provision" | "byot">("choice");

    // Provision state
    const [provisioning, setProvisioning] = useState(false);
    const [provisionError, setProvisionError] = useState("");

    // BYOT state
    const [accountSid, setAccountSid] = useState("");
    const [authToken, setAuthToken] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);
    const [validated, setValidated] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState("");

    const handleProvision = useCallback(async () => {
        setProvisioning(true);
        setProvisionError("");
        try {
            const result = await provisionTwilioSubaccount(clientId);
            if (!result.success) {
                setProvisionError(result.error || "Failed to provision");
            } else {
                router.refresh();
            }
        } catch (err: any) {
            setProvisionError(err.message);
        } finally {
            setProvisioning(false);
        }
    }, [clientId, router]);

    const handleTestConnection = useCallback(async () => {
        if (!accountSid.trim() || !authToken.trim()) return;

        // Pre-validate SID format
        if (!accountSid.startsWith("AC") || accountSid.length !== 34) {
            setTestResult({
                type: "error",
                message: "Account SID must start with 'AC' and be 34 characters long",
            });
            return;
        }

        setTesting(true);
        setTestResult(null);
        setValidated(false);
        try {
            const result = await validateTwilioCredentialsAction(accountSid.trim(), authToken.trim());
            if (result.valid) {
                setTestResult({
                    type: "success",
                    message: `Connected! Account: ${result.friendlyName}`,
                });
                setValidated(true);
            } else {
                setTestResult({
                    type: "error",
                    message: result.error || "Invalid credentials",
                });
            }
        } catch (err: any) {
            setTestResult({ type: "error", message: err.message });
        } finally {
            setTesting(false);
        }
    }, [accountSid, authToken]);

    const handleConnect = useCallback(async () => {
        setConnecting(true);
        setConnectError("");
        try {
            const result = await connectExternalTwilioAccount(
                clientId,
                accountSid.trim(),
                authToken.trim()
            );
            if (!result.success) {
                setConnectError(result.error || "Failed to connect");
            } else {
                router.refresh();
            }
        } catch (err: any) {
            setConnectError(err.message);
        } finally {
            setConnecting(false);
        }
    }, [clientId, accountSid, authToken, router]);

    // Reset validation when credentials change
    const handleSidChange = (val: string) => {
        setAccountSid(val);
        setValidated(false);
        setTestResult(null);
    };
    const handleTokenChange = (val: string) => {
        setAuthToken(val);
        setValidated(false);
        setTestResult(null);
    };

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 rounded-lg">
                        <Server className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                            Connect Twilio Account
                        </h2>
                        <p className="text-sm text-gray-500">
                            Choose how you want to manage your phone numbers
                        </p>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-6">
                <AnimatePresence mode="wait">
                    {mode === "choice" && (
                        <motion.div
                            key="choice"
                            variants={fadeIn}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="grid grid-cols-1 md:grid-cols-2 gap-4"
                        >
                            {/* Option 1: Managed by Omnify */}
                            {COMING_SOON_MANAGED_TWILIO ? (
                                <div
                                    aria-disabled="true"
                                    className="text-left border-2 border-gray-200 rounded-xl p-6 bg-gray-50 opacity-60 cursor-not-allowed"
                                >
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2.5 bg-emerald-100 rounded-xl">
                                            <ShieldCheck className="w-5 h-5 text-emerald-600" />
                                        </div>
                                        <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1.5">
                                            <Clock className="w-3.5 h-3.5" />
                                            Coming soon
                                        </Badge>
                                    </div>
                                    <h3 className="font-semibold text-gray-900 mb-1">
                                        Managed by Omnify
                                    </h3>
                                    <p className="text-sm text-gray-500 mb-4">
                                        We create and manage a Twilio subaccount for you.
                                        No Twilio account needed.
                                    </p>
                                    <div className="flex items-center text-sm text-gray-400 font-medium gap-1">
                                        Available soon
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setMode("provision")}
                                    className="group text-left border-2 border-gray-200 rounded-xl p-6 hover:border-emerald-300 hover:bg-emerald-50/30 transition-all duration-200"
                                >
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2.5 bg-emerald-100 rounded-xl group-hover:bg-emerald-200 transition-colors">
                                            <ShieldCheck className="w-5 h-5 text-emerald-600" />
                                        </div>
                                        <Badge>Recommended</Badge>
                                    </div>
                                    <h3 className="font-semibold text-gray-900 mb-1">
                                        Managed by Omnify
                                    </h3>
                                    <p className="text-sm text-gray-500 mb-4">
                                        We create and manage a Twilio subaccount for you.
                                        No Twilio account needed.
                                    </p>
                                    <div className="flex items-center text-sm text-emerald-600 font-medium gap-1">
                                        Get started
                                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </button>
                            )}

                            {/* Option 2: BYOT */}
                            <button
                                onClick={() => setMode("byot")}
                                className="group text-left border-2 border-gray-200 rounded-xl p-6 hover:border-blue-300 hover:bg-blue-50/30 transition-all duration-200"
                            >
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2.5 bg-blue-100 rounded-xl group-hover:bg-blue-200 transition-colors">
                                        <KeyRound className="w-5 h-5 text-blue-600" />
                                    </div>
                                    {COMING_SOON_MANAGED_TWILIO ? (
                                        <Badge>Recommended</Badge>
                                    ) : (
                                        <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                                            Advanced
                                        </Badge>
                                    )}
                                </div>
                                <h3 className="font-semibold text-gray-900 mb-1">
                                    Bring Your Own Twilio
                                </h3>
                                <p className="text-sm text-gray-500 mb-4">
                                    Connect your existing Twilio account with your
                                    own SID and Auth Token.
                                </p>
                                <div className="flex items-center text-sm text-blue-600 font-medium gap-1">
                                    Connect account
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </button>
                        </motion.div>
                    )}

                    {mode === "provision" && (
                        <motion.div
                            key="provision"
                            variants={fadeIn}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="space-y-4"
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-emerald-100 rounded-lg">
                                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">
                                        Provision Managed Subaccount
                                    </h3>
                                    <p className="text-sm text-gray-500">
                                        We'll create an isolated Twilio subaccount for SMS and voice
                                    </p>
                                </div>
                            </div>

                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                    <Zap className="w-4 h-4 text-emerald-600 mt-0.5" />
                                    <div className="text-sm text-emerald-800">
                                        <p className="font-medium mb-1">What happens next:</p>
                                        <ul className="space-y-1 text-emerald-700">
                                            <li>A dedicated Twilio subaccount is created for you</li>
                                            <li>You can purchase up to 2 phone numbers for free</li>
                                            <li>A2P 10DLC registration is guided step-by-step</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            {provisionError && (
                                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    <XCircle className="w-4 h-4 flex-shrink-0" />
                                    {provisionError}
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <Button
                                    onClick={handleProvision}
                                    disabled={provisioning}
                                >
                                    {provisioning ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Plus className="w-4 h-4" />
                                    )}
                                    {provisioning ? "Provisioning..." : "Provision Subaccount"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setMode("choice");
                                        setProvisionError("");
                                    }}
                                >
                                    Back
                                </Button>
                            </div>
                        </motion.div>
                    )}

                    {mode === "byot" && (
                        <motion.div
                            key="byot"
                            variants={fadeIn}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="space-y-5"
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-100 rounded-lg">
                                    <KeyRound className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">
                                        Connect Your Twilio Account
                                    </h3>
                                    <p className="text-sm text-gray-500">
                                        Enter your Account SID and Auth Token from the{" "}
                                        <a
                                            href="https://console.twilio.com/"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline"
                                        >
                                            Twilio Console
                                        </a>
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="account-sid">Account SID</Label>
                                    <Input
                                        id="account-sid"
                                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        value={accountSid}
                                        onChange={(e) => handleSidChange(e.target.value)}
                                        className="font-mono text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="auth-token">Auth Token</Label>
                                    <Input
                                        id="auth-token"
                                        type="password"
                                        placeholder="Your Twilio Auth Token"
                                        value={authToken}
                                        onChange={(e) => handleTokenChange(e.target.value)}
                                        className="font-mono text-sm"
                                    />
                                </div>
                            </div>

                            {/* Test result */}
                            <AnimatePresence>
                                {testResult && (
                                    <motion.div
                                        variants={fadeIn}
                                        initial="hidden"
                                        animate="show"
                                        exit="exit"
                                        className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${
                                            testResult.type === "success"
                                                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                                : "bg-red-50 border-red-200 text-red-700"
                                        }`}
                                    >
                                        {testResult.type === "success" ? (
                                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                                        ) : (
                                            <XCircle className="w-4 h-4 flex-shrink-0" />
                                        )}
                                        {testResult.message}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {connectError && (
                                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    <XCircle className="w-4 h-4 flex-shrink-0" />
                                    {connectError}
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <Button
                                    variant="outline"
                                    onClick={handleTestConnection}
                                    disabled={testing || !accountSid.trim() || !authToken.trim()}
                                >
                                    {testing ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Zap className="w-4 h-4" />
                                    )}
                                    {testing ? "Testing..." : "Test Connection"}
                                </Button>

                                <Button
                                    onClick={handleConnect}
                                    disabled={!validated || connecting}
                                    className="bg-blue-600 hover:bg-blue-700"
                                >
                                    {connecting ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <ArrowRight className="w-4 h-4" />
                                    )}
                                    {connecting ? "Connecting..." : "Connect Account"}
                                </Button>

                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setMode("choice");
                                        setAccountSid("");
                                        setAuthToken("");
                                        setTestResult(null);
                                        setValidated(false);
                                        setConnectError("");
                                    }}
                                >
                                    Back
                                </Button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </CardContent>
        </Card>
    );
}
