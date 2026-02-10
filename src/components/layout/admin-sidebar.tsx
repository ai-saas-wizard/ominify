"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    Users,
    Settings,
    CreditCard,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";

const routes = [
    {
        label: "Clients",
        icon: Users,
        href: "/admin/clients",
    },
{
        label: "Billing",
        icon: CreditCard,
        href: "/admin/billing",
    },
    {
        label: "Settings",
        icon: Settings,
        href: "/admin/settings",
    },
];

export const AdminSidebar = () => {
    const pathname = usePathname();

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            {/* Text Logo Header */}
            <div className="p-4 border-b border-gray-100">
                <Link href="/admin/clients" className="block">
                    <h1 className="text-xl font-bold tracking-tight">
                        <span className="bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
                            INDRIS
                        </span>
                    </h1>
                    <p className="text-[10px] text-gray-400 mt-0.5">Admin Dashboard</p>
                </Link>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
                {routes.map((route) => {
                    const isActive = pathname === route.href || pathname.startsWith(`${route.href}/`);
                    return (
                        <Link
                            key={route.href}
                            href={route.href}
                            className={cn(
                                "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors mb-0.5",
                                isActive
                                    ? "bg-indigo-50 text-indigo-700"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <route.icon className={cn("h-4 w-4 mr-3", isActive ? "text-indigo-600" : "text-gray-400")} />
                            {route.label}
                        </Link>
                    )
                })}
            </div>

            {/* User & Powered By */}
            <div className="p-4 border-t border-gray-100">
                <div className="flex items-center gap-2 px-1 py-2 mb-3">
                    <UserButton
                        afterSignOutUrl="/sign-in"
                        appearance={{
                            elements: {
                                avatarBox: "w-8 h-8"
                            }
                        }}
                    />
                    <div className="flex-1 min-w-0">
                        <span className="text-xs text-gray-600 truncate block">Admin Account</span>
                    </div>
                </div>
                <p className="text-[10px] text-gray-400 text-center">
                    Powered by <span className="font-medium">Elevate With AI</span>
                </p>
            </div>
        </div>
    );
};
