"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fadeIn } from "@/lib/settings-animations";

interface UpdateProfileFormProps {
    currentName: string;
    currentEmail: string;
    currentBusinessName?: string;
    updateProfile: (formData: FormData) => Promise<void>;
}

export function UpdateProfileForm({ currentName, currentEmail, currentBusinessName = "", updateProfile }: UpdateProfileFormProps) {
    const [name, setName] = useState(currentName);
    const [email, setEmail] = useState(currentEmail);
    const [businessName, setBusinessName] = useState(currentBusinessName);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const hasChanges = name !== currentName || email !== currentEmail || businessName !== currentBusinessName;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaved(false);

        const formData = new FormData();
        formData.set("name", name);
        formData.set("email", email);
        formData.set("business_name", businessName);

        await updateProfile(formData);
        setIsSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <Label htmlFor="profile-business-name" className="mb-1.5 block">
                    Business Name
                </Label>
                <Input
                    id="profile-business-name"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Acme Corp"
                />
                <p className="mt-1 text-xs text-gray-500">This name is displayed in the sidebar and used across your dashboard.</p>
            </div>

            <div>
                <Label htmlFor="profile-name" className="mb-1.5 block">
                    Display Name
                </Label>
                <Input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                />
            </div>

            <div>
                <Label htmlFor="profile-email" className="mb-1.5 block">
                    Email Address
                </Label>
                <Input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                />
            </div>

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
                            Save Changes
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
