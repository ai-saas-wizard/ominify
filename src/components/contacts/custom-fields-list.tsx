"use client";

import { useState } from "react";
import { Plus, Trash2, Type, Hash, Mail, Calendar, Link as LinkIcon, CheckSquare, MapPin, Loader2 } from "lucide-react";

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
        if (!confirm('Delete this custom field? This will remove it from all contacts.')) return;

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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                    <h3 className="font-semibold text-gray-900">Custom Properties</h3>
                    <p className="text-sm text-gray-500">{fields.length} field{fields.length !== 1 ? 's' : ''}</p>
                </div>
                <button
                    onClick={() => setShowAddForm(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                    <Plus className="w-4 h-4" />
                    Add Field
                </button>
            </div>

            {showAddForm && (
                <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Field Name</label>
                            <input
                                type="text"
                                value={newFieldName}
                                onChange={(e) => setNewFieldName(e.target.value)}
                                placeholder="e.g. Company, Birthday"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div className="w-40">
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Type</label>
                            <select
                                value={newFieldType}
                                onChange={(e) => setNewFieldType(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                            >
                                {FIELD_TYPES.map(type => (
                                    <option key={type.id} value={type.id}>{type.label}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={handleAddField}
                            disabled={loading || !newFieldName.trim()}
                            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Add
                        </button>
                        <button
                            onClick={() => {
                                setShowAddForm(false);
                                setNewFieldName('');
                            }}
                            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {fields.length === 0 ? (
                <div className="p-12 text-center">
                    <Type className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-gray-900 mb-1">No custom fields</h4>
                    <p className="text-gray-500 text-sm">
                        Add custom properties to store additional information about your contacts
                    </p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100">
                    {fields.map((field) => {
                        const Icon = getFieldIcon(field.field_type);
                        return (
                            <div key={field.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
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
                                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded capitalize">
                                        {field.field_type}
                                    </span>
                                    <button
                                        onClick={() => handleDeleteField(field.id)}
                                        disabled={deleting === field.id}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {deleting === field.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
