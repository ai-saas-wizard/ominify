"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
    createOfferAction,
    updateOfferAction,
    type ActionResult,
} from "../actions";

export interface OfferFormInitial {
    id?: string;
    slug: string;
    name: string;
    is_active: boolean;
    landing_eyebrow: string | null;
    landing_headline: string | null;
    landing_subheadline: string | null;
}

const DEFAULTS: OfferFormInitial = {
    slug: "",
    name: "",
    is_active: true,
    landing_eyebrow: "",
    landing_headline: "",
    landing_subheadline: "",
};

function randomSuffix(length = 6): string {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
        const buf = new Uint32Array(length);
        window.crypto.getRandomValues(buf);
        for (let i = 0; i < length; i++) out += alphabet[buf[i] % alphabet.length];
    } else {
        for (let i = 0; i < length; i++)
            out += alphabet[Math.floor(Math.random() * alphabet.length)];
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

export function OfferForm({
    initial,
    mode,
}: {
    initial?: OfferFormInitial;
    mode: "create" | "edit";
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const init = initial ?? DEFAULTS;

    const [slug, setSlug] = useState(init.slug);
    const [isActive, setIsActive] = useState(init.is_active);

    const suggestion =
        mode === "create" && slug && !/[a-zA-Z0-9_-]{1,}-[a-z0-9]{4,}$/.test(slug)
            ? suggestionFromBase(slug)
            : "";

    async function handleSubmit(formData: FormData) {
        setError(null);
        formData.set("slug", slug);
        formData.set("is_active", isActive ? "on" : "");

        startTransition(async () => {
            let result: ActionResult<{ id: string }>;
            if (mode === "create") {
                result = await createOfferAction(formData);
            } else if (initial?.id) {
                const r = await updateOfferAction(initial.id, formData);
                result = r as ActionResult<{ id: string }>;
            } else {
                result = { ok: false, error: "Missing offer id." };
            }
            if (!result.ok) {
                setError(result.error);
                return;
            }
            router.push("/admin/offers");
            router.refresh();
        });
    }

    return (
        <form action={handleSubmit} className="space-y-8 max-w-2xl">
            <section className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Offer</h2>

                <div>
                    <Label htmlFor="slug">Slug (URL identifier)</Label>
                    <Input
                        id="slug"
                        name="slug"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="realestate-pro-program"
                        required
                    />
                    {mode === "create" && suggestion && (
                        <p className="mt-1 text-xs text-gray-500">
                            Suggested:{" "}
                            <code className="bg-gray-100 px-1.5 py-0.5 rounded">
                                {suggestion}
                            </code>{" "}
                            <button
                                type="button"
                                onClick={() => setSlug(suggestion)}
                                className="text-emerald-700 underline ml-1"
                            >
                                Use suggested
                            </button>
                        </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                        Customers will land on <code>/offers/{slug || "<slug>"}</code> and
                        see all tiers in this offer.
                    </p>
                </div>

                <div>
                    <Label htmlFor="name">Name (internal)</Label>
                    <Input
                        id="name"
                        name="name"
                        defaultValue={init.name}
                        placeholder="Real Estate Pro Program"
                        required
                    />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50">
                    <div>
                        <Label htmlFor="is_active" className="cursor-pointer">
                            Active
                        </Label>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Inactive offers redirect to /sign-up silently. Tiers in this
                            offer remain subscribable via their own slug if any.
                        </p>
                    </div>
                    <Switch
                        id="is_active"
                        checked={isActive}
                        onCheckedChange={setIsActive}
                    />
                </div>
            </section>

            <section className="space-y-4">
                <h2 className="text-base font-semibold text-gray-900">Landing copy</h2>
                <p className="text-xs text-gray-500 -mt-2">
                    Renders above the tier cards on <code>/offers/{slug || "<slug>"}</code>.
                </p>

                <div>
                    <Label htmlFor="landing_eyebrow">Eyebrow</Label>
                    <Input
                        id="landing_eyebrow"
                        name="landing_eyebrow"
                        defaultValue={init.landing_eyebrow ?? ""}
                        placeholder="REAL ESTATE PROGRAM"
                    />
                </div>
                <div>
                    <Label htmlFor="landing_headline">Headline</Label>
                    <Input
                        id="landing_headline"
                        name="landing_headline"
                        defaultValue={init.landing_headline ?? ""}
                        placeholder="Three plans for real estate teams"
                    />
                </div>
                <div>
                    <Label htmlFor="landing_subheadline">Subheadline</Label>
                    <Textarea
                        id="landing_subheadline"
                        name="landing_subheadline"
                        defaultValue={init.landing_subheadline ?? ""}
                        rows={2}
                        placeholder="Pick the one that fits your volume."
                    />
                </div>
            </section>

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
                          ? "Create offer"
                          : "Save changes"}
                </button>
                <button
                    type="button"
                    onClick={() => router.push("/admin/offers")}
                    className="px-5 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    Cancel
                </button>
                {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
        </form>
    );
}
