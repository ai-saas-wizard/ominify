"use client";

import { useState } from "react";
import { Loader2, Save, Building2, MapPin, User } from "lucide-react";
import { saveA2PBusinessInfo, type A2PBusinessInfo } from "@/app/actions/twilio-actions";
import { useRouter } from "next/navigation";

interface Props {
    clientId: string;
    tenantProfile: any;
    onComplete: () => void;
    onCancel: () => void;
}

const BUSINESS_TYPES = [
    "Sole Proprietorship",
    "Partnership",
    "Limited Liability Corporation",
    "Corporation",
    "Co-operative",
    "Non-profit",
];

const BUSINESS_INDUSTRIES = [
    "AUTOMOTIVE",
    "AGRICULTURE",
    "BANKING",
    "CONSTRUCTION",
    "CONSUMER",
    "EDUCATION",
    "ENGINEERING",
    "ENERGY",
    "ENTERTAINMENT",
    "FINANCIAL",
    "FINTECH",
    "FOOD_AND_BEVERAGE",
    "GOVERNMENT",
    "HEALTHCARE",
    "HOSPITALITY",
    "INSURANCE",
    "LEGAL",
    "MANUFACTURING",
    "MEDIA",
    "ONLINE",
    "REAL_ESTATE",
    "RELIGION",
    "RETAIL",
    "TECHNOLOGY",
    "TELECOMMUNICATIONS",
    "TRANSPORTATION",
];

const JOB_POSITIONS = [
    "Director",
    "VP",
    "GM",
    "CEO",
    "CFO",
    "General_Counsel",
    "Other",
];

const REGIONS = [
    "USA_AND_CANADA",
    "LATIN_AMERICA",
    "EUROPE",
    "AFRICA",
    "ASIA",
];

const US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
];

