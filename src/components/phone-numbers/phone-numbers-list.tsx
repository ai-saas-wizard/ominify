"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Phone,
    Plus,
    Search,
    Trash2,
    Loader2,
    XCircle,
    Shield,
    MessageSquare,
    PhoneCall,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { fadeIn, expandCollapse, staggerContainer, staggerItem } from "@/lib/settings-animations";
import {
    searchAvailableNumbers,
    purchasePhoneNumberForClient,
    releasePhoneNumberForClient,
} from "@/app/actions/twilio-actions";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
    initialPhoneNumbers: any[];
    agentMap: Record<string, string>;
    isBYOT: boolean;
}

export function PhoneNumbersList({
    clientId,
    initialPhoneNumbers,
    agentMap,
    isBYOT,
}: Props) {
    const router = useRouter();
    const [phoneNumbers, setPhoneNumbers] = useState(initialPhoneNumbers);

    // Purchase flow
    const [showSearch, setShowSearch] = useState(false);
    const [areaCode, setAreaCode] = useState("");
    const [searching, setSearching] = useState(false);
    const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
    const [purchasing, setPurchasing] = useState<string | null>(null);
    const [releasing, setReleasing] = useState<string | null>(null);

    // Payment
    const [paymentRequired, setPaymentRequired] = useState(false);
    const [paymentMessage, setPaymentMessage] = useState("");

    const activeNumberCount = phoneNumbers.filter((n: any) => n.status === "active").length;
    const freeNumbersRemaining = isBYOT ? null : Math.max(0, 2 - activeNumberCount);

    const handleSearch = useCallback(async () => {
        setSearching(true);
        try {
            const result = await searchAvailableNumbers(areaCode || undefined, undefined, clientId);
            setAvailableNumbers(result.numbers || []);
        } catch (err) {
            console.error("Search error:", err);
        } finally {
            setSearching(false);
        }
    }, [areaCode, clientId]);

    const handlePurchase = useCallback(async (phoneNumber: string) => {
        setPurchasing(phoneNumber);
        try {
            const result = await purchasePhoneNumberForClient(clientId, phoneNumber);
            if (result.success) {
                setAvailableNumbers((prev) =>
                    prev.filter((n) => n.phoneNumber !== phoneNumber)
                );
                router.refresh();
            } else if (result.error === "PAYMENT_REQUIRED") {
                setPaymentRequired(true);
                setPaymentMessage((result as any).message || "Additional numbers require payment.");
                setShowSearch(false);
            } else {
                alert(result.error || "Failed to purchase number");
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setPurchasing(null);
        }
    }, [clientId, router]);

    const handleRelease = useCallback(async (phoneNumberId: string) => {
        if (!confirm("Are you sure you want to release this phone number? This cannot be undone.")) return;
        setReleasing(phoneNumberId);
        try {
            const result = await releasePhoneNumberForClient(clientId, phoneNumberId);
            if (result.success) {
                setPhoneNumbers((prev) => prev.filter((n) => n.id !== phoneNumberId));
            } else {
                alert(result.error || "Failed to release number");
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setReleasing(null);
        }
    }, [clientId]);

    return (
        <Card>
            <CardHeader className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 rounded-lg">
                            <Phone className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Your Numbers</h2>
                            <p className="text-sm text-gray-500">
                                {activeNumberCount} number{activeNumberCount !== 1 ? "s" : ""} active
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {freeNumbersRemaining !== null && (
                            <Badge variant="secondary" className="text-xs">
                                {freeNumbersRemaining > 0
                                    ? `${freeNumbersRemaining} free remaining`
                                    : "Free limit reached"}
                            </Badge>
                        )}
                        <Button
                            size="sm"
                            onClick={() => {
                                if (!isBYOT && activeNumberCount >= 2) {
                                    setPaymentRequired(true);
                                    setPaymentMessage("You've used your 2 free numbers. Additional numbers cost $10 each.");
                                } else {
                                    setShowSearch(!showSearch);
                                    setPaymentRequired(false);
                                }
                            }}
                        >
                            <Plus className="w-4 h-4" />
                            Purchase Number
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-0">
                {/* Phone Numbers Table */}
                {phoneNumbers.length > 0 ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Phone Number</TableHead>
                                <TableHead>Friendly Name</TableHead>
                                <TableHead>Agent</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Capabilities</TableHead>
                                <TableHead>Added</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {phoneNumbers.map((number: any) => (
                                <TableRow key={number.id}>
                                    <TableCell className="font-mono font-medium">
                                        {number.phone_number}
                                    </TableCell>
                                    <TableCell className="text-gray-500">
                                        {number.friendly_name || "\u2014"}
                                    </TableCell>
                                    <TableCell>
                                        {number.agent_id && agentMap[number.agent_id] ? (
                                            <Badge>{agentMap[number.agent_id]}</Badge>
                                        ) : (
                                            <span className="text-xs text-gray-400">Unassigned</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            className={
                                                number.status === "active"
                                                    ? "bg-green-100 text-green-700 border-green-200"
                                                    : "bg-gray-100 text-gray-600 border-gray-200"
                                            }
                                        >
                                            {number.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5">
                                            {number.capabilities?.sms && (
                                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded-md border border-green-100">
                                                    <MessageSquare className="w-3 h-3" />
                                                    SMS
                                                </span>
                                            )}
                                            {number.capabilities?.voice && (
                                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md border border-blue-100">
                                                    <PhoneCall className="w-3 h-3" />
                                                    Voice
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-xs text-gray-400">
                                        {new Date(number.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRelease(number.id)}
                                            disabled={releasing === number.id}
                                            className="text-gray-400 hover:text-red-600"
                                            title="Release number"
                                        >
                                            {releasing === number.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-4 h-4" />
                                            )}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <div className="text-center py-12 px-6">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
                            <Phone className="w-6 h-6 text-gray-400" />
                        </div>
                        <p className="text-gray-500 text-sm font-medium">No phone numbers yet</p>
                        <p className="text-gray-400 text-xs mt-1">Purchase one to get started with SMS and voice</p>
                    </div>
                )}

                {/* Payment Required Banner */}
                <AnimatePresence>
                    {paymentRequired && (
                        <motion.div
                            variants={fadeIn}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="mx-6 mb-6 mt-4 border border-amber-200 bg-amber-50 rounded-lg p-4"
                        >
                            <div className="flex items-start gap-3">
                                <div className="p-1.5 bg-amber-100 rounded-lg shrink-0">
                                    <Shield className="w-4 h-4 text-amber-600" />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium text-amber-900 text-sm">
                                        Additional Numbers \u2014 $10 each
                                    </h4>
                                    <p className="text-sm text-amber-700 mt-1">{paymentMessage}</p>
                                    <p className="text-xs text-amber-600 mt-2">
                                        Stripe payment integration coming soon. Contact support to purchase additional numbers.
                                    </p>
                                </div>
                                <button
                                    onClick={() => setPaymentRequired(false)}
                                    className="text-amber-400 hover:text-amber-600"
                                >
                                    <XCircle className="w-4 h-4" />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Purchase Number Search */}
                <AnimatePresence>
                    {showSearch && (
                        <motion.div
                            variants={expandCollapse}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="border-t border-gray-200"
                        >
                            <div className="p-6 space-y-4">
                                <h3 className="font-medium text-gray-900">Search Available Numbers</h3>
                                <div className="flex items-center gap-3">
                                    <Input
                                        placeholder="Area code (e.g. 415)"
                                        value={areaCode}
                                        onChange={(e) => setAreaCode(e.target.value)}
                                        className="max-w-[200px] font-mono"
                                    />
                                    <Button
                                        variant="secondary"
                                        onClick={handleSearch}
                                        disabled={searching}
                                    >
                                        {searching ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Search className="w-4 h-4" />
                                        )}
                                        {searching ? "Searching..." : "Search"}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setShowSearch(false);
                                            setAvailableNumbers([]);
                                            setAreaCode("");
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                </div>

                                <AnimatePresence>
                                    {availableNumbers.length > 0 && (
                                        <motion.div
                                            variants={staggerContainer}
                                            initial="hidden"
                                            animate="show"
                                            className="space-y-2 max-h-[300px] overflow-y-auto"
                                        >
                                            {availableNumbers.map((number: any) => (
                                                <motion.div
                                                    key={number.phoneNumber}
                                                    variants={staggerItem}
                                                    className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-emerald-200 transition-colors"
                                                >
                                                    <div>
                                                        <p className="font-mono font-medium text-gray-900">
                                                            {number.phoneNumber}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {number.locality}, {number.region}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handlePurchase(number.phoneNumber)}
                                                        disabled={purchasing === number.phoneNumber}
                                                    >
                                                        {purchasing === number.phoneNumber ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Plus className="w-3 h-3" />
                                                        )}
                                                        {purchasing === number.phoneNumber ? "Purchasing..." : "Purchase"}
                                                    </Button>
                                                </motion.div>
                                            ))}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </CardContent>
        </Card>
    );
}
