"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    Users,
    Phone,
    CreditCard,
    Settings,
    Bot,
    GitBranch,
    Inbox,
    BarChart3,
    KanbanSquare
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { MinuteBalanceDisplay } from "./minute-balance-display";
import { WorkspaceDisplay } from "./workspace-display";
import { NotificationCenter } from "./notification-center";

export interface SidebarInitialData {
    clientId: string;
    accountType: string | null;
    businessName: string | null;
    clientName: string | null;
    balance: number | null;
    accessibleClients: Array<{ id: string; name: string; business_name: string | null }>;
    initialUnreadCount: number;
}

const baseRoutes = [
    { label: "Agents", icon: Bot, href: "/agents" },
    { label: "Contacts", icon: Users, href: "/contacts" },
    { label: "Pipeline", icon: KanbanSquare, href: "/pipeline" },
    { label: "Analytics", icon: BarChart3, href: "/analytics" },
    { label: "UNIBOX", icon: Inbox, href: "/unibox" },
    { label: "Billing", icon: CreditCard, href: "/billing" },
];

const umbrellaRoutes = [
    { label: "Sequences", icon: GitBranch, href: "/sequences" },
    { label: "Phone Numbers", icon: Phone, href: "/phone-numbers" },
];

const bottomRoutes = [
    { label: "Settings", icon: Settings, href: "/settings" },
];

export const Sidebar = ({ initialData }: { initialData: SidebarInitialData }) => {
    const pathname = usePathname();
    const {
        clientId,
        accountType,
        businessName,
        clientName,
        balance,
        accessibleClients,
        initialUnreadCount,
    } = initialData;

    const isUmbrella = accountType === "UMBRELLA";
    const routes = isUmbrella ? [...baseRoutes, ...umbrellaRoutes] : baseRoutes;

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            <div className="flex items-center justify-between pr-2">
                <div className="flex-1 min-w-0">
                    <WorkspaceDisplay
                        clientId={clientId}
                        initialCurrentClient={{
                            id: clientId,
                            name: clientName || "",
                            business_name: businessName,
                        }}
                        initialAllClients={accessibleClients}
                    />
                </div>
                <NotificationCenter clientId={clientId} initialUnreadCount={initialUnreadCount} />
            </div>

            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-200">
                {routes.map((route) => {
                    const href = `/client/${clientId}${route.href}`;
                    const isActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                        <Link
                            key={route.href}
                            href={href}
                            data-walkthrough-id={`nav-${route.href.replace("/", "")}`}
                            className={cn(
                                "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors mb-0.5",
                                isActive
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <route.icon className={cn("h-4 w-4 mr-3", isActive ? "text-emerald-600" : "text-gray-400")} />
                            {route.label}
                        </Link>
                    )
                })}

                <div className="my-4 border-t border-gray-100 mx-3" />

                {bottomRoutes.map((route) => {
                    const href = `/client/${clientId}${route.href}`;
                    const isActive = pathname === href;
                    return (
                        <Link
                            key={route.href}
                            href={href}
                            data-walkthrough-id={`nav-${route.href.replace("/", "")}`}
                            className={cn(
                                "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors mb-0.5",
                                isActive
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <route.icon className={cn("h-4 w-4 mr-3", isActive ? "text-emerald-600" : "text-gray-400")} />
                            {route.label}
                        </Link>
                    )
                })}
            </div>

            <div className="p-4 border-t border-gray-100 space-y-3">
                <MinuteBalanceDisplay clientId={clientId} initialBalance={balance} />

                <div className="flex items-center gap-2 px-1 py-2">
                    <UserButton
                        afterSignOutUrl="/sign-in"
                        appearance={{
                            elements: {
                                avatarBox: "w-8 h-8"
                            }
                        }}
                    />
                    <div className="flex-1 min-w-0">
                        <span className="text-xs text-gray-600 truncate block">Account</span>
                    </div>
                </div>

                <p className="text-[10px] text-gray-400 text-center">
                    Powered by <span className="font-medium">Omnify CRM</span>
                </p>
            </div>
        </div>
    );
};
