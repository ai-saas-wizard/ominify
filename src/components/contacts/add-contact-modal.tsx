"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";

interface CustomField {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
}

export function AddContactModal({
    clientId,
    customFields,
    onClose,
    onSuccess
}: {
    clientId: string;
    customFields: CustomField[];
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [customValues, setCustomValues] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!phone.trim()) {
            setError('Phone number is required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/client/${clientId}/contacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone,
                    name: name || null,
                    email: email || null,
                    custom_fields: customValues
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create contact');
            }

            onSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Add Contact</h3>
                        <p className="text-sm text-gray-500">Create a new contact manually</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Phone Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+1234567890"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Contact name"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Email
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="email@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>

                    {customFields.map((field) => (
                        <div key={field.id}>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                {field.name}
                            </label>
                            {field.field_type === 'checkbox' ? (
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={!!customValues[field.field_key]}
                                        onChange={(e) => setCustomValues(prev => ({
                                            ...prev,
                                            [field.field_key]: e.target.checked
                                        }))}
                                        className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                                    />
                                    <span className="text-sm text-gray-600">Yes</span>
                                </label>
                            ) : (
                                <input
                                    type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                                    value={customValues[field.field_key] || ''}
                                    onChange={(e) => setCustomValues(prev => ({
                                        ...prev,
                                        [field.field_key]: e.target.value
                                    }))}
                                    placeholder={`Enter ${field.name.toLowerCase()}`}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            )}
                        </div>
                    ))}

                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Add Contact
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
