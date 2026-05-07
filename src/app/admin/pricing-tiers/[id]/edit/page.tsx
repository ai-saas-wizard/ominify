import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTierById } from "@/lib/pricing-tiers";
import { TierForm } from "../../_components/tier-form";

export const dynamic = "force-dynamic";

export default async function EditPricingTierPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const tier = await getTierById(id);
    if (!tier) notFound();

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
            <Link
                href="/admin/pricing-tiers"
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to tiers
            </Link>
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Edit tier</h1>
                <p className="mt-1 text-gray-600">
                    Changes affect new sign-ups and admin-driven retags. Existing
                    Stripe subscriptions keep their original price until cancel +
                    resubscribe.
                </p>
            </div>
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                ⚠️ Editing pricing fields affects new sign-ups only. Existing Stripe
                subscriptions keep the schedule they originally signed up for. To
                change pricing for active subscribers, contact them to resubscribe.
            </div>
            <TierForm
                mode="edit"
                initial={{
                    id: tier.id,
                    slug: tier.slug,
                    display_name: tier.display_name,
                    price_usd: tier.price_usd,
                    monthly_minutes: tier.monthly_minutes,
                    rollover_cap: tier.rollover_cap,
                    stripe_price_id: tier.stripe_price_id,
                    is_public: tier.is_public,
                    description: tier.description,
                    landing_eyebrow: tier.landing_eyebrow,
                    landing_headline: tier.landing_headline,
                    landing_subheadline: tier.landing_subheadline,
                    landing_features: tier.landing_features,
                    landing_cta_label: tier.landing_cta_label,
                    phases: tier.phases,
                }}
            />
        </div>
    );
}
