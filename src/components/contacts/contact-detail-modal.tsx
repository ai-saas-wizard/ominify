"use client";

import { useState, useEffect } from "react";
import { X, Phone, Mail, User, Calendar, MessageSquare, Clock, Save, Plus, Loader2, Activity, Brain } from "lucide-react";
import { InteractionTimeline } from "./interaction-timeline";
import { EngagementMeter } from "./engagement-meter";
import { EmotionBadge } from "./emotion-badge";

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
    // Phase 2: Emotional Intelligence
    engagement_score?: number;
    sentiment_trend?: string;
    calls?: Array<{
        id: string;
        summary: string | null;
        outcome: string;
        duration_seconds: number;
        called_at: string;
    }>;
    // Active enrollments with EI data
    active_enrollment?: {
        last_emotion?: string;
        is_hot_lead?: boolean;
        is_at_risk?: boolean;
        needs_human_intervention?: boolean;
        recommended_tone?: string;
        objections_detected?: Array<{ type: string; detail: string; severity: string }>;
    };
}

interface CustomField {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
}

export function ContactDetailModal({
    contact,
    customFields,
    clientId,
    onClose,
    onUpdate
}: {
    contact: Contact;
    customFields: CustomField[];
    clientId: string;
    onClose: () => void;
    onUpdate: (contact: Contact) => void;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [fullContact, setFullContact] = useState<Contact>(contact);
    const [editedFields, setEditedFields] = useState({
        name: contact.name || '',
        email: contact.email || '',
        custom_fields: { ...contact.custom_fields }
    });

    useEffect(() => {
        fetchFullContact();
    }, [contact.id]);

    const fetchFullContact = async () => {
        try {
            const res = await fetch(`/api/client/${clientId}/contacts/${contact.id}`);
            if (res.ok) {
                const data = await res.json();
                setFullContact(data);
                setEditedFields({
                    name: data.name || '',
                    email: data.email || '',
                    custom_fields: { ...data.custom_fields }
                });
            }
        } catch (error) {
            console.error('Error fetching contact:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/client/${clientId}/contacts/${contact.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editedFields)
            });

            if (res.ok) {
                const updated = await res.json();
                onUpdate({ ...fullContact, ...updated });
            }
        } catch (error) {
            console.error('Error saving contact:', error);
        } finally {
            setSaving(false);
        }
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatOutcome = (outcome: string) => {
        const map: Record<string, { label: string; color: string }> = {
            'assistant-ended-call': { label: 'Completed', color: 'bg-green-100 text-green-700' },
            'customer-ended-call': { label: 'Customer Hangup', color: 'bg-blue-100 text-blue-700' },
            'customer-did-not-answer': { label: 'No Answer', color: 'bg-yellow-100 text-yellow-700' },
            'voicemail': { label: 'Voicemail', color: 'bg-orange-100 text-orange-700' },
        };
        return map[outcome] || { label: outcome, color: 'bg-gray-100 text-gray-700' };
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-end z-50">
            <div className="bg-white h-full w-full max-w-lg shadow-xl flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                            {fullContact.name || 'Unknown Contact'}
                        </h3>
                        <p className="text-sm text-gray-500 font-mono">{fullContact.phone}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Core Fields */}
                    <div className="space-y-4">
                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                                <User className="w-4 h-4" />
                                Name
                            </label>
                            <input
                                type="text"
                                value={editedFields.name}
                                onChange={(e) => setEditedFields(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Enter name"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>

                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                                <Phone className="w-4 h-4" />
                                Phone
                            </label>
                            <input
                                type="text"
                                value={fullContact.phone}
                                disabled
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
                            />
                        </div>

                        <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                                <Mail className="w-4 h-4" />
                                Email
                            </label>
                            <input
                                type="email"
                                value={editedFields.email}
                                onChange={(e) => setEditedFields(prev => ({ ...prev, email: e.target.value }))}
                                placeholder="Enter email"
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    {/* Custom Fields */}
                    {customFields.length > 0 && (
                        <div className="space-y-4">
                            <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                <Plus className="w-4 h-4" />
                                Custom Properties
                            </h4>
                            {customFields.map((field) => (
                                <div key={field.id}>
                                    <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                                        {field.name}
                                    </label>
                                    {field.field_type === 'checkbox' ? (
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={!!editedFields.custom_fields[field.field_key]}
                                                onChange={(e) => setEditedFields(prev => ({
                                                    ...prev,
                                                    custom_fields: {
                                                        ...prev.custom_fields,
                                                        [field.field_key]: e.target.checked
                                                    }
                                                }))}
                                                className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                                            />
                                            <span className="text-sm text-gray-600">Yes</span>
                                        </label>
                                    ) : (
                                        <input
                                            type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                                            value={editedFields.custom_fields[field.field_key] || ''}
                                            onChange={(e) => setEditedFields(prev => ({
                                                ...prev,
                                                custom_fields: {
                                                    ...prev.custom_fields,
                                                    [field.field_key]: e.target.value
                                                }
                                            }))}
                                            placeholder={`Enter ${field.name.toLowerCase()}`}
                                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Conversation Summary */}
                    {fullContact.conversation_summary && (
                        <div>
                            <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2 mb-2">
                                <MessageSquare className="w-4 h-4" />
                                AI Summary
                            </h4>
                            <div className="bg-indigo-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line">
                                {fullContact.conversation_summary}
                            </div>
                        </div>
                    )}

                    {/* Emotional Intelligence Panel */}
                    {(fullContact.engagement_score !== undefined || fullContact.active_enrollment) && (
                        <div>
                            <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2 mb-3">
                                <Brain className="w-4 h-4" />
                                Emotional Intelligence
                            </h4>
                            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                                {/* Engagement Score */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-500 font-medium">Engagement</span>
                                    <EngagementMeter
                                        score={fullContact.engagement_score || 50}
                                        sentimentTrend={fullContact.sentiment_trend}
                                        size="sm"
                                    />
                                </div>

                                {/* Emotion & Intent Badges */}
                                {fullContact.active_enrollment && (
                                    <div className="space-y-2">
                                        <EmotionBadge
                                            emotion={fullContact.active_enrollment.last_emotion}
                                            isHotLead={fullContact.active_enrollment.is_hot_lead}
                                            isAtRisk={fullContact.active_enrollment.is_at_risk}
                                            needsHuman={fullContact.active_enrollment.needs_human_intervention}
                                            size="sm"
                                        />

                                        {/* Objections */}
                                        {fullContact.active_enrollment.objections_detected &&
                                            fullContact.active_enrollment.objections_detected.length > 0 && (
                                            <div>
                                                <span className="text-[10px] text-gray-400 uppercase font-medium">Objections</span>
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {fullContact.active_enrollment.objections_detected.map((obj, i) => (
                                                        <span
                                                            key={i}
                                                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                                                                obj.severity === 'strong' ? 'bg-red-100 text-red-600' :
                                                                obj.severity === 'moderate' ? 'bg-orange-100 text-orange-600' :
                                                                'bg-yellow-100 text-yellow-600'
                                                            }`}
                                                            title={obj.detail}
                                                        >
                                                            {obj.type}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Recommended Tone */}
                                        {fullContact.active_enrollment.recommended_tone && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-gray-400 uppercase font-medium">Tone</span>
                                                <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded capitalize">
                                                    {fullContact.active_enrollment.recommended_tone}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Cross-Channel Interaction Timeline */}
                    <div>
                        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2 mb-3">
                            <Activity className="w-4 h-4" />
                            Interaction Timeline
                        </h4>
                        <InteractionTimeline contactId={fullContact.id} />
                    </div>

                    {/* Call History */}
                    {fullContact.calls && fullContact.calls.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2 mb-3">
                                <Clock className="w-4 h-4" />
                                Call History ({fullContact.calls.length})
                            </h4>
                            <div className="space-y-3">
                                {fullContact.calls.map((call) => {
                                    const outcomeStyle = formatOutcome(call.outcome);
                                    return (
                                        <div key={call.id} className="border border-gray-200 rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs text-gray-500">
                                                    {new Date(call.called_at).toLocaleString()}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-500">
                                                        {formatDuration(call.duration_seconds)}
                                                    </span>
                                                    <span className={`text-xs px-2 py-0.5 rounded ${outcomeStyle.color}`}>
                                                        {outcomeStyle.label}
                                                    </span>
                                                </div>
                                            </div>
                                            {call.summary && (
                                                <p className="text-sm text-gray-600">{call.summary}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
