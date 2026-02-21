"use client";

import { useState, useTransition } from "react";
import {
    Save,
    Loader2,
    Eye,
    EyeOff,
    CheckCircle,
    XCircle,
    Zap,
    Trash2,
    AlertTriangle,
    Info,
} from "lucide-react";
import type { EmailAccountConfig } from "@/app/actions/email-config-actions";

interface EmailConfigFormProps {
    clientId: string;
    config: EmailAccountConfig | null;
    saveAction: (clientId: string, formData: FormData) => Promise<{ success: boolean; error?: string }>;
    testAction: (clientId: string) => Promise<{ success: boolean; error?: string }>;
    deleteAction: (clientId: string) => Promise<{ success: boolean; error?: string }>;
}

// Common SMTP presets
const SMTP_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
    gmail: { host: "smtp.gmail.com", port: 587, secure: false },
    outlook: { host: "smtp.office365.com", port: 587, secure: false },
    yahoo: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    zoho: { host: "smtp.zoho.com", port: 465, secure: true },
    sendgrid: { host: "smtp.sendgrid.net", port: 587, secure: false },
    mailgun: { host: "smtp.mailgun.org", port: 587, secure: false },
    ses: { host: "email-smtp.us-east-1.amazonaws.com", port: 587, secure: false },
    custom: { host: "", port: 587, secure: false },
};

