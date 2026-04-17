"use client";

// NOTE: This component is currently unused. It previously accepted the full
// plaintext VAPI key as a `currentKey` prop and rendered it (via a Show/Hide
// toggle) into the DOM and React state — meaning the key landed in the browser
// bundle, React DevTools, and any rehydration payload. It has been rewritten
// to mirror the admin `umbrella-settings-card.tsx` pattern:
//
//   1. The raw key is NEVER passed in as a prop.
//   2. Display is a masked preview (`••••last4`) derived server-side from the
//      decrypted key.
//   3. Edit flow starts from an empty password input; user pastes a new key,
//      which is sent to a server action that encrypts it before storing.
//
// If you need to re-introduce a key-editor UI for CUSTOM clients, mount this
// component and pass a `keyLastFour` (computed server-side via
// `secretLastChars()` from `@/lib/encryption-helpers`) plus a server action
// that accepts `FormData` containing a fresh key and encrypts it before write.

import { useState } from "react";
import { Save, Loader2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fadeIn } from "@/lib/settings-animations";

interface UpdateVapiKeyFormProps {
    keyLastFour: string | null;
    hasKey: boolean;
    updateVapiKey: (formData: FormData) => Promise<void>;
}

export function UpdateVapiKeyForm({ keyLastFour, hasKey, updateVapiKey }: UpdateVapiKeyFormProps) {
    const [newKey, setNewKey] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newKey.trim()) return;
        setIsSaving(true);
        setSaved(false);

        const formData = new FormData();
        formData.set("vapiKey", newKey.trim());

        await updateVapiKey(formData);
        setIsSaving(false);
        setSaved(true);
        setNewKey("");
        setTimeout(() => setSaved(false), 3000);
    };

    const maskedKey = hasKey && keyLastFour ? `••••••••••••${keyLastFour}` : "Not set";

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <Label className="mb-1.5 block">Current Key</Label>
                <p className="text-sm font-mono text-gray-500">{maskedKey}</p>
            </div>
            <div>
                <Label htmlFor="vapi-key" className="mb-1.5 block">
                    {hasKey ? "Replace API Key" : "Set API Key"}
                </Label>
                <Input
                    id="vapi-key"
                    type="password"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="font-mono"
                    placeholder="Paste new VAPI API key…"
                    autoComplete="off"
                />
                <p className="text-xs text-gray-500 mt-1">
                    Get your API key from the{" "}
                    <a
                        href="https://dashboard.vapi.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 hover:underline"
                    >
                        Vapi Dashboard
                    </a>
                    . The current key is never displayed in full.
                </p>
            </div>

            {!hasKey && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-800">
                        No API key configured. Your agents will not be able to make VAPI calls until you set one.
                    </p>
                </div>
            )}

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={!newKey.trim() || isSaving}>
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
