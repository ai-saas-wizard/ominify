"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface RemoveMemberButtonProps {
    memberId: string;
    removeMember: (formData: FormData) => Promise<void>;
}

export function RemoveMemberButton({ memberId, removeMember }: RemoveMemberButtonProps) {
    const [isRemoving, setIsRemoving] = useState(false);

    const handleRemove = async () => {
        setIsRemoving(true);
        const formData = new FormData();
        formData.set("memberId", memberId);
        await removeMember(formData);
        setIsRemoving(false);
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <button className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Remove team member</AlertDialogTitle>
                    <AlertDialogDescription>
                        This person will lose access to this account. You can always invite them again later.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleRemove}
                        disabled={isRemoving}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isRemoving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Removing...
                            </>
                        ) : (
                            "Remove"
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
