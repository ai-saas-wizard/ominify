"use client";

import { useState } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fadeIn } from "@/lib/settings-animations";

interface AddMemberFormProps {
    addMember: (formData: FormData) => Promise<void>;
}

export function AddMemberForm({ addMember }: AddMemberFormProps) {
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [role, setRole] = useState("member");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setIsSaving(true);
        setError(null);
        setSuccess(false);

        try {
            const formData = new FormData();
            formData.set("email", email);
            formData.set("name", name);
            formData.set("role", role);

            await addMember(formData);
            setEmail("");
            setName("");
            setRole("member");
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err: any) {
            setError(err.message || "Failed to add team member");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <Label htmlFor="member-email" className="mb-1.5 block">
                        Email Address *
                    </Label>
                    <Input
                        id="member-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="team@example.com"
                        required
                    />
                </div>
                <div>
                    <Label htmlFor="member-name" className="mb-1.5 block">
                        Name (optional)
                    </Label>
                    <Input
                        id="member-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Doe"
                    />
                </div>
                <div>
                    <Label className="mb-1.5 block">Role</Label>
                    <Select value={role} onValueChange={setRole}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <p className="text-xs text-gray-500">
                The invited user will be able to access this account after signing in with this email.
            </p>

            <AnimatePresence>
                {error && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600"
                    >
                        {error}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {success && (
                    <motion.div
                        variants={fadeIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600"
                    >
                        Team member invited successfully
                    </motion.div>
                )}
            </AnimatePresence>

            <Button type="submit" disabled={!email || isSaving}>
                {isSaving ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Inviting...
                    </>
                ) : (
                    <>
                        <UserPlus className="w-4 h-4" />
                        Invite Member
                    </>
                )}
            </Button>
        </form>
    );
}
