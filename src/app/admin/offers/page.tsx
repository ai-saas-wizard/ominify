import Link from "next/link";
import { Plus, EyeOff } from "lucide-react";
import { listOffers, getTierCountsByOffer } from "@/lib/offers";
import { getAppUrl } from "@/lib/app-url";
import { OfferRowActions } from "./_components/offer-row-actions";

export const dynamic = "force-dynamic";

export default async function OffersAdminPage() {
    const [offers, counts] = await Promise.all([listOffers(), getTierCountsByOffer()]);
    const appUrl = getAppUrl();

    return (
        <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Offers</h1>
                    <p className="mt-1 text-gray-600">
                        Multi-tier landing pages. Each offer renders a card per assigned tier
                        at <code>/offers/[slug]</code>.
                    </p>
                </div>
                <Link
                    href="/admin/offers/new"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    New offer
                </Link>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            <th className="px-4 py-3">Offer</th>
                            <th className="px-4 py-3">Tiers</th>
                            <th className="px-4 py-3">Campaign URL</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {offers.map((offer) => {
                            const offerUrl = `${appUrl}/offers/${offer.slug}`;
                            const tierCount = counts[offer.id] ?? 0;
                            return (
                                <tr key={offer.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="font-semibold text-gray-900">
                                            {offer.name}
                                        </div>
                                        <code className="text-xs text-gray-500">{offer.slug}</code>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700">
                                        {tierCount === 0 ? (
                                            <span className="text-xs text-amber-700">No tiers</span>
                                        ) : (
                                            <span>{tierCount} tier{tierCount === 1 ? "" : "s"}</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <code className="text-xs text-gray-700 break-all">
                                            /offers/{offer.slug}
                                        </code>
                                    </td>
                                    <td className="px-4 py-3">
                                        {offer.is_active ? (
                                            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                                                Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                <EyeOff className="w-3 h-3" /> Inactive
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <OfferRowActions
                                            offerId={offer.id}
                                            isActive={offer.is_active}
                                            offerUrl={offerUrl}
                                            tierCount={tierCount}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                        {offers.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                                    No offers yet. Create one to bundle multiple tiers under a single URL.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
