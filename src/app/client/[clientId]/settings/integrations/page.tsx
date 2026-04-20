import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCalendarConnectionStatus, disconnectCalendar, updateCalendarSettings } from "@/lib/google-calendar";
import { getSheetsConnectionStatus, disconnectSheets } from "@/lib/google-sheets";
import { getCalendlyConnectionStatus, listEventTypes as listCalendlyEventTypesLib } from "@/lib/calendly";
import {
    connectCalendlyAction,
    setCalendlyEventTypeAction,
    disconnectCalendlyAction,
} from "@/app/actions/calendly-actions";
import { revalidatePath } from "next/cache";
import { PageTransition } from "@/components/ui/page-transition";
import { IntegrationsContent } from "@/components/settings/integrations-content";

export default async function IntegrationsPage(props: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ success?: string; error?: string }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const clientId = params.clientId;

    const calendarStatus = await getCalendarConnectionStatus(clientId);
    const isConnected = calendarStatus?.is_active === true;

    const sheetsStatus = await getSheetsConnectionStatus(clientId);
    const isSheetsConnected = sheetsStatus?.is_active === true;

    const calendlyStatus = await getCalendlyConnectionStatus(clientId);
    const isCalendlyConnected = calendlyStatus?.is_active === true;
    const calendlyEventTypes = isCalendlyConnected
        ? await listCalendlyEventTypesLib(clientId)
        : [];

    async function handleDisconnect() {
        "use server";
        await disconnectCalendar(clientId);
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    async function handleUpdateSettings(formData: FormData) {
        "use server";
        const duration = parseInt(formData.get("duration") as string) || 60;
        const buffer = parseInt(formData.get("buffer") as string) || 15;
        const window = parseInt(formData.get("window") as string) || 14;

        await updateCalendarSettings(clientId, {
            default_duration_minutes: duration,
            buffer_minutes: buffer,
            booking_window_days: window,
        });
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    async function handleSheetsDisconnect() {
        "use server";
        await disconnectSheets(clientId);
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    async function handleCalendlyConnect(formData: FormData) {
        "use server";
        formData.set("clientId", clientId);
        const result = await connectCalendlyAction(formData);
        const qs = result.success
            ? "success=calendly"
            : `error=calendly_failed&reason=${encodeURIComponent(result.error || "")}`;
        revalidatePath(`/client/${clientId}/settings/integrations`);
        return { success: result.success, error: result.error, qs };
    }

    async function handleCalendlySetEventType(formData: FormData) {
        "use server";
        formData.set("clientId", clientId);
        await setCalendlyEventTypeAction(formData);
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    async function handleCalendlyDisconnect() {
        "use server";
        const fd = new FormData();
        fd.set("clientId", clientId);
        await disconnectCalendlyAction(fd);
        revalidatePath(`/client/${clientId}/settings/integrations`);
    }

    return (
        <PageTransition>
            <div className="p-4 lg:p-8 max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href={`/client/${clientId}/settings`}
                        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Settings
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
                    <p className="mt-1 text-gray-600">
                        Connect external services to enhance your AI agents
                    </p>
                </div>

                <IntegrationsContent
                    clientId={clientId}
                    isConnected={isConnected}
                    calendarStatus={calendarStatus}
                    isSheetsConnected={isSheetsConnected}
                    sheetsStatus={sheetsStatus}
                    isCalendlyConnected={isCalendlyConnected}
                    calendlyStatus={calendlyStatus}
                    calendlyEventTypes={calendlyEventTypes}
                    searchParams={searchParams}
                    handleDisconnect={handleDisconnect}
                    handleUpdateSettings={handleUpdateSettings}
                    handleSheetsDisconnect={handleSheetsDisconnect}
                    handleCalendlyConnect={handleCalendlyConnect}
                    handleCalendlySetEventType={handleCalendlySetEventType}
                    handleCalendlyDisconnect={handleCalendlyDisconnect}
                />
            </div>
        </PageTransition>
    );
}
