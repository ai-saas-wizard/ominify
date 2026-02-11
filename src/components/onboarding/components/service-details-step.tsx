"use client";

import { Wrench } from "lucide-react";
import type { StepProps, TenantProfile } from "../types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AIFieldBadge } from "./ai-field-badge";

interface ServiceDetailsStepProps extends StepProps {
    addJobType: () => void;
    updateJobType: (index: number, field: string, value: string) => void;
    removeJobType: (index: number) => void;
    updateServiceAreaCities: (value: string) => void;
    updateServiceAreaZips: (value: string) => void;
    updateServiceAreaRadius: (value: number) => void;
}

export function ServiceDetailsStep({
    form, fieldMeta, resetFieldToAI,
    addJobType, updateJobType, removeJobType,
    updateServiceAreaCities, updateServiceAreaZips, updateServiceAreaRadius,
}: ServiceDetailsStepProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Service Details</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Define your service area and the types of jobs you handle.
                </p>
            </div>

            {/* Service Area */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Service Area</h3>
                    <AIFieldBadge meta={fieldMeta.service_area} onReset={() => resetFieldToAI("service_area")} />
                </div>

                <div className="space-y-1.5">
                    <Label>Cities (comma-separated)</Label>
                    <Input
                        value={form.service_area.cities.join(", ")}
                        onChange={(e) => updateServiceAreaCities(e.target.value)}
                        placeholder="e.g., Dallas, Fort Worth, Arlington"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label>ZIP Codes (comma-separated)</Label>
                    <Input
                        value={form.service_area.zip_codes.join(", ")}
                        onChange={(e) => updateServiceAreaZips(e.target.value)}
                        placeholder="e.g., 75001, 75002, 75003"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label>Service Radius (miles)</Label>
                    <Input
                        type="number"
                        min={1}
                        max={500}
                        value={form.service_area.radius_miles}
                        onChange={(e) => updateServiceAreaRadius(parseInt(e.target.value) || 25)}
                        className="w-32"
                    />
                </div>
            </div>

            {/* Job Types */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Job Types</h3>
                    <div className="flex items-center gap-3">
                        <AIFieldBadge meta={fieldMeta.job_types} onReset={() => resetFieldToAI("job_types")} />
                        <Button type="button" variant="ghost" size="sm" onClick={addJobType}>
                            + Add Job Type
                        </Button>
                    </div>
                </div>

                {form.job_types.length === 0 && (
                    <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <Wrench className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No job types added yet.</p>
                        <Button type="button" variant="ghost" size="sm" onClick={addJobType} className="mt-2">
                            + Add your first job type
                        </Button>
                    </div>
                )}

                {form.job_types.map((jt, idx) => (
                    <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">Job Type #{idx + 1}</span>
                            <button
                                type="button"
                                onClick={() => removeJobType(idx)}
                                className="text-xs text-red-500 hover:text-red-700"
                            >
                                Remove
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Input
                                value={jt.name}
                                onChange={(e) => updateJobType(idx, "name", e.target.value)}
                                placeholder="Job name (e.g., AC Repair)"
                            />
                            <select
                                value={jt.urgency_tier}
                                onChange={(e) => updateJobType(idx, "urgency_tier", e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none text-sm"
                            >
                                <option value="critical">Critical</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                            <Input
                                value={jt.avg_ticket}
                                onChange={(e) => updateJobType(idx, "avg_ticket", e.target.value)}
                                placeholder="Avg ticket (e.g., $250)"
                            />
                            <Input
                                value={jt.keywords}
                                onChange={(e) => updateJobType(idx, "keywords", e.target.value)}
                                placeholder="Keywords (e.g., AC, cooling, heat)"
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
