"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";

interface AddMinutesModalProps {
    clientId: string;
    clientName: string;
    currentBalance: number;
    addMinutes: (formData: FormData) => Promise<void>;
}

export function AddMinutesModal({
    clientId,
    clientName,
    currentBalance,
    addMinutes
}: AddMinutesModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [minutes, setMinutes] = useState("");
    const [reason, setReason] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async () => {
        if (!minutes || parseInt(minutes) <= 0) return;

        setIsSaving(true);
        const formData = new FormData();
        formData.set("clientId", clientId);
        formData.set("minutes", minutes);
        formData.set("reason", reason);

        await addMinutes(formData);
        setIsOpen(false);
        setMinutes("");
        setReason("");
        setIsSaving(false);
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-medium"
            >
                <Plus className="w-4 h-4" />
                Add
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl max-w-md w-full shadow-2xl">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-lg font-bold text-gray-900">Add Minutes</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Manually add minutes to {clientName}'s balance
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Current Balance
                                </label>
                                <p className="text-2xl font-bold text-gray-900">
                                    {currentBalance.toFixed(0)} <span className="text-sm font-normal text-gray-500">minutes</span>
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Minutes to Add
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={minutes}
                                    onChange={(e) => setMinutes(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                                    placeholder="Enter amount"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Reason (optional)
                                </label>
                                <input
                                    type="text"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                                    placeholder="e.g., Bonus, Refund, Promo"
                                />
                            </div>

                            {minutes && parseInt(minutes) > 0 && (
                                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                    <p className="text-sm text-green-700">
                                        New balance will be: <strong>{currentBalance + parseInt(minutes)} minutes</strong>
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-gray-200 flex gap-3 justify-end bg-gray-50 rounded-b-xl">
                            <button
                                onClick={() => setIsOpen(false)}
                                disabled={isSaving}
                                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={!minutes || parseInt(minutes) <= 0 || isSaving}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Adding...
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-4 h-4" />
                                        Add Minutes
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
