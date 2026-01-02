"use client";

import { useState } from "react";
import { Users, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ContactsTable } from "./contacts-table";
import { AddContactModal } from "./add-contact-modal";

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

export function ContactsPageClient({
    clientId,
    initialContacts,
    total,
    customFields
}: {
    clientId: string;
    initialContacts: Contact[];
    total: number;
    customFields: CustomField[];
}) {
    const [contacts, setContacts] = useState(initialContacts);
    const [showAddModal, setShowAddModal] = useState(false);

    const handleContactAdded = () => {
        setShowAddModal(false);
        // Refresh contacts
        fetch(`/api/client/${clientId}/contacts`)
            .then(res => res.json())
            .then(data => setContacts(data.contacts))
            .catch(console.error);
    };

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Users className="w-6 h-6 text-indigo-600" />
                        Contacts
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">
                        {contacts.length} contact{contacts.length !== 1 ? 's' : ''} from inbound calls
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href={`/client/${clientId}/settings/contact-fields`}
                        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Custom Fields
                    </Link>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Contact
                    </button>
                </div>
            </div>

            {/* Contacts Table */}
            <ContactsTable
                clientId={clientId}
                initialContacts={contacts}
                customFields={customFields}
            />

            {/* Add Contact Modal */}
            {showAddModal && (
                <AddContactModal
                    clientId={clientId}
                    customFields={customFields}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={handleContactAdded}
                />
            )}
        </div>
    );
}
