import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OfferForm } from "../_components/offer-form";

export const dynamic = "force-dynamic";

export default function NewOfferPage() {
    return (
        <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
            <Link
                href="/admin/offers"
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to offers
            </Link>
            <div>
                <h1 className="text-3xl font-bold text-gray-900">New offer</h1>
                <p className="mt-1 text-gray-600">
                    Create the landing page first, then assign tiers to it from
                    /admin/pricing-tiers.
                </p>
            </div>
            <OfferForm mode="create" />
        </div>
    );
}
