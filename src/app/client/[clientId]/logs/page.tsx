import { redirect } from "next/navigation";

// The call log grew into UNIBOX (voice + SMS + email per lead). Old links —
// including the agent test-call card's `?assistantId=` deep link — land there.
export default async function LogsRedirect({
    params,
    searchParams,
}: {
    params: Promise<{ clientId: string }>;
    searchParams: Promise<{ assistantId?: string }>;
}) {
    const { clientId } = await params;
    const { assistantId } = await searchParams;
    const query = assistantId ? `?agent=${encodeURIComponent(assistantId)}` : "";
    redirect(`/client/${clientId}/unibox${query}`);
}
