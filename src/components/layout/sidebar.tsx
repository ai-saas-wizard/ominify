"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
    LayoutDashboard,
    Users,
    Phone,
    CreditCard,
    Settings,
    Bot,
    BookOpen,
    Zap,
    GitBranch,
    PlayCircle,
    Contact,
    Puzzle,
    FileText,
    Building2,
    ChevronDown,
    BarChart3
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { MinuteBalanceDisplay } from "./minute-balance-display";
import { WorkspaceDisplay } from "./workspace-display";

const baseRoutes = [
    {
        label: "Agents",
        icon: Bot,
        href: "/agents",
    },
    {
        label: "Contacts",
        icon: Users,
        href: "/contacts",
    },
    {
        label: "Analytics",
        icon: BarChart3,
        href: "/analytics",
    },
    {
        label: "Logs",
        icon: FileText,
        href: "/logs",
    },
    {
        label: "Billing",
        icon: CreditCard,
        href: "/billing",
    },
];

// Additional routes for TYPE B (UMBRELLA) clients
const umbrellaRoutes = [
    {
        label: "Sequences",
        icon: GitBranch,
        href: "/sequences",
    },
    {
        label: "Phone Numbers",
        icon: Phone,
        href: "/phone-numbers",
    },
];

const bottomRoutes = [
    {
        label: "Settings",
        icon: Settings,
        href: "/settings",
    },
]

export const Sidebar = () => {
    const pathname = usePathname();
    const clientId = pathname.split('/')[2];
    const [accountType, setAccountType] = useState<string | null>(null);

    // Fetch client account type to determine which nav items to show
    useEffect(() => {
        if (!clientId) return;
        fetch(`/api/client/${clientId}/info`)
            .then(res => res.json())
            .then(data => {
                if (data?.account_type) {
                    setAccountType(data.account_type);
                }
            })
            .catch(() => {
                // Fallback: show base routes only
            });
    }, [clientId]);

    const isUmbrella = accountType === "UMBRELLA";
    const routes = isUmbrella ? [...baseRoutes, ...umbrellaRoutes] : baseRoutes;

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            {/* Workspace Display */}
            <WorkspaceDisplay clientId={clientId} />

            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-200">
                {routes.map((route) => {
                    // Construct absolute path: /client/[id]/[page]
                    const href = `/client/${clientId}${route.href}`;
                    const isActive = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                        <Link
                            key={route.href}
                            href={href}
                            className={cn(
                                "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors mb-0.5",
                                isActive
                                    ? "bg-violet-50 text-violet-700"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <route.icon className={cn("h-4 w-4 mr-3", isActive ? "text-violet-600" : "text-gray-400")} />
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
                            className={cn(
                                "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors mb-0.5",
                                isActive
                                    ? "bg-violet-50 text-violet-700"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <route.icon className={cn("h-4 w-4 mr-3", isActive ? "text-violet-600" : "text-gray-400")} />
                            {route.label}
                        </Link>
                    )
                })}
            </div>

            {/* Balance / Credits Status */}
            <div className="p-4 border-t border-gray-100 space-y-3">
                <MinuteBalanceDisplay clientId={clientId} />

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
                    Powered by <span className="font-medium">Elevate With AI</span>
                </p>
            </div>
        </div>
    );
};
