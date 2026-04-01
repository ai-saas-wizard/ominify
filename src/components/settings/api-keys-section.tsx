"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Key,
    Plus,
    Trash2,
    Copy,
    Check,
    Loader2,
    Eye,
    EyeOff,
    AlertTriangle,
    Code,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createApiKey, deleteApiKey, toggleApiKey } from "@/app/actions/api-key-actions";
import type { ClientApiKey } from "@/types/pipeline";

export function ApiKeysSection({
    clientId,
    initialKeys,
}: {
    clientId: string;
    initialKeys: ClientApiKey[];
}) {
    const [keys, setKeys] = useState<ClientApiKey[]>(initialKeys);
    const [newKeyName, setNewKeyName] = useState("");
    const [creating, setCreating] = useState(false);
    const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [showExample, setShowExample] = useState(false);

    const handleCreate = async () => {
        if (!newKeyName.trim()) return;
        setCreating(true);
        try {
            const result = await createApiKey(clientId, newKeyName.trim());
            if (result.success && result.key && result.data) {
                setKeys((prev) => [result.data!, ...prev]);
                setNewKeyValue(result.key);
                setNewKeyName("");
            }
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (keyId: string) => {
        await deleteApiKey(keyId);
        setKeys((prev) => prev.filter((k) => k.id !== keyId));
        setDeleteConfirm(null);
    };

    const handleToggle = async (keyId: string, isActive: boolean) => {
        await toggleApiKey(keyId, isActive);
        setKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, is_active: isActive } : k));
    };

    const handleCopy = () => {
        if (newKeyValue) {
            navigator.clipboard.writeText(newKeyValue);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="space-y-6">
            {/* New key revealed */}
            <AnimatePresence>
                {newKeyValue && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3"
                    >
                        <div className="flex items-start gap-2">
                            <Key className="w-4 h-4 text-emerald-600 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-emerald-800">API Key Created</p>
                                <p className="text-xs text-emerald-600 mt-0.5">
                                    Copy this key now. It won't be shown again.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 px-3 py-2 bg-white rounded-lg text-sm font-mono text-gray-900 border border-emerald-200 select-all">
                                {newKeyValue}
                            </code>
                            <button
                                onClick={handleCopy}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                            >
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? "Copied" : "Copy"}
                            </button>
                        </div>
                        <button
                            onClick={() => setNewKeyValue(null)}
                            className="text-xs text-emerald-600 hover:text-emerald-700"
                        >
                            Dismiss
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Create key */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-sm font-medium text-gray-700 mb-3">Create New API Key</p>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        placeholder="Key name (e.g. Zapier Integration)"
                        className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
                    />
                    <button
                        onClick={handleCreate}
                        disabled={!newKeyName.trim() || creating}
                        className={cn(
                            "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all",
                            newKeyName.trim()
                                ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                                : "bg-gray-100 text-gray-400 cursor-not-allowed"
                        )}
                    >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Create
                    </button>
                </div>
            </div>

            {/* Existing keys */}
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {keys.length === 0 ? (
                    <div className="p-8 text-center">
                        <Key className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No API keys yet</p>
                    </div>
                ) : (
                    keys.map((key) => (
                        <div key={key.id} className="flex items-center gap-3 px-5 py-4">
                            <Key className={cn("w-4 h-4 flex-shrink-0", key.is_active ? "text-emerald-500" : "text-gray-300")} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900">{key.name || "Unnamed Key"}</p>
                                <div className="flex items-center gap-3 mt-0.5">
                                    <code className="text-xs text-gray-500 font-mono">{key.key_prefix}</code>
                                    {key.last_used_at && (
                                        <span className="text-xs text-gray-400">
                                            Last used {new Date(key.last_used_at).toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => handleToggle(key.id, !key.is_active)}
                                className={cn(
                                    "relative w-9 h-5 rounded-full transition-colors",
                                    key.is_active ? "bg-emerald-600" : "bg-gray-300"
                                )}
                            >
                                <div className={cn(
                                    "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                                    key.is_active ? "left-[18px]" : "left-0.5"
                                )} />
                            </button>
                            {deleteConfirm === key.id ? (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleDelete(key.id)}
                                        className="p-1.5 bg-red-50 hover:bg-red-100 rounded text-red-600"
                                    >
                                        <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => setDeleteConfirm(null)}
                                        className="p-1.5 bg-gray-50 hover:bg-gray-100 rounded text-gray-500"
                                    >
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setDeleteConfirm(key.id)}
                                    className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Example curl */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <button
                    onClick={() => setShowExample(!showExample)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                    <Code className="w-4 h-4" />
                    Example API Request
                    <span className="text-xs text-gray-400 ml-1">{showExample ? "Hide" : "Show"}</span>
                </button>
                <AnimatePresence>
                    {showExample && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                        >
                            <pre className="mt-3 p-4 bg-gray-900 text-green-400 rounded-lg text-xs overflow-x-auto">
{`curl -X POST \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/client/${clientId}/leads \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: omni_your_key_here" \\
  -d '{
    "phone": "+15551234567",
    "name": "John Doe",
    "email": "john@example.com",
    "source": "google_ads",
    "pipeline_id": "optional-uuid",
    "stage_id": "optional-uuid",
    "enroll_in_sequence": "optional-uuid"
  }'`}
                            </pre>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
