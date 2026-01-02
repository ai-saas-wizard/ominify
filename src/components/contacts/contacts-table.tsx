"use client";

import { useState } from "react";
import { Phone, Mail, Clock, MessageSquare, ChevronRight, Search } from "lucide-react";
import { ContactDetailModal } from "./contact-detail-modal";

interface Contact {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    conversation_summary: string | null;
    total_calls: number;
    last_call_at: string | null;
    custom_fields: Record<string, any>;
    created_at: string;
}

interface CustomField {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
}

export function ContactsTable({
    clientId,
    initialContacts,
    customFields
}: {
    clientId: string;
    initialContacts: Contact[];
    customFields: CustomField[];
}) {
    const [contacts, setContacts] = useState(initialContacts);
    const [search, setSearch] = useState('');
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSearch = async (query: string) => {
        setSearch(query);
        if (query.length === 0) {
            setContacts(initialContacts);
            return;
        }

        if (query.length < 2) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/client/${clientId}/contacts?search=${encodeURIComponent(query)}`);
            if (res.ok) {
                const data = await res.json();
                setContacts(data.contacts);
            }
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never';
        const date = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        return date.toLocaleDateString();
    };

    const handleContactUpdate = (updatedContact: Contact) => {
        setContacts(prev => prev.map(c => c.id === updatedContact.id ? updatedContact : c));
        setSelectedContact(updatedContact);
    };

    return (
        <>
            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search by name, phone, or email..."
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {contacts.length === 0 ? (
                    <div className="p-12 text-center">
                        <Phone className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h4 className="text-lg font-medium text-gray-900 mb-1">No contacts yet</h4>
                        <p className="text-gray-500 text-sm">
                            Contacts are automatically created when you receive inbound calls
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                                    <th className="px-6 py-3 text-left font-medium">Contact</th>
                                    <th className="px-6 py-3 text-left font-medium">Phone</th>
                                    <th className="px-6 py-3 text-center font-medium">Calls</th>
                                    <th className="px-6 py-3 text-left font-medium">Last Call</th>
                                    <th className="px-6 py-3 text-left font-medium">Summary</th>
                                    <th className="px-6 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {contacts.map((contact) => (
                                    <tr
                                        key={contact.id}
                                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                                        onClick={() => setSelectedContact(contact)}
                                    >
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-medium text-gray-900">
                                                    {contact.name || 'Unknown'}
                                                </p>
                                                {contact.email && (
                                                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                        <Mail className="w-3 h-3" />
                                                        {contact.email}
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-sm text-gray-600 font-mono">
                                                {contact.phone}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                                                {contact.total_calls}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-sm text-gray-500 flex items-center gap-1.5">
                                                <Clock className="w-3.5 h-3.5" />
                                                {formatDate(contact.last_call_at)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {contact.conversation_summary ? (
                                                <p className="text-sm text-gray-600 truncate max-w-[200px]" title={contact.conversation_summary}>
                                                    <MessageSquare className="w-3.5 h-3.5 inline mr-1.5 text-gray-400" />
                                                    {contact.conversation_summary.split('\n')[0].replace(/^\[.*?\]\s*/, '')}
                                                </p>
                                            ) : (
                                                <span className="text-sm text-gray-400">No summary</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <ChevronRight className="w-4 h-4 text-gray-400" />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedContact && (
                <ContactDetailModal
                    contact={selectedContact}
                    customFields={customFields}
                    clientId={clientId}
                    onClose={() => setSelectedContact(null)}
                    onUpdate={handleContactUpdate}
                />
            )}
        </>
    );
}
