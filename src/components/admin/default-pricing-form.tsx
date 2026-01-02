"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";

interface DefaultPricingFormProps {
    currentPrice: number;
    currentCost: number;
    updatePricing: (formData: FormData) => Promise<void>;
}

export function DefaultPricingForm({ currentPrice, currentCost, updatePricing }: DefaultPricingFormProps) {
    const [price, setPrice] = useState(currentPrice.toString());
    const [cost, setCost] = useState(currentCost.toString());
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const priceNum = parseFloat(price) || 0;
    const costNum = parseFloat(cost) || 0;
    const margin = priceNum - costNum;
    const marginPercent = costNum > 0 ? ((margin / costNum) * 100).toFixed(0) : 0;

    const hasChanges = price !== currentPrice.toString() || cost !== currentCost.toString();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaved(false);

        const formData = new FormData();
        formData.set("defaultPrice", price);
        formData.set("defaultCost", cost);

        await updatePricing(formData);
        setIsSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Default Price Per Minute
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                        />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">What you charge clients</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Default Cost Per Minute
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cost}
                            onChange={(e) => setCost(e.target.value)}
                            className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                        />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Your cost (Vapi)</p>
                </div>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                    Margin: <span className="font-semibold text-green-600">${margin.toFixed(2)}/min</span>
                    <span className="text-gray-400 ml-2">({marginPercent}% profit)</span>
                </p>
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    disabled={!hasChanges || isSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save Defaults
                        </>
                    )}
                </button>
                {saved && (
                    <span className="text-sm text-green-600">✓ Saved successfully</span>
                )}
            </div>
        </form>
    );
}
