"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";

interface RemoveMemberButtonProps {
    memberId: string;
    removeMember: (formData: FormData) => Promise<void>;
}

export function RemoveMemberButton({ memberId, removeMember }: RemoveMemberButtonProps) {
    const [isRemoving, setIsRemoving] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const handleRemove = async () => {
        setIsRemoving(true);
        const formData = new FormData();
        formData.set("memberId", memberId);
        await removeMember(formData);
        setIsRemoving(false);
        setShowConfirm(false);
    };

    if (showConfirm) {
        return (
            <div className="flex items-center gap-2">
                <button
                    onClick={handleRemove}
                    disabled={isRemoving}
                    className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                    {isRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm"}
                </button>
                <button
                    onClick={() => setShowConfirm(false)}
                    disabled={isRemoving}
                    className="text-sm text-gray-500 hover:text-gray-700"
                >
                    Cancel
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => setShowConfirm(true)}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
            <Trash2 className="w-4 h-4" />
        </button>
    );
}
