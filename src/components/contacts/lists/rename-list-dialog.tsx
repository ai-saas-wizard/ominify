"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { renameContactList } from "@/app/actions/contact-list-actions";

interface ContactList {
    id: string;
    name: string;
    description: string | null;
}

interface RenameListDialogProps {
    list: ContactList | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function RenameListDialog({ list, open, onOpenChange }: RenameListDialogProps) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (list) {
            setName(list.name);
            setDescription(list.description || "");
            setError(null);
        }
    }, [list]);

    const handleSave = async () => {
        if (!list) return;
        if (!name.trim()) {
            setError("Name is required");
            return;
        }
        setSaving(true);
        const r = await renameContactList(list.id, name.trim(), description.trim() || undefined);
        setSaving(false);
        if (!r.success) {
            setError(r.error || "Failed to rename");
            return;
        }
        onOpenChange(false);
        router.refresh();
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Rename list</AlertDialogTitle>
                    <AlertDialogDescription>
                        Update the list name and description.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-medium text-gray-700">Name</label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="mt-1"
                            placeholder="May leads"
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700">
                            Description <span className="text-gray-400">(optional)</span>
                        </label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="mt-1"
                            rows={3}
                            placeholder="Notes about who's on this list and why."
                        />
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : "Save"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
