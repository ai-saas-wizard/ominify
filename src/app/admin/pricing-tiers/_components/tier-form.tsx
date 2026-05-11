"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
    createTierAction,
    updateTierAction,
    type ActionResult,
} from "../actions";
import {
    PhasesEditor,
    phasesToJson,
    type EditablePhase,
} from "./phases-editor";
import type { TierPhase } from "@/lib/pricing-tiers-shared";

export interface OfferOption {
    id: string;
    name: string;
    slug: string;
}

export interface TierFormInitial {
    id?: string;
    slug: string;
    display_name: string;
    price_usd: number;
    monthly_minutes: number;
    rollover_cap: number;
    stripe_price_id: string;
    is_public: boolean;
    description: string | null;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
    landing_features: string[];
    landing_cta_label: string | null;
    phases: TierPhase[] | null;
    offer_id: string | null;
    sort_order: number;
    is_recommended: boolean;
}

const DEFAULTS: TierFormInitial = {
    slug: "",
    display_name: "",
    price_usd: 0,
    monthly_minutes: 1000,
    rollover_cap: 2000,
    stripe_price_id: "",
    is_public: false,
    description: "",
    landing_eyebrow: "",
    landing_headline: "",
    landing_subheadline: "",
    landing_features: [],
    landing_cta_label: "",
    phases: null,
    offer_id: null,
    sort_order: 0,
    is_recommended: false,
};

function tierPhasesToEditable(phases: TierPhase[] | null): EditablePhase[] {
    if (!phases || phases.length === 0) return [];
    return phases.map((p) => ({
        stripe_price_id: p.stripe_price_id,
        price_usd: String(p.price_usd),
        monthly_minutes: String(p.monthly_minutes),
        duration_months: p.duration_months === null ? "" : String(p.duration_months),
    }));
}

function randomSuffix(length = 6): string {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // skip ambiguous chars
    let out = "";
    if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
        const buf = new Uint32Array(length);
        window.crypto.getRandomValues(buf);
        for (let i = 0; i < length; i++) {
            out += alphabet[buf[i] % alphabet.length];
        }
    } else {
        for (let i = 0; i < length; i++) {
            out += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
    }
    return out;
}

function suggestionFromBase(base: string): string {
    const cleaned = base
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    if (!cleaned) return "";
    return `${cleaned}-${randomSuffix()}`;
}

