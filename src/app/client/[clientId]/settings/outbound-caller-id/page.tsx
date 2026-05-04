import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getOutboundCallerIdState } from "@/app/actions/default-outbound-phone-actions";
import { OutboundCallerIdEditor } from "@/components/settings/outbound-caller-id-editor";

export default async function OutboundCallerIdPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    const clientId = params.clientId;

    const state = await getOutboundCallerIdState(clientId);

    return (
        <div className="p-4 lg:p-8 max-w-3xl mx-auto">
            <div className="mb-8">
                <Link
                    href={`/client/${clientId}/settings`}
                    className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Settings
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">
                    Outbound Caller ID
                </h1>
                <p className="mt-1 text-gray-600">
                    The default phone number for outbound calls placed by your
                    agents. Per-agent assignments (set on the agent detail page)
                    still take precedence when present.
                </p>
            </div>

            <OutboundCallerIdEditor
                clientId={clientId}
                initialDefaultPhoneId={state.defaultPhoneId}
                phones={state.available}
            />
        </div>
    );
}
