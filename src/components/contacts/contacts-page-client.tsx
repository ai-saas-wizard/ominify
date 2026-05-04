"use client";

import { useState } from "react";
import { Plus, Upload } from "lucide-react";
import Link from "next/link";
import { ContactsTable } from "./contacts-table";
import { AddContactModal } from "./add-contact-modal";
import { ContactsShell } from "./contacts-shell";

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
    customFields,
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
        fetch(`/api/client/${clientId}/contacts`)
            .then((res) => res.json())
            .then((data) => setContacts(data.contacts))
            .catch(console.error);
    };

    return (
        <ContactsShell
            title="Contacts"
            subtitle={
                <span>
                    {total.toLocaleString()} contact{total !== 1 ? "s" : ""}
                </span>
            }
            actions={
                <>
                    <Link
                        href={`/client/${clientId}/settings/contact-fields`}
                        className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Custom Fields
                    </Link>
                    <Link
                        href={`/client/${clientId}/contacts/import`}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                        <Upload className="w-4 h-4" />
                        Import
                    </Link>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Add Contact
                    </button>
                </>
            }
        >
            <ContactsTable
                clientId={clientId}
                initialContacts={contacts}
                customFields={customFields}
            />

            {showAddModal && (
                <AddContactModal
                    clientId={clientId}
                    customFields={customFields}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={handleContactAdded}
                />
            )}
        </ContactsShell>
    );
}
