"use client";

import { useState } from "react";
import { Save, Loader2, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fadeIn } from "@/lib/settings-animations";

interface UpdateVapiKeyFormProps {
    currentKey: string;
    updateVapiKey: (formData: FormData) => Promise<void>;
}

export function UpdateVapiKeyForm({ currentKey, updateVapiKey }: UpdateVapiKeyFormProps) {
    const [vapiKey, setVapiKey] = useState(currentKey);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const hasChanges = vapiKey !== currentKey;
    const hasKey = vapiKey && vapiKey.length > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaved(false);

        const formData = new FormData();
        formData.set("vapiKey", vapiKey);

        await updateVapiKey(formData);
        setIsSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <Label htmlFor="vapi-key" className="mb-1.5 block">
                    API Key
                </Label>
                <div className="relative">
                    <Input
                        id="vapi-key"
                        type={showKey ? "text" : "password"}
                        value={vapiKey}
                        onChange={(e) => setVapiKey(e.target.value)}
                        className="pr-10 font-mono"
                        placeholder="Enter your Vapi API key"
                    />
                    <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                    Get your API key from the <a href="https://dashboard.vapi.ai" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline">Vapi Dashboard</a>
                </p>
            </div>

            {!hasKey && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-800">
                        No API key configured. Your agents will use the platform&apos;s default key.
                    </p>
                </div>
            )}

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={!hasChanges || isSaving}>
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            Save API Key
                        </>
                    )}
                </Button>
                <AnimatePresence>
                    {saved && (
                        <motion.span
                            variants={fadeIn}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="text-sm text-green-600"
                        >
                            Saved successfully
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>
        </form>
    );
}
