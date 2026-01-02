"use client";

import { Download } from "lucide-react";

interface Client {
    id: string;
    name: string;
    email: string;
    account_type: string;
    created_at: string;
    price_per_minute: number;
    cost_per_minute: number;
    balance_minutes: number;
    total_purchased: number;
    total_used: number;
}

interface ExportClientsButtonProps {
    clients: Client[];
}

export function ExportClientsButton({ clients }: ExportClientsButtonProps) {
    const handleExport = () => {
        // Generate CSV content
        const headers = [
            'ID',
            'Name',
            'Email',
            'Account Type',
            'Created At',
            'Price Per Minute ($)',
            'Cost Per Minute ($)',
            'Balance (mins)',
            'Total Purchased (mins)',
            'Total Used (mins)'
        ];

        const rows = clients.map(client => [
            client.id,
            client.name || '',
            client.email || '',
            client.account_type || '',
            new Date(client.created_at).toLocaleDateString(),
            client.price_per_minute.toFixed(2),
            client.cost_per_minute.toFixed(2),
            client.balance_minutes.toFixed(0),
            client.total_purchased.toFixed(0),
            client.total_used.toFixed(0)
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `clients-export-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                    <span className="font-semibold">{clients.length}</span> clients will be exported with their billing and usage data.
                </p>
            </div>

            <button
                onClick={handleExport}
                disabled={clients.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Download className="w-4 h-4" />
                Export to CSV
            </button>
        </div>
    );
}
