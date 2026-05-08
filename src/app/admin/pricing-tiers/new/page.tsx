import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listOffers } from "@/lib/offers";
import { TierForm } from "../_components/tier-form";

export const dynamic = "force-dynamic";

export default async function NewPricingTierPage() {
    const offers = await listOffers();
    const offerOptions = offers
        .filter((o) => o.is_active)
        .map((o) => ({ id: o.id, name: o.name, slug: o.slug }));

    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
            <Link
                href="/admin/pricing-tiers"
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to tiers
            </Link>
            <div>
                <h1 className="text-3xl font-bold text-gray-900">New pricing tier</h1>
                <p className="mt-1 text-gray-600">
                    Create a Product + Price in Stripe Dashboard first, then paste the Price ID here.
                </p>
            </div>
            <TierForm mode="create" offers={offerOptions} />
        </div>
    );
}
