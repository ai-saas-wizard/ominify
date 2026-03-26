"use client";

import { useState } from "react";
import { Plus, Trash2, Type, Hash, Mail, Calendar, Link as LinkIcon, CheckSquare, MapPin, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { staggerContainer, staggerItem, expandCollapse } from "@/lib/settings-animations";

interface CustomField {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
    is_required: boolean;
    display_order: number;
}

const FIELD_TYPES = [
    { id: 'text', label: 'Text', icon: Type },
    { id: 'number', label: 'Number', icon: Hash },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'url', label: 'URL', icon: LinkIcon },
    { id: 'date', label: 'Date', icon: Calendar },
    { id: 'checkbox', label: 'Checkbox', icon: CheckSquare },
    { id: 'address', label: 'Address', icon: MapPin },
];

export function CustomFieldsList({
    clientId,
    initialFields
}: {
    clientId: string;
    initialFields: CustomField[];
}) {
    const [fields, setFields] = useState(initialFields);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newFieldName, setNewFieldName] = useState('');
    const [newFieldType, setNewFieldType] = useState('text');
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const handleAddField = async () => {
        if (!newFieldName.trim()) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/client/${clientId}/contact-fields`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newFieldName,
                    field_type: newFieldType
                })
            });

            if (res.ok) {
                const newField = await res.json();
                setFields(prev => [...prev, newField]);
                setNewFieldName('');
                setNewFieldType('text');
                setShowAddForm(false);
            }
        } catch (error) {
            console.error('Error adding field:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteField = async (fieldId: string) => {
        setDeleting(fieldId);
        try {
            const res = await fetch(`/api/client/${clientId}/contact-fields/${fieldId}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setFields(prev => prev.filter(f => f.id !== fieldId));
            }
        } catch (error) {
            console.error('Error deleting field:', error);
        } finally {
            setDeleting(null);
        }
    };

    const getFieldIcon = (type: string) => {
        const fieldType = FIELD_TYPES.find(f => f.id === type);
        return fieldType?.icon || Type;
    };

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-100 flex-row items-center justify-between space-y-0 px-6 py-4">
                <div>
                    <h3 className="font-semibold text-gray-900">Custom Properties</h3>
                    <p className="text-sm text-gray-500">{fields.length} field{fields.length !== 1 ? 's' : ''}</p>
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
                        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
                            <div className="flex items-end gap-3">
                                <div className="flex-1">
                                    <Label htmlFor="field-name" className="mb-1.5 block">Field Name</Label>
                                    <Input
                                        id="field-name"
                                        type="text"
                                        value={newFieldName}
                                        onChange={(e) => setNewFieldName(e.target.value)}
                                        placeholder="e.g. Company, Birthday"
                                    />
                                </div>
                                <div className="w-40">
                                    <Label className="mb-1.5 block">Type</Label>
                                    <Select value={newFieldType} onValueChange={setNewFieldType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FIELD_TYPES.map(type => (
                                                <SelectItem key={type.id} value={type.id}>
                                                    {type.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button
                                    onClick={handleAddField}
                                    disabled={loading || !newFieldName.trim()}
                                    variant="secondary"
                                    className="bg-gray-900 text-white hover:bg-gray-800"
                                >
                                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Add
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setShowAddForm(false);
                                        setNewFieldName('');
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {fields.length === 0 ? (
                <div className="p-12 text-center">
                    <Type className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-1">No custom fields</h4>
                    <p className="text-gray-500 text-sm">
                        Add custom properties to store additional information about your contacts
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
                            return (
                                <motion.div
                                    key={field.id}
                                    variants={staggerItem}
                                    exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                                    layout
                                    className="px-6 py-4 flex items-center justify-between hover:bg-gray-50"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-gray-100 rounded-lg">
                                            <Icon className="w-4 h-4 text-gray-600" />
                                        </div>
                                        <div>
                                            <p className="font-medium text-gray-900">{field.name}</p>
                                            <p className="text-xs text-gray-500 font-mono">{field.field_key}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Badge variant="secondary" className="capitalize">
                                            {field.field_type}
                                        </Badge>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <button
                                                    disabled={deleting === field.id}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
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
                                                    <AlertDialogTitle>Delete custom field</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Delete &quot;{field.name}&quot;? This will remove it from all contacts.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDeleteField(field.id)}
                                                        className="bg-red-600 hover:bg-red-700"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </motion.div>
            )}
        </Card>
    );
}