export function A2PBusinessInfoForm({ clientId, tenantProfile, onComplete, onCancel }: Props) {
    const router = useRouter();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    // Pre-fill from existing profile data
    const existingAddress = tenantProfile?.business_address || {};
    const existingRep1 = tenantProfile?.authorized_rep_1 || {};
    const existingRep2 = tenantProfile?.authorized_rep_2 || {};

    const [form, setForm] = useState<A2PBusinessInfo>({
        legalBusinessName: tenantProfile?.legal_business_name || "",
        businessType: tenantProfile?.business_type || "Limited Liability Corporation",
        einTaxId: tenantProfile?.ein_tax_id || "",
        businessIndustry: tenantProfile?.business_industry || "ONLINE",
        businessRegistrationIdType: tenantProfile?.business_registration_id_type || "EIN",
        businessRegionsOfOperation: tenantProfile?.business_regions_of_operation || "USA_AND_CANADA",
        websiteUrl: tenantProfile?.website || "",
        businessAddress: {
            street: existingAddress.street || "",
            city: existingAddress.city || "",
            state: existingAddress.state || "",
            zip: existingAddress.zip || "",
            country: existingAddress.country || "US",
        },
        authorizedRep1: {
            first_name: existingRep1.first_name || "",
            last_name: existingRep1.last_name || "",
            email: existingRep1.email || "",
            phone: existingRep1.phone || "",
            job_title: existingRep1.job_title || "",
            job_position: existingRep1.job_position || "CEO",
        },
        authorizedRep2: {
            first_name: existingRep2.first_name || "",
            last_name: existingRep2.last_name || "",
            email: existingRep2.email || "",
            phone: existingRep2.phone || "",
            job_title: existingRep2.job_title || "",
            job_position: existingRep2.job_position || "Director",
        },
    });

    function updateField(path: string, value: string) {
        setForm((prev) => {
            const parts = path.split(".");
            const updated = { ...prev } as any;
            let current = updated;
            for (let i = 0; i < parts.length - 1; i++) {
                current[parts[i]] = { ...current[parts[i]] };
                current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = value;
            return updated;
        });
    }

    async function handleSave() {
        // Validate required fields
        if (!form.legalBusinessName.trim()) {
            setError("Legal business name is required.");
            return;
        }
        if (!form.einTaxId.trim()) {
            setError("EIN/Tax ID is required.");
            return;
        }
        if (!form.businessAddress.street.trim() || !form.businessAddress.city.trim() || !form.businessAddress.state.trim() || !form.businessAddress.zip.trim()) {
            setError("Complete business address is required.");
            return;
        }
        if (!form.authorizedRep1.first_name.trim() || !form.authorizedRep1.last_name.trim() || !form.authorizedRep1.email.trim() || !form.authorizedRep1.phone.trim()) {
            setError("Authorized Representative 1 details are required.");
            return;
        }
        if (!form.authorizedRep2.first_name.trim() || !form.authorizedRep2.last_name.trim() || !form.authorizedRep2.email.trim() || !form.authorizedRep2.phone.trim()) {
            setError("Authorized Representative 2 details are required.");
            return;
        }

        setSaving(true);
        setError("");
        try {
            const result = await saveA2PBusinessInfo(clientId, form);
            if (!result.success) {
                setError(result.error || "Failed to save");
            } else {
                router.refresh();
                onComplete();
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    const inputClass = "w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent";
    const labelClass = "block text-xs font-medium text-gray-700 mb-1";

    return (
        <div className="space-y-6">
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {/* Business Details */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-gray-600" />
                    <h4 className="font-medium text-gray-900 text-sm">Business Details</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelClass}>Legal Business Name *</label>
                        <input
                            type="text"
                            value={form.legalBusinessName}
                            onChange={(e) => updateField("legalBusinessName", e.target.value)}
                            placeholder="Acme Services LLC"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Business Type *</label>
                        <select
                            value={form.businessType}
                            onChange={(e) => updateField("businessType", e.target.value)}
                            className={inputClass}
                        >
                            {BUSINESS_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>EIN / Tax ID *</label>
                        <input
                            type="text"
                            value={form.einTaxId}
                            onChange={(e) => updateField("einTaxId", e.target.value)}
                            placeholder="XX-XXXXXXX"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Industry *</label>
                        <select
                            value={form.businessIndustry}
                            onChange={(e) => updateField("businessIndustry", e.target.value)}
                            className={inputClass}
                        >
                            {BUSINESS_INDUSTRIES.map((i) => (
                                <option key={i} value={i}>{i.replace(/_/g, " ")}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Website URL</label>
                        <input
                            type="url"
                            value={form.websiteUrl}
                            onChange={(e) => updateField("websiteUrl", e.target.value)}
                            placeholder="https://example.com"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Regions of Operation</label>
                        <select
                            value={form.businessRegionsOfOperation}
                            onChange={(e) => updateField("businessRegionsOfOperation", e.target.value)}
                            className={inputClass}
                        >
                            {REGIONS.map((r) => (
                                <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Business Address */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-4 h-4 text-gray-600" />
                    <h4 className="font-medium text-gray-900 text-sm">Business Address</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                        <label className={labelClass}>Street Address *</label>
                        <input
                            type="text"
                            value={form.businessAddress.street}
                            onChange={(e) => updateField("businessAddress.street", e.target.value)}
                            placeholder="123 Main Street, Suite 100"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>City *</label>
                        <input
                            type="text"
                            value={form.businessAddress.city}
                            onChange={(e) => updateField("businessAddress.city", e.target.value)}
                            placeholder="New York"
                            className={inputClass}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>State *</label>
                            <select
                                value={form.businessAddress.state}
                                onChange={(e) => updateField("businessAddress.state", e.target.value)}
                                className={inputClass}
                            >
                                <option value="">Select</option>
                                {US_STATES.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelClass}>ZIP *</label>
                            <input
                                type="text"
                                value={form.businessAddress.zip}
                                onChange={(e) => updateField("businessAddress.zip", e.target.value)}
                                placeholder="10001"
                                className={inputClass}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Authorized Representative 1 */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <User className="w-4 h-4 text-gray-600" />
                    <h4 className="font-medium text-gray-900 text-sm">Authorized Representative 1 (Primary)</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelClass}>First Name *</label>
                        <input
                            type="text"
                            value={form.authorizedRep1.first_name}
                            onChange={(e) => updateField("authorizedRep1.first_name", e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Last Name *</label>
                        <input
                            type="text"
                            value={form.authorizedRep1.last_name}
                            onChange={(e) => updateField("authorizedRep1.last_name", e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Email *</label>
                        <input
                            type="email"
                            value={form.authorizedRep1.email}
                            onChange={(e) => updateField("authorizedRep1.email", e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Phone *</label>
                        <input
                            type="tel"
                            value={form.authorizedRep1.phone}
                            onChange={(e) => updateField("authorizedRep1.phone", e.target.value)}
                            placeholder="+14155551234"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Job Title</label>
                        <input
                            type="text"
                            value={form.authorizedRep1.job_title}
                            onChange={(e) => updateField("authorizedRep1.job_title", e.target.value)}
                            placeholder="Chief Executive Officer"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Job Position *</label>
                        <select
                            value={form.authorizedRep1.job_position}
                            onChange={(e) => updateField("authorizedRep1.job_position", e.target.value)}
                            className={inputClass}
                        >
                            {JOB_POSITIONS.map((p) => (
                                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Authorized Representative 2 */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <User className="w-4 h-4 text-gray-600" />
                    <h4 className="font-medium text-gray-900 text-sm">Authorized Representative 2</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelClass}>First Name *</label>
                        <input
                            type="text"
                            value={form.authorizedRep2.first_name}
                            onChange={(e) => updateField("authorizedRep2.first_name", e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Last Name *</label>
                        <input
                            type="text"
                            value={form.authorizedRep2.last_name}
                            onChange={(e) => updateField("authorizedRep2.last_name", e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Email *</label>
                        <input
                            type="email"
                            value={form.authorizedRep2.email}
                            onChange={(e) => updateField("authorizedRep2.email", e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Phone *</label>
                        <input
                            type="tel"
                            value={form.authorizedRep2.phone}
                            onChange={(e) => updateField("authorizedRep2.phone", e.target.value)}
                            placeholder="+14155551234"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Job Title</label>
                        <input
                            type="text"
                            value={form.authorizedRep2.job_title}
                            onChange={(e) => updateField("authorizedRep2.job_title", e.target.value)}
                            placeholder="Director of Operations"
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Job Position *</label>
                        <select
                            value={form.authorizedRep2.job_position}
                            onChange={(e) => updateField("authorizedRep2.job_position", e.target.value)}
                            className={inputClass}
                        >
                            {JOB_POSITIONS.map((p) => (
                                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm disabled:opacity-50"
                >
                    {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Save className="w-4 h-4" />
                    )}
                    {saving ? "Saving..." : "Save Business Info"}
                </button>
                <button
                    onClick={onCancel}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
