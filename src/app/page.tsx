import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isAdmin, getAccessibleClients, addClientMember } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

// Get the single active umbrella
async function getActiveUmbrellaForSignup() {
  const { data: umbrella } = await supabase
    .from("vapi_umbrellas")
    .select("id, name, vapi_api_key_encrypted, vapi_org_id")
    .eq("is_active", true)
    .limit(1)
    .single();

  return umbrella || null;
}

// Auto-provision a new UMBRELLA client for a self-serve sign-up
async function autoProvisionUmbrellaClient(
  userEmail: string,
  userId: string,
  userName: string
) {
  // Get the single active umbrella
  const umbrella = await getActiveUmbrellaForSignup();
  if (!umbrella) return null;

  // Create the client record
  const { data: newClient, error: clientError } = await supabase
    .from("clients")
    .insert({
      name: userName || userEmail.split("@")[0],
      email: userEmail.toLowerCase().trim(),
      account_type: "UMBRELLA",
      vapi_key: umbrella.vapi_api_key_encrypted,
      vapi_org_id: umbrella.vapi_org_id,
      clerk_id: userId, // Real Clerk ID — no placeholder needed
    })
    .select("id")
    .single();

  if (clientError || !newClient) {
    console.error("[AUTO-PROVISION] Client creation failed:", clientError);
    return null;
  }

  const clientId = newClient.id;

  // Create client_members entry (owner)
  await addClientMember(clientId, userEmail, "owner", "self-serve");

  // Assign to umbrella
  await supabase.from("tenant_vapi_assignments").insert({
    client_id: clientId,
    umbrella_id: umbrella.id,
    tenant_concurrency_cap: 2,
    priority_weight: 1.0,
    assigned_by: "self-serve",
  });

  // Create empty tenant profile (filled during onboarding)
  await supabase.from("tenant_profiles").insert({
    client_id: clientId,
  });

  // Create billing record
  await supabase.from("client_billing").insert({
    client_id: clientId,
  });

  // Create minute balance
  await supabase.from("minute_balances").insert({
    client_id: clientId,
    balance_minutes: 0,
    total_purchased_minutes: 0,
    total_used_minutes: 0,
  });

  console.log(
    `[AUTO-PROVISION] Created UMBRELLA client ${clientId} for ${userEmail}, assigned to umbrella ${umbrella.name} (${umbrella.id})`
  );

  return clientId;
}

export default async function HomePage() {
  const { userId } = await auth();

  // Not logged in - redirect to sign-in
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await currentUser();
  const userEmail = user?.emailAddresses[0]?.emailAddress;

  if (!userEmail) {
    redirect("/sign-in");
  }

  // Check if user is admin
  const isUserAdmin =
    (await isAdmin(userEmail)) || (await isAdmin(userId));

  if (isUserAdmin) {
    redirect("/admin/clients");
  }

  // Check accessible clients
  const clients = await getAccessibleClients(userEmail);

  if (clients.length === 1) {
    const client = clients[0];

    // Update clerk_id if still a placeholder
    await supabase
      .from("clients")
      .update({ clerk_id: userId })
      .eq("id", client.id)
      .like("clerk_id", "pending_%");

    // Check if UMBRELLA client needs onboarding
    const { data: clientRecord } = await supabase
      .from("clients")
      .select("account_type")
      .eq("id", client.id)
      .single();

    if (clientRecord?.account_type === "UMBRELLA") {
      const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("onboarding_completed")
        .eq("client_id", client.id)
        .single();

      if (!profile?.onboarding_completed) {
        redirect(`/client/${client.id}/onboarding`);
      }
    }

    redirect(`/client/${client.id}/agents`);
  }

  if (clients.length > 1) {
    // Multiple clients - show selection page
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">
              Select Account
            </h1>
            <p className="text-gray-600 mt-2">
              Choose which account to access
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/client/${client.id}/agents`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center text-violet-700 font-semibold">
                  {client.name?.charAt(0).toUpperCase() || "C"}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{client.name}</p>
                  <p className="text-sm text-gray-500">{client.email}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ═══ 0 ACCESSIBLE CLIENTS — Auto-provision or link ═══

  // Step 1: Check if admin pre-created a client with this email
  const { data: matchingClient } = await supabase
    .from("clients")
    .select("id, account_type")
    .eq("email", userEmail.toLowerCase())
    .single();

  if (matchingClient) {
    // Auto-link: create client_members entry + update clerk_id
    await addClientMember(matchingClient.id, userEmail, "owner", "auto-link");
    await supabase
      .from("clients")
      .update({ clerk_id: userId })
      .eq("id", matchingClient.id);

    if (matchingClient.account_type === "UMBRELLA") {
      redirect(`/client/${matchingClient.id}/onboarding`);
    } else {
      redirect(`/client/${matchingClient.id}/agents`);
    }
  }

  // Step 2: Self-serve sign-up — auto-provision a new UMBRELLA account
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "";
  const newClientId = await autoProvisionUmbrellaClient(
    userEmail,
    userId,
    userName
  );

  if (newClientId) {
    redirect(`/client/${newClientId}/onboarding`);
  }

  // Step 3: No umbrellas available — show "at capacity" message
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          We&apos;re at Capacity
        </h1>
        <p className="text-gray-600 mb-4">
          We&apos;re currently onboarding new clients and all available slots
          are full. Please check back soon — we&apos;re adding more capacity.
        </p>
        <p className="text-sm text-gray-500">
          Signed in as:{" "}
          <span className="font-medium">{userEmail}</span>
        </p>
        <Link
          href="/sign-out"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Sign Out
        </Link>
      </div>
    </div>
  );
}
