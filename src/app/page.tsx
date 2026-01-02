import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isAdmin, getAccessibleClients } from "@/lib/auth";
import Link from "next/link";

export default async function HomePage() {
  const { userId } = await auth();

  // Not logged in - show landing page or redirect to sign-in
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await currentUser();
  const userEmail = user?.emailAddresses[0]?.emailAddress;

  if (!userEmail) {
    redirect("/sign-in");
  }

  // Check if user is admin
  const isUserAdmin = await isAdmin(userEmail) || await isAdmin(userId);

  if (isUserAdmin) {
    // Admin goes to admin dashboard
    redirect("/admin/clients");
  }

  // Check accessible clients
  const clients = await getAccessibleClients(userEmail);

  if (clients.length === 1) {
    // Single client - go directly to their dashboard
    redirect(`/client/${clients[0].id}/agents`);
  }

  if (clients.length > 1) {
    // Multiple clients - show selection page
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Select Account</h1>
            <p className="text-gray-600 mt-2">Choose which account to access</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/client/${client.id}/agents`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center text-violet-700 font-semibold">
                  {client.name?.charAt(0).toUpperCase() || 'C'}
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

  // No access to anything
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">No Access</h1>
        <p className="text-gray-600 mb-4">
          You don't have access to any accounts yet.
        </p>
        <p className="text-sm text-gray-500">
          Signed in as: <span className="font-medium">{userEmail}</span>
        </p>
        <p className="text-sm text-gray-400 mt-4">
          Contact an administrator to get access to an account.
        </p>
      </div>
    </div>
  );
}
