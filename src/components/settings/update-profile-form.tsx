"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";

interface UpdateProfileFormProps {
    currentName: string;
    currentEmail: string;
    updateProfile: (formData: FormData) => Promise<void>;
}

export function UpdateProfileForm({ currentName, currentEmail, updateProfile }: UpdateProfileFormProps) {
    const [name, setName] = useState(currentName);
    const [email, setEmail] = useState(currentEmail);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const hasChanges = name !== currentName || email !== currentEmail;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaved(false);

        const formData = new FormData();
        formData.set("name", name);
        formData.set("email", email);

        await updateProfile(formData);
        setIsSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Display Name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    placeholder="Your name or company name"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address
                </label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                    placeholder="your@email.com"
                />
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
                            Save Changes
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