export function TierForm({
    initial,
    mode,
    offers,
}: {
    initial?: TierFormInitial;
    mode: "create" | "edit";
    offers: OfferOption[];
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const init = initial ?? DEFAULTS;

    const [slug, setSlug] = useState(init.slug);
    const [features, setFeatures] = useState(init.landing_features.join("\n"));
    const [isPublic, setIsPublic] = useState(init.is_public);
    const [offerId, setOfferId] = useState<string>(init.offer_id ?? "");
    const [sortOrder, setSortOrder] = useState(String(init.sort_order ?? 0));
    const [isRecommended, setIsRecommended] = useState(init.is_recommended);

    // Multi-phase state. When enabled, top-level price fields mirror phase 1
    // and are disabled; on submit we serialize phases as JSON.
    const initialPhasesEditable = tierPhasesToEditable(init.phases);
    const [multiPhase, setMultiPhase] = useState(initialPhasesEditable.length > 1);
    const [phases, setPhases] = useState<EditablePhase[]>(
        initialPhasesEditable.length > 0 ? initialPhasesEditable : []
    );
    const [stripePriceId, setStripePriceId] = useState(init.stripe_price_id);
    const [priceUsd, setPriceUsd] = useState(init.price_usd ? String(init.price_usd) : "");
    const [monthlyMinutes, setMonthlyMinutes] = useState(String(init.monthly_minutes));

    // Keep top-level fields in sync with phase 1 while multi-phase is on
    const syncFromPhase1 = useCallback((p1: EditablePhase) => {
        setStripePriceId(p1.stripe_price_id);
        setPriceUsd(p1.price_usd);
        setMonthlyMinutes(p1.monthly_minutes);
    }, []);

    const suggestion = useMemo(() => {
        if (mode !== "create") return "";
        if (!slug || /[a-zA-Z0-9_-]{1,}-[a-z0-9]{4,}$/.test(slug)) return "";
        return suggestionFromBase(slug);
    }, [slug, mode]);

    function applySuggestion() {
        if (suggestion) setSlug(suggestion);
    }

    async function handleSubmit(formData: FormData) {
        setError(null);
        formData.set("slug", slug);
        formData.set("landing_features", features);
        formData.set("is_public", isPublic ? "on" : "");
        formData.set("phases", phasesToJson(multiPhase, phases));
        formData.set("offer_id", offerId);
        formData.set("sort_order", sortOrder);
        formData.set("is_recommended", isRecommended ? "on" : "");
        // When multi-phase is on, controlled fields drive the submitted values
        // (the inputs are disabled but state still owns the truth).
        if (multiPhase) {
            formData.set("stripe_price_id", stripePriceId);
            formData.set("price_usd", priceUsd);
            formData.set("monthly_minutes", monthlyMinutes);
        }

        startTransition(async () => {
            let result: ActionResult<{ id: string }>;
            if (mode === "create") {
                result = await createTierAction(formData);
            } else if (initial?.id) {
                const r = await updateTierAction(initial.id, formData);
                result = r as ActionResult<{ id: string }>;
            } else {
                result = { ok: false, error: "Missing tier id." };
            }

            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.push("/admin/pricing-tiers");
            router.refresh();
        });
    }

    return (
        <form action={handleSubmit} className="space-y-8 max-w-2xl">
            {/* Pricing fields */}
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Pricing</h2>

                <div>
                    <Label htmlFor="slug">Slug (URL identifier)</Label>
                    <Input
                        id="slug"
                        name="slug"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="realestate"
                        required
                    />
                    {mode === "create" && suggestion && !isPublic && (
                        <p className="mt-1 text-xs text-gray-500">
                            Suggested: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{suggestion}</code>{" "}
                            <button
                                type="button"
                                onClick={applySuggestion}
                                className="text-emerald-700 underline ml-1"
                            >
                                Use suggested
                            </button>
                        </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                        Anyone with the URL <code>/offers/{slug || "<slug>"}</code> gets this tier.
                        For private campaigns, append a random suffix so it&apos;s not guessable.
                    </p>
                </div>

                <div>
                    <Label htmlFor="display_name">Display name</Label>
                    <Input
                        id="display_name"
                        name="display_name"
                        defaultValue={init.display_name}
                        placeholder="Real Estate Pro"
                        required
                    />
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <Label htmlFor="price_usd">Price (USD/mo)</Label>
                        <Input
                            id="price_usd"
                            name="price_usd"
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={priceUsd}
                            onChange={(e) => setPriceUsd(e.target.value)}
                            disabled={multiPhase}
                            required
                        />
                    </div>
                    <div>
                        <Label htmlFor="monthly_minutes">Monthly minutes</Label>
                        <Input
                            id="monthly_minutes"
                            name="monthly_minutes"
                            type="number"
                            min="1"
                            step="1"
                            value={monthlyMinutes}
                            onChange={(e) => setMonthlyMinutes(e.target.value)}
                            disabled={multiPhase}
                            required
                        />
                    </div>
                    <div>
                        <Label htmlFor="rollover_cap">Rollover cap</Label>
                        <Input
                            id="rollover_cap"
                            name="rollover_cap"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={init.rollover_cap}
                            required
                        />
                    </div>
                </div>

                <div>
                    <Label htmlFor="stripe_price_id">Stripe price ID</Label>
                    <Input
                        id="stripe_price_id"
                        name="stripe_price_id"
                        value={stripePriceId}
                        onChange={(e) => setStripePriceId(e.target.value)}
                        disabled={multiPhase}
                        placeholder="price_1Txxxxxx"
                        required
                    />
                    <p className="mt-1 text-xs text-gray-400">
                        {multiPhase
                            ? "Managed by Phase 1 below."
                            : "Create a Product + Price in Stripe Dashboard, then paste the Price ID here."}
                    </p>
                </div>

                {/* Multi-phase pricing editor */}
                <PhasesEditor
                    enabled={multiPhase}
                    onEnabledChange={setMultiPhase}
                    phases={phases}
                    onPhasesChange={setPhases}
                    syncSinglePhase={syncFromPhase1}
                />

                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50">
                    <div>
                        <Label htmlFor="is_public" className="cursor-pointer">
                            Public tier
                        </Label>
                        <p className="text-xs text-gray-500 mt-0.5">
                            The default tier shown to general-public sign-ups. Only one tier
                            can be public at a time — saving will demote any current public tier.
                        </p>
                    </div>
                    <Switch
                        id="is_public"
                        checked={isPublic}
                        onCheckedChange={setIsPublic}
                    />
                </div>

                <div>
                    <Label htmlFor="description">Internal description (optional)</Label>
                    <Textarea
                        id="description"
                        name="description"
                        defaultValue={init.description ?? ""}
                        rows={2}
                        placeholder="Notes for admins — not shown to customers."
                    />
                </div>
            </section>

            {/* Offer assignment */}
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Offer assignment</h2>
                <p className="text-xs text-gray-500 -mt-2">
                    Optionally include this tier as one card on a multi-tier offer page.
                    When set, the tier is rendered alongside other tiers in the same offer.
                </p>

                <div>
                    <Label htmlFor="offer_id">Offer</Label>
                    <select
                        id="offer_id"
                        name="offer_id"
                        value={offerId}
                        onChange={(e) => setOfferId(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    >
                        <option value="">(none — standalone tier)</option>
                        {offers.map((o) => (
                            <option key={o.id} value={o.id}>
                                {o.name} ({o.slug})
                            </option>
                        ))}
                    </select>
                </div>

                {offerId && (
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="sort_order">Sort order</Label>
                            <Input
                                id="sort_order"
                                name="sort_order"
                                type="number"
                                min="0"
                                step="1"
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value)}
                            />
                            <p className="mt-1 text-xs text-gray-400">
                                Lower values render first.
                            </p>
                        </div>
                        <div className="flex items-end">
                            <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50/50 w-full">
                                <Label htmlFor="is_recommended" className="cursor-pointer">
                                    Recommended (Most Popular)
                                </Label>
                                <Switch
                                    id="is_recommended"
                                    checked={isRecommended}
                                    onCheckedChange={setIsRecommended}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* Landing page content */}
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Landing page</h2>
                <p className="text-xs text-gray-500 -mt-2">
                    Rendered at <code>/offers/{slug || "<slug>"}</code> when visitors click your campaign link.
                </p>

                <div>
                    <Label htmlFor="landing_eyebrow">Eyebrow (small label above headline)</Label>
                    <Input
                        id="landing_eyebrow"
                        name="landing_eyebrow"
                        defaultValue={init.landing_eyebrow ?? ""}
                        placeholder="REAL ESTATE PRO PROGRAM"
                    />
                </div>

                <div>
                    <Label htmlFor="landing_headline">Headline</Label>
                    <Input
                        id="landing_headline"
                        name="landing_headline"
                        defaultValue={init.landing_headline ?? ""}
                        placeholder="AI voice agents for real estate teams"
                    />
                </div>

                <div>
                    <Label htmlFor="landing_subheadline">Subheadline</Label>
                    <Textarea
                        id="landing_subheadline"
                        name="landing_subheadline"
                        defaultValue={init.landing_subheadline ?? ""}
                        rows={2}
                        placeholder="Qualify leads, book showings, follow up on listings — all on autopilot."
                    />
                </div>

                <div>
                    <Label htmlFor="landing_features">Features (one per line)</Label>
                    <Textarea
                        id="landing_features"
                        name="landing_features"
                        value={features}
                        onChange={(e) => setFeatures(e.target.value)}
                        rows={5}
                        placeholder={"500 voice minutes/month\nAuto-qualify buyer leads\nBook showings into your calendar\nCancel anytime"}
                    />
                </div>

                <div>
                    <Label htmlFor="landing_cta_label">CTA button label</Label>
                    <Input
                        id="landing_cta_label"
                        name="landing_cta_label"
                        defaultValue={init.landing_cta_label ?? ""}
                        placeholder="Claim Real Estate Pricing"
                    />
                </div>
            </section>

            {/* Submit */}
            <div className="flex items-center gap-3 pt-2">
                <button
                    type="submit"
                    disabled={pending}
                    className="px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {pending
                        ? mode === "create"
                            ? "Creating…"
                            : "Saving…"
                        : mode === "create"
                          ? "Create tier"
                          : "Save changes"}
                </button>
                <button
                    type="button"
                    onClick={() => router.push("/admin/pricing-tiers")}
                    className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    Cancel
                </button>
                {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
        </form>
    );
}