export function EmailConfigForm({
    clientId,
    config,
    saveAction,
    testAction,
    deleteAction,
}: EmailConfigFormProps) {
    // Form state
    const [provider, setProvider] = useState<string>(config?.provider || "smtp");
    const [fromEmail, setFromEmail] = useState(config?.from_email || "");
    const [fromName, setFromName] = useState(config?.from_name || "");
    const [smtpHost, setSmtpHost] = useState(config?.smtp_host || "");
    const [smtpPort, setSmtpPort] = useState(config?.smtp_port || 587);
    const [smtpUser, setSmtpUser] = useState(config?.smtp_user || "");
    const [smtpPass, setSmtpPass] = useState("");
    const [smtpSecure, setSmtpSecure] = useState(config?.smtp_secure || false);
    const [replyToEmail, setReplyToEmail] = useState(config?.reply_to_email || "");
    const [dailySendLimit, setDailySendLimit] = useState(config?.daily_send_limit || 500);

    // UI state
    const [showPassword, setShowPassword] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [testMessage, setTestMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [isTesting, setIsTesting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    function applyPreset(presetKey: string) {
        const preset = SMTP_PRESETS[presetKey];
        if (preset) {
            setSmtpHost(preset.host);
            setSmtpPort(preset.port);
            setSmtpSecure(preset.secure);
        }
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setSaveMessage(null);
        setTestMessage(null);

        const formData = new FormData();
        formData.set("provider", provider);
        formData.set("from_email", fromEmail);
        formData.set("from_name", fromName);
        formData.set("smtp_host", smtpHost);
        formData.set("smtp_port", smtpPort.toString());
        formData.set("smtp_user", smtpUser);
        formData.set("smtp_pass", smtpPass);
        formData.set("smtp_secure", smtpSecure.toString());
        formData.set("reply_to_email", replyToEmail);
        formData.set("daily_send_limit", dailySendLimit.toString());

        startTransition(async () => {
            const result = await saveAction(clientId, formData);
            if (result.success) {
                setSaveMessage({ type: "success", text: "Email configuration saved!" });
                setSmtpPass(""); // Clear password field after save
            } else {
                setSaveMessage({ type: "error", text: result.error || "Failed to save" });
            }
            setTimeout(() => setSaveMessage(null), 5000);
        });
    }

    async function handleTest() {
        setTestMessage(null);
        setIsTesting(true);

        try {
            const result = await testAction(clientId);
            if (result.success) {
                setTestMessage({ type: "success", text: "Connection verified! SMTP is working." });
            } else {
                setTestMessage({ type: "error", text: result.error || "Connection test failed" });
            }
        } catch (err: any) {
            setTestMessage({ type: "error", text: err.message || "Test failed" });
        } finally {
            setIsTesting(false);
        }
    }

    async function handleDelete() {
        setIsDeleting(true);
        try {
            const result = await deleteAction(clientId);
            if (result.success) {
                // Reset form
                setFromEmail("");
                setFromName("");
                setSmtpHost("");
                setSmtpPort(587);
                setSmtpUser("");
                setSmtpPass("");
                setSmtpSecure(false);
                setReplyToEmail("");
                setDailySendLimit(500);
                setShowDeleteConfirm(false);
                setSaveMessage({ type: "success", text: "Email configuration removed" });
            } else {
                setSaveMessage({ type: "error", text: result.error || "Failed to delete" });
            }
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <form onSubmit={handleSave} className="space-y-8">
            {/* Provider Selection */}
            <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Email Provider
                </label>
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={() => setProvider("smtp")}
                        className={`flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                            provider === "smtp"
                                ? "border-violet-500 bg-violet-50 text-violet-700"
                                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                        }`}
                    >
                        SMTP
                        <p className="text-xs font-normal mt-0.5 opacity-75">
                            Works with any email provider
                        </p>
                    </button>
                    <button
                        type="button"
                        onClick={() => setProvider("gmail")}
                        disabled
                        className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-100 bg-gray-50 text-gray-400 text-sm font-medium cursor-not-allowed"
                    >
                        Gmail API
                        <p className="text-xs font-normal mt-0.5">Coming soon</p>
                    </button>
                </div>
            </div>

            {/* Quick Preset Selector */}
            <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Quick Setup
                </label>
                <div className="flex flex-wrap gap-2">
                    {Object.keys(SMTP_PRESETS).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => applyPreset(key)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                                smtpHost === SMTP_PRESETS[key].host && key !== "custom"
                                    ? "bg-violet-100 border-violet-300 text-violet-700"
                                    : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                            }`}
                        >
                            {key === "ses" ? "AWS SES" : key.charAt(0).toUpperCase() + key.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* From Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        From Email <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="email"
                        value={fromEmail}
                        onChange={(e) => setFromEmail(e.target.value)}
                        required
                        placeholder="info@yourbusiness.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        The email address your sequences will send from
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        From Name
                    </label>
                    <input
                        type="text"
                        value={fromName}
                        onChange={(e) => setFromName(e.target.value)}
                        placeholder="Your Business Name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Display name shown to recipients
                    </p>
                </div>
            </div>

            {/* SMTP Configuration */}
            <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    SMTP Server Settings
                    <span className="text-xs font-normal text-gray-500">(required)</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            SMTP Host
                        </label>
                        <input
                            type="text"
                            value={smtpHost}
                            onChange={(e) => setSmtpHost(e.target.value)}
                            placeholder="smtp.gmail.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Port
                        </label>
                        <input
                            type="number"
                            value={smtpPort}
                            onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
                            min={1}
                            max={65535}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Username
                        </label>
                        <input
                            type="text"
                            value={smtpUser}
                            onChange={(e) => setSmtpUser(e.target.value)}
                            placeholder="your-email@gmail.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Password / App Password
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={smtpPass}
                                onChange={(e) => setSmtpPass(e.target.value)}
                                placeholder={config?.has_smtp_password ? "Leave blank to keep current" : "Enter password"}
                                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        {config?.has_smtp_password && (
                            <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                Password is saved (encrypted)
                            </p>
                        )}
                    </div>
                </div>

                {/* SSL / Security */}
                <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={smtpSecure}
                            onChange={(e) => {
                                setSmtpSecure(e.target.checked);
                                // Auto-adjust port
                                if (e.target.checked && smtpPort === 587) setSmtpPort(465);
                                if (!e.target.checked && smtpPort === 465) setSmtpPort(587);
                            }}
                            className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                    <div>
                        <span className="text-sm font-medium text-gray-700">Use SSL/TLS</span>
                        <p className="text-xs text-gray-500">
                            Enable for port 465 (SSL). Disable for port 587 (STARTTLS).
                        </p>
                    </div>
                </div>
            </div>

            {/* Advanced Settings */}
            <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Advanced Settings</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Reply-To Email
                        </label>
                        <input
                            type="email"
                            value={replyToEmail}
                            onChange={(e) => setReplyToEmail(e.target.value)}
                            placeholder="Same as From Email"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Where replies go (defaults to From Email)
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Daily Send Limit
                        </label>
                        <input
                            type="number"
                            value={dailySendLimit}
                            onChange={(e) => setDailySendLimit(parseInt(e.target.value) || 500)}
                            min={1}
                            max={10000}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Max emails per day (prevent spam flags)
                        </p>
                    </div>
                </div>
            </div>

            {/* Gmail App Password Info */}
            {smtpHost === "smtp.gmail.com" && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <p className="font-medium mb-1">Using Gmail SMTP?</p>
                        <p>
                            You need to use an{" "}
                            <strong>App Password</strong> instead of your regular Gmail password.
                            Go to{" "}
                            <a
                                href="https://myaccount.google.com/apppasswords"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline font-medium"
                            >
                                Google Account &rarr; App Passwords
                            </a>{" "}
                            to generate one. 2FA must be enabled.
                        </p>
                    </div>
                </div>
            )}

            {/* Status Messages */}
            {saveMessage && (
                <div
                    className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                        saveMessage.type === "success"
                            ? "bg-green-50 border border-green-200 text-green-800"
                            : "bg-red-50 border border-red-200 text-red-800"
                    }`}
                >
                    {saveMessage.type === "success" ? (
                        <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                        <XCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    {saveMessage.text}
                </div>
            )}

            {testMessage && (
                <div
                    className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
                        testMessage.type === "success"
                            ? "bg-green-50 border border-green-200 text-green-800"
                            : "bg-red-50 border border-red-200 text-red-800"
                    }`}
                >
                    {testMessage.type === "success" ? (
                        <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                        <XCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    {testMessage.text}
                </div>
            )}

            {/* Verification Status */}
            {config && (
                <div className="flex items-center gap-2 text-sm">
                    {config.is_verified ? (
                        <>
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-green-700">
                                Verified{" "}
                                {config.last_verified_at &&
                                    new Date(config.last_verified_at).toLocaleDateString()}
                            </span>
                        </>
                    ) : config.verification_error ? (
                        <>
                            <XCircle className="w-4 h-4 text-red-500" />
                            <span className="text-red-700">
                                Last test failed: {config.verification_error}
                            </span>
                        </>
                    ) : (
                        <>
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <span className="text-amber-700">Not verified yet</span>
                        </>
                    )}
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <div className="flex items-center gap-3">
                    {/* Save Button */}
                    <button
                        type="submit"
                        disabled={isPending || !fromEmail}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                        {isPending ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Configuration
                            </>
                        )}
                    </button>

                    {/* Test Connection Button */}
                    {config && (
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={isTesting}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isTesting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Testing...
                                </>
                            ) : (
                                <>
                                    <Zap className="w-4 h-4" />
                                    Test Connection
                                </>
                            )}
                        </button>
                    )}
                </div>

                {/* Delete Button */}
                {config && (
                    <div>
                        {showDeleteConfirm ? (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">Are you sure?</span>
                                <button
                                    type="button"
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="text-sm text-red-600 hover:text-red-800 font-medium"
                                >
                                    {isDeleting ? "Removing..." : "Yes, remove"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="text-sm text-gray-500 hover:text-gray-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(true)}
                                className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-800 font-medium transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                                Remove Configuration
                            </button>
                        )}
                    </div>
                )}
            </div>
        </form>
    );
}
