"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TIMEZONES } from "@/components/onboarding/constants";
import { RE_DEAL_TYPES } from "@/lib/verticals/real-estate-investor/definition";
import type { REInvestorFormData } from "@/lib/verticals/types";

interface VerticalOutboundSharedFormProps {
    initialData: Partial<REInvestorFormData>;
    onContinue: (data: Partial<REInvestorFormData>) => void;
    onBack: () => void;
}

/**
 * Slim shared-fields step shown before the outbound config screen.
 * Pre-fills from the existing tenant profile / inbound agent so users
 * adding a second agent only need to confirm the values that go into
 * the outbound prompt.
 */
export function VerticalOutboundSharedForm({
    initialData,
    onContinue,
    onBack,
}: VerticalOutboundSharedFormProps) {
    const [companyName, setCompanyName] = useState(
        initialData.companyName ?? ""
    );
    const [agentPersonaName, setAgentPersonaName] = useState(
        initialData.agentPersonaName ?? "Sam"
    );
    const [markets, setMarkets] = useState(initialData.markets ?? "");
    const [dealTypes, setDealTypes] = useState<string[]>(
        initialData.dealTypes ?? []
    );
    const [timezone, setTimezone] = useState(initialData.timezone ?? "");
    const [appointmentType, setAppointmentType] = useState(
        initialData.appointmentType ?? "in_person"
    );
    const [businessPhone, setBusinessPhone] = useState(
        initialData.businessPhone ?? ""
    );

    const toggleDealType = useCallback((value: string) => {
        setDealTypes((prev) =>
            prev.includes(value)
                ? prev.filter((v) => v !== value)
                : [...prev, value]
        );
    }, []);

    const canContinue =
        companyName.trim().length >= 2 &&
        agentPersonaName.trim().length >= 1 &&
        markets.trim().length > 0 &&
        dealTypes.length > 0 &&
        timezone.length > 0 &&
        businessPhone.trim().length >= 7;

    const handleContinue = useCallback(() => {
        onContinue({
            companyName: companyName.trim(),
            agentPersonaName: agentPersonaName.trim(),
            markets: markets.trim(),
            dealTypes,
            timezone,
            appointmentType,
            businessPhone: businessPhone.trim(),
        });
    }, [
        companyName,
        agentPersonaName,
        markets,
        dealTypes,
        timezone,
        appointmentType,
        businessPhone,
        onContinue,
    ]);

    return (
        <div className="flex min-h-screen items-start justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-2xl"
            >
                <button
                    onClick={onBack}
                    className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>

                <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
                        <Building2 className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            Confirm your business details
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">
                            We pre-filled these from your profile. Edit
                            anything that&apos;s wrong before we configure the
                            outbound agent.
                        </p>
                    </div>
                </div>

                <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Company name
                            </label>
                            <Input
                                className="mt-1.5"
                                value={companyName}
                                onChange={(e) =>
                                    setCompanyName(e.target.value)
                                }
                                placeholder="e.g., Tennessee Homebuyers"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                AI agent name
                            </label>
                            <Input
                                className="mt-1.5"
                                value={agentPersonaName}
                                onChange={(e) =>
                                    setAgentPersonaName(e.target.value)
                                }
                                placeholder="e.g., Sam"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-gray-700">
                            Markets / service areas
                        </label>
                        <Textarea
                            className="mt-1.5"
                            value={markets}
                            onChange={(e) => setMarkets(e.target.value)}
                            placeholder="e.g., Nashville TN, Davidson County"
                            rows={2}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium text-gray-700">
                            Deal types
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {RE_DEAL_TYPES.map((dt) => {
                                const selected = dealTypes.includes(dt.value);
                                return (
                                    <button
                                        key={dt.value}
                                        type="button"
                                        onClick={() => toggleDealType(dt.value)}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                            selected
                                                ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/30"
                                                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                        )}
                                    >
                                        {selected && (
                                            <Check className="h-3 w-3" />
                                        )}
                                        {dt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Timezone
                            </label>
                            <Select
                                value={timezone}
                                onValueChange={setTimezone}
                            >
                                <SelectTrigger className="mt-1.5">
                                    <SelectValue placeholder="Pick a timezone" />
                                </SelectTrigger>
                                <SelectContent>
                                    {TIMEZONES.map((tz) => (
                                        <SelectItem
                                            key={tz.value}
                                            value={tz.value}
                                        >
                                            {tz.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Callback number
                            </label>
                            <Input
                                className="mt-1.5"
                                value={businessPhone}
                                onChange={(e) =>
                                    setBusinessPhone(e.target.value)
                                }
                                placeholder="e.g., (615) 863-4486"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium text-gray-700">
                            How do appointments happen?
                        </label>
                        <Select
                            value={appointmentType}
                            onValueChange={setAppointmentType}
                        >
                            <SelectTrigger className="mt-1.5">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="in_person">
                                    In-Person Walkthrough
                                </SelectItem>
                                <SelectItem value="phone_only">
                                    Phone Call Only
                                </SelectItem>
                                <SelectItem value="both">Both</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                    <Button variant="outline" onClick={onBack}>
                        Back
                    </Button>
                    <Button disabled={!canContinue} onClick={handleContinue}>
                        Continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}
