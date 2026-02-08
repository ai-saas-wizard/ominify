"use client";

import { useState } from "react";
import {
    Phone,
    Plus,
    Search,
    Trash2,
    CheckCircle2,
    XCircle,
    Server,
    Shield,
    Loader2,
} from "lucide-react";
import {
    provisionTwilioSubaccount,
    searchAvailableNumbers,
    purchasePhoneNumberForClient,
    releasePhoneNumberForClient,
} from "@/app/actions/twilio-actions";
import { A2PStatusCard } from "./a2p-status-card";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
    clientName: string;
    twilioAccount: any;
    initialPhoneNumbers: any[];
    a2pRegistration: any;
}

export function PhoneNumbersManager({
    clientId,
    clientName,
    twilioAccount,
    initialPhoneNumbers,
    a2pRegistration,
}: Props) {
    const router = useRouter();
    const [phoneNumbers, setPhoneNumbers] = useState(initialPhoneNumbers);
    const [provisioning, setProvisioning] = useState(false);
    const [provisionError, setProvisionError] = useState("");

    // Purchase flow
    const [showSearch, setShowSearch] = useState(false);
    const [areaCode, setAreaCode] = useState("");
    const [searching, setSearching] = useState(false);
    const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
    const [purchasing, setPurchasing] = useState<string | null>(null);
    const [releasing, setReleasing] = useState<string | null>(null);

    async function handleProvision() {
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
    }

    async function handleSearch() {
        setSearching(true);
        try {
            const result = await searchAvailableNumbers(areaCode || undefined);
            setAvailableNumbers(result.numbers || []);
        } catch (err) {
            console.error("Search error:", err);
        } finally {
            setSearching(false);
        }
    }

    async function handlePurchase(phoneNumber: string) {
        setPurchasing(phoneNumber);
        try {
            const result = await purchasePhoneNumberForClient(clientId, phoneNumber);
            if (result.success) {
                setAvailableNumbers((prev) =>
                    prev.filter((n) => n.phoneNumber !== phoneNumber)
                );
                router.refresh();
            } else {
                alert(result.error || "Failed to purchase number");
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setPurchasing(null);
        }
    }

    async function handleRelease(phoneNumberId: string) {
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
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Phone className="w-6 h-6 text-violet-600" />
                    Phone Numbers
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                    Manage your Twilio phone numbers and A2P 10DLC compliance
                </p>
            </div>

            {/* Twilio Account Status */}
            <div className="bg-white rounded-xl border shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-indigo-100 rounded-lg">
                        <Server className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-gray-900">Twilio Subaccount</h2>
                        <p className="text-sm text-gray-500">
                            Your isolated Twilio subaccount for SMS and voice
                        </p>
                    </div>
                </div>

                {twilioAccount ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-green-50 rounded-lg p-3">
                            <p className="text-xs text-green-600 font-medium">Status</p>
                            <p className="text-sm font-semibold text-green-700 flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4" />
                                Provisioned
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500 font-medium">Subaccount SID</p>
                            <p className="text-sm font-mono text-gray-700 truncate">
                                {twilioAccount.subaccount_sid}
                            </p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500 font-medium">Friendly Name</p>
                            <p className="text-sm text-gray-700 truncate">
                                {twilioAccount.friendly_name}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-6">
                        <Server className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500 text-sm mb-4">
                            No Twilio subaccount provisioned yet. Provision one to start using SMS and voice.
                        </p>
                        {provisionError && (
                            <p className="text-red-600 text-sm mb-3">{provisionError}</p>
                        )}
                        <button
                            onClick={handleProvision}
                            disabled={provisioning}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                            {provisioning ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Plus className="w-4 h-4" />
                            )}
                            {provisioning ? "Provisioning..." : "Provision Twilio Subaccount"}
                        </button>
                    </div>
                )}
            </div>

            {/* Phone Numbers List */}
            {twilioAccount && (
                <div className="bg-white rounded-xl border shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-violet-100 rounded-lg">
                                <Phone className="w-5 h-5 text-violet-600" />
                            </div>
                            <div>
                                <h2 className="font-semibold text-gray-900">Your Numbers</h2>
                                <p className="text-sm text-gray-500">
                                    {phoneNumbers.length} number{phoneNumbers.length !== 1 ? "s" : ""} active
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowSearch(!showSearch)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm"
                        >
                            <Plus className="w-4 h-4" />
                            Purchase Number
                        </button>
                    </div>

                    {/* Phone Numbers Table */}
                    {phoneNumbers.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-gray-500 border-b">
                                        <th className="pb-2 pr-4 font-medium">Phone Number</th>
                                        <th className="pb-2 pr-4 font-medium">Friendly Name</th>
                                        <th className="pb-2 pr-4 font-medium">Status</th>
                                        <th className="pb-2 pr-4 font-medium">Capabilities</th>
                                        <th className="pb-2 pr-4 font-medium">Added</th>
                                        <th className="pb-2 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {phoneNumbers.map((number: any) => (
                                        <tr key={number.id} className="text-gray-700">
                                            <td className="py-3 pr-4 font-mono font-medium">
                                                {number.phone_number}
                                            </td>
                                            <td className="py-3 pr-4 text-gray-500">
                                                {number.friendly_name || "—"}
                                            </td>
                                            <td className="py-3 pr-4">
                                                <span
                                                    className={`text-xs px-2 py-0.5 rounded-full ${
                                                        number.status === "active"
                                                            ? "bg-green-100 text-green-700"
                                                            : "bg-gray-100 text-gray-600"
                                                    }`}
                                                >
                                                    {number.status}
                                                </span>
                                            </td>
                                            <td className="py-3 pr-4">
                                                <div className="flex items-center gap-1">
                                                    {number.capabilities?.sms && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-green-50 text-green-600 rounded">
                                                            SMS
                                                        </span>
                                                    )}
                                                    {number.capabilities?.voice && (
                                                        <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                                                            Voice
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 pr-4 text-xs text-gray-400">
                                                {new Date(number.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-3">
                                                <button
                                                    onClick={() => handleRelease(number.id)}
                                                    disabled={releasing === number.id}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 rounded transition-colors disabled:opacity-50"
                                                    title="Release number"
                                                >
                                                    {releasing === number.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-4 h-4" />
                                                    )}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-center py-6 text-gray-400">
                            <Phone className="w-8 h-8 mx-auto mb-2" />
                            <p className="text-sm">No phone numbers yet. Purchase one to get started.</p>
                        </div>
                    )}

                    {/* Purchase Number Search */}
                    {showSearch && (
                        <div className="mt-4 border-t pt-4">
                            <h3 className="font-medium text-gray-900 mb-3">Search Available Numbers</h3>
                            <div className="flex items-center gap-3 mb-4">
                                <input
                                    type="text"
                                    placeholder="Area code (e.g. 415)"
                                    value={areaCode}
                                    onChange={(e) => setAreaCode(e.target.value)}
                                    className="flex-1 max-w-[200px] px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                />
                                <button
                                    onClick={handleSearch}
                                    disabled={searching}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm disabled:opacity-50"
                                >
                                    {searching ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Search className="w-4 h-4" />
                                    )}
                                    {searching ? "Searching..." : "Search"}
                                </button>
                            </div>

                            {availableNumbers.length > 0 && (
                                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                    {availableNumbers.map((number: any) => (
                                        <div
                                            key={number.phoneNumber}
                                            className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg"
                                        >
                                            <div>
                                                <p className="font-mono font-medium text-gray-900">
                                                    {number.phoneNumber}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {number.locality}, {number.region}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handlePurchase(number.phoneNumber)}
                                                disabled={purchasing === number.phoneNumber}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-xs disabled:opacity-50"
                                            >
                                                {purchasing === number.phoneNumber ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    <Plus className="w-3 h-3" />
                                                )}
                                                {purchasing === number.phoneNumber ? "Purchasing..." : "Purchase"}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* A2P 10DLC Status */}
            {twilioAccount && (
                <A2PStatusCard
                    clientId={clientId}
                    a2pRegistration={a2pRegistration}
                />
            )}
        </div>
    );
}
