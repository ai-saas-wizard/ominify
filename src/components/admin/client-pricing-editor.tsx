"use client";

import { useState } from "react";
import { Edit2, Check, X } from "lucide-react";

interface ClientPricingEditorProps {
    clientId: string;
    currentPrice: number;
    currentCost: number;
    updatePricing: (formData: FormData) => Promise<void>;
}

export function ClientPricingEditor({
    clientId,
    currentPrice,
    currentCost,
    updatePricing
}: ClientPricingEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [price, setPrice] = useState(currentPrice.toString());
    const [cost, setCost] = useState(currentCost.toString());
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        const formData = new FormData();
        formData.set("clientId", clientId);
        formData.set("pricePerMinute", price);
        formData.set("costPerMinute", cost);

        await updatePricing(formData);
        setIsEditing(false);
        setIsSaving(false);
    };

    const handleCancel = () => {
        setPrice(currentPrice.toString());
        setCost(currentCost.toString());
        setIsEditing(false);
    };

    if (!isEditing) {
        return (
            <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700 font-medium"
            >
                <Edit2 className="w-4 h-4" />
                Edit
            </button>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">$</span>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    placeholder="Price"
                />
            </div>
            <span className="text-gray-400">/</span>
            <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">$</span>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    placeholder="Cost"
                />
            </div>
            <button
                onClick={handleSave}
                disabled={isSaving}
                className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
            >
                <Check className="w-4 h-4" />
            </button>
            <button
                onClick={handleCancel}
                disabled={isSaving}
                className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
