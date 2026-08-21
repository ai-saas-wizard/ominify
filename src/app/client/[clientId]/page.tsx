import { redirect } from "next/navigation";

/**
 * The client area has no dashboard of its own — this route used to render a
 * placeholder whose metrics were hardcoded zeros, and the sidebar never linked
 * to it. Several flows still land here (post-onboarding, post-deploy, the
 * phone-numbers account-type gate, and "back" links from billing/settings), so
 * the route has to keep resolving: send them to Agents, the first real item in
 * the sidebar, instead of a dead end.
 */
export default async function ClientIndexPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await props.params;
    redirect(`/client/${clientId}/agents`);
}
