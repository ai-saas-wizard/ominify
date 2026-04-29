"use client";

import { useState } from "react";
import {
    Plus,
    Trash2,
    Type,
    Hash,
    Mail,
    Calendar,
    Link as LinkIcon,
    CheckSquare,
    MapPin,
    Loader2,
    Pencil,
    Check,
    X,
    Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
import {
    staggerContainer,
    staggerItem,
    expandCollapse,
} from "@/lib/settings-animations";

interface CustomField {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
    is_required: boolean;
    display_order: number;
    description?: string | null;
}

const FIELD_TYPES = [
    { id: "text", label: "Text", icon: Type },
    { id: "number", label: "Number", icon: Hash },
    { id: "email", label: "Email", icon: Mail },
    { id: "url", label: "URL", icon: LinkIcon },
    { id: "date", label: "Date", icon: Calendar },
    { id: "checkbox", label: "Checkbox", icon: CheckSquare },
    { id: "address", label: "Address", icon: MapPin },
];

export function CustomFieldsList({
    clientId,
    initialFields,
}: {
    clientId: string;
    initialFields: CustomField[];
}) {
    const [fields, setFields] = useState(initialFields);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newFieldName, setNewFieldName] = useState("");
    const [newFieldType, setNewFieldType] = useState("text");
    const [newFieldDescription, setNewFieldDescription] = useState("");
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editDescription, setEditDescription] = useState("");
    const [savingEdit, setSavingEdit] = useState(false);

    const resetAddForm = () => {
        setNewFieldName("");
        setNewFieldType("text");
        setNewFieldDescription("");
    };

    const handleAddField = async () => {
        if (!newFieldName.trim()) return;

        setLoading(true);
        try {
            const res = await fetch(
                `/api/client/${clientId}/contact-fields`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: newFieldName,
                        field_type: newFieldType,
                        description: newFieldDescription,
                    }),
                }
            );

            if (res.ok) {
                const newField = await res.json();
                setFields((prev) => [...prev, newField]);
                resetAddForm();
                setShowAddForm(false);
            }
        } catch (error) {
            console.error("Error adding field:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteField = async (fieldId: string) => {
        setDeleting(fieldId);
        try {
            const res = await fetch(
                `/api/client/${clientId}/contact-fields/${fieldId}`,
                {
                    method: "DELETE",
                }
            );

            if (res.ok) {
                setFields((prev) => prev.filter((f) => f.id !== fieldId));
            }
        } catch (error) {
            console.error("Error deleting field:", error);
        } finally {
            setDeleting(null);
        }
    };

    const startEdit = (field: CustomField) => {
        setEditingId(field.id);
        setEditName(field.name);
        setEditDescription(field.description || "");
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditName("");
        setEditDescription("");
    };

    const saveEdit = async (fieldId: string) => {
        if (!editName.trim()) return;
        setSavingEdit(true);
        try {
            const res = await fetch(
                `/api/client/${clientId}/contact-fields/${fieldId}`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: editName,
                        description: editDescription,
                    }),
                }
            );

            if (res.ok) {
                const updated = await res.json();
                setFields((prev) =>
                    prev.map((f) => (f.id === fieldId ? updated : f))
                );
                cancelEdit();
            }
        } catch (error) {
            console.error("Error updating field:", error);
        } finally {
            setSavingEdit(false);
        }
    };

    const getFieldIcon = (type: string) => {
        const fieldType = FIELD_TYPES.find((f) => f.id === type);
        return fieldType?.icon || Type;
    };

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-100 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div>
                    <h3 className="font-semibold text-gray-900">
                        Custom Properties
                    </h3>
                    <p className="text-sm text-gray-500">
                        {fields.length} field{fields.length !== 1 ? "s" : ""} ·
                        descriptions are read by your outbound voice agents at
                        call time
                    </p>
                </div>
                <Button
                    onClick={() => setShowAddForm(true)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                >
                    <Plus className="w-4 h-4" />
                    Add Field
                </Button>
            </CardHeader>

            <AnimatePresence>
                {showAddForm && (
                    <motion.div
                        variants={expandCollapse}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                    >
                        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 space-y-3">
                            <div className="flex items-end gap-3">
                                <div className="flex-1">
                                    <Label
                                        htmlFor="field-name"
                                        className="mb-1.5 block"
                                    >
                                        Field Name
                                    </Label>
                                    <Input
                                        id="field-name"
                                        type="text"
                                        value={newFieldName}
                                        onChange={(e) =>
                                            setNewFieldName(e.target.value)
                                        }
                                        placeholder="e.g. Last Offer Made"
                                    />
                                </div>
                                <div className="w-40">
                                    <Label className="mb-1.5 block">
                                        Type
                                    </Label>
                                    <Select
                                        value={newFieldType}
                                        onValueChange={setNewFieldType}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FIELD_TYPES.map((type) => (
                                                <SelectItem
                                                    key={type.id}
                                                    value={type.id}
                                                >
                                                    {type.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div>
                                <Label
                                    htmlFor="field-description"
                                    className="mb-1.5 block flex items-center gap-1.5"
                                >
                                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                                    Description for the AI agent
                                    <span className="text-[11px] font-normal text-gray-400">
                                        (optional but strongly recommended)
                                    </span>
                                </Label>
                                <Textarea
                                    id="field-description"
                                    value={newFieldDescription}
                                    onChange={(e) =>
                                        setNewFieldDescription(e.target.value)
                                    }
                                    placeholder="e.g. The most recent cash offer we made on this property. Used by the outbound agent to remind sellers of the price they were quoted."
                                    rows={2}
                                />
                                <p className="mt-1 text-[11px] text-gray-400">
                                    The agent reads this when handling a call so
                                    it knows what the field means and when to
                                    use it.
                                </p>
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setShowAddForm(false);
                                        resetAddForm();
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleAddField}
                                    disabled={
                                        loading || !newFieldName.trim()
                                    }
                                    variant="secondary"
                                    className="bg-gray-900 text-white hover:bg-gray-800"
                                >
                                    {loading && (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    )}
                                    Add
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {fields.length === 0 ? (
                <div className="p-12 text-center">
                    <Type className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-1">
                        No custom fields
                    </h4>
                    <p className="text-gray-500 text-sm">
                        Add custom properties to store additional information
                        about your contacts. The descriptions you provide are
                        read by your outbound agents at call time.
                    </p>
                </div>
            ) : (
                <motion.div
                    variants={staggerContainer}
                    initial="hidden"
                    animate="show"
                    className="divide-y divide-gray-100"
                >
                    <AnimatePresence>
                        {fields.map((field) => {
                            const Icon = getFieldIcon(field.field_type);
                            const isEditing = editingId === field.id;

                            return (
                                <motion.div
                                    key={field.id}
                                    variants={staggerItem}
                                    exit={{
                                        opacity: 0,
                                        x: -20,
                                        transition: { duration: 0.2 },
                                    }}
                                    layout
                                    className={
                                        isEditing
                                            ? "px-6 py-4 bg-gray-50"
                                            : "px-6 py-4 flex items-center justify-between hover:bg-gray-50"
                                    }
                                >
                                    {isEditing ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-gray-100 rounded-lg">
                                                    <Icon className="w-4 h-4 text-gray-600" />
                                                </div>
                                                <Input
                                                    value={editName}
                                                    onChange={(e) =>
                                                        setEditName(e.target.value)
                                                    }
                                                    className="flex-1"
                                                    placeholder="Field name"
                                                />
                                                <Badge
                                                    variant="secondary"
                                                    className="capitalize"
                                                >
                                                    {field.field_type}
                                                </Badge>
                                            </div>
                                            <div>
                                                <Label className="mb-1.5 block flex items-center gap-1.5 text-xs">
                                                    <Sparkles className="h-3 w-3 text-amber-500" />
                                                    Description for the AI agent
                                                </Label>
                                                <Textarea
                                                    value={editDescription}
                                                    onChange={(e) =>
                                                        setEditDescription(
                                                            e.target.value
                                                        )
                                                    }
                                                    rows={2}
                                                    placeholder="What does this field mean? When should the agent reference it?"
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <p className="text-[11px] text-gray-400 font-mono">
                                                    {field.field_key}
                                                </p>
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={cancelEdit}
                                                        disabled={savingEdit}
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                        Cancel
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        onClick={() =>
                                                            saveEdit(field.id)
                                                        }
                                                        disabled={
                                                            savingEdit ||
                                                            !editName.trim()
                                                        }
                                                        className="bg-emerald-600 hover:bg-emerald-700"
                                                    >
                                                        {savingEdit ? (
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        ) : (
                                                            <Check className="w-3.5 h-3.5" />
                                                        )}
                                                        Save
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-start gap-3 min-w-0 flex-1">
                                                <div className="p-2 bg-gray-100 rounded-lg flex-shrink-0">
                                                    <Icon className="w-4 h-4 text-gray-600" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-medium text-gray-900 truncate">
                                                            {field.name}
                                                        </p>
                                                        <span className="text-xs text-gray-400 font-mono truncate">
                                                            {field.field_key}
                                                        </span>
                                                    </div>
                                                    {field.description ? (
                                                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">
                                                            {field.description}
                                                        </p>
                                                    ) : (
                                                        <p className="mt-0.5 text-xs italic text-amber-600">
                                                            No description — the
                                                            agent won&apos;t know
                                                            what this field means.
                                                            Add one.
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <Badge
                                                    variant="secondary"
                                                    className="capitalize"
                                                >
                                                    {field.field_type}
                                                </Badge>
                                                <button
                                                    onClick={() => startEdit(field)}
                                                    className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                                    aria-label="Edit field"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <button
                                                            disabled={
                                                                deleting === field.id
                                                            }
                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                                            aria-label="Delete field"
                                                        >
                                                            {deleting === field.id ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : (
                                                                <Trash2 className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>
                                                                Delete custom field
                                                            </AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Delete &quot;
                                                                {field.name}&quot;?
                                                                This will remove it
                                                                from all contacts.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>
                                                                Cancel
                                                            </AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={() =>
                                                                    handleDeleteField(
                                                                        field.id
                                                                    )
                                                                }
                                                                className="bg-red-600 hover:bg-red-700"
                                                            >
                                                                Delete
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </motion.div>
            )}
        </Card>
    );
}
