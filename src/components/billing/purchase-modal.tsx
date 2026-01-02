"use client";

import { useState } from "react";
import { ShoppingCart, Loader2, X } from "lucide-react";

interface PurchaseModalProps {
    clientId: string;
    email: string;
    pricePerMinute: number;
}

export function PurchaseModal({ clientId, email, pricePerMinute }: PurchaseModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [minutes, setMinutes] = useState("100");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const totalPrice = parseInt(minutes || "0") * pricePerMinute;

    const handlePurchase = async () => {
        const mins = parseInt(minutes);
        if (!mins || mins <= 0) return;

        setIsLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId,
                    email,
                    minutes: mins,
                    pricePerMinute,
                    successUrl: `${window.location.origin}/client/${clientId}/billing?success=true`,
                    cancelUrl: `${window.location.origin}/client/${clientId}/billing?canceled=true`,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to create checkout session');
            }

            // Redirect to Stripe Checkout
            window.location.href = data.url;
        } catch (err: any) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    const quickOptions = [50, 100, 250, 500, 1000];

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="inline-flex items-center gap-2 bg-white text-violet-600 px-6 py-3 rounded-lg font-semibold hover:bg-violet-50 transition-colors shadow-md"
            >
                <ShoppingCart className="w-5 h-5" />
                Buy Minutes
            </button>

            {isOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-gray-200">
                            <h2 className="text-xl font-bold text-gray-900">Purchase Minutes</h2>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            <div>
                                <p className="text-sm text-gray-500 mb-3">Your rate:</p>
                                <p className="text-3xl font-bold text-gray-900">${pricePerMinute.toFixed(2)}<span className="text-lg font-normal text-gray-500">/min</span></p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    How many minutes?
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={minutes}
                                    onChange={(e) => setMinutes(e.target.value)}
                                    className="w-full px-4 py-3 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                                    placeholder="Enter minutes"
                                />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {quickOptions.map((opt) => (
                                    <button
                                        key={opt}
                                        onClick={() => setMinutes(opt.toString())}
                                        className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${minutes === opt.toString()
                                                ? 'border-violet-600 bg-violet-50 text-violet-700'
                                                : 'border-gray-200 hover:border-violet-300 text-gray-600'
                                            }`}
                                    >
                                        {opt} mins
                                    </button>
                                ))}
                            </div>

                            {parseInt(minutes) > 0 && (
                                <div className="p-4 bg-gray-50 rounded-xl">
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-600">Total</span>
                                        <span className="text-2xl font-bold text-gray-900">
                                            ${totalPrice.toFixed(2)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {minutes} minutes × ${pricePerMinute.toFixed(2)}/min
                                    </p>
                                </div>
                            )}

                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                                    {error}
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
                            <button
                                onClick={handlePurchase}
                                disabled={!minutes || parseInt(minutes) <= 0 || isLoading}
                                className="w-full bg-violet-600 text-white py-3 rounded-lg font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <ShoppingCart className="w-5 h-5" />
                                        Pay ${totalPrice.toFixed(2)}
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
