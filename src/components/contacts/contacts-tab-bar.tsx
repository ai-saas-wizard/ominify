"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { motion, LayoutGroup } from "framer-motion";
import { CONTACTS_TABS, buildContactsHref, getActiveTabKey } from "./contacts-tab-config";
import { cn } from "@/lib/utils";

export function ContactsTabBar() {
    const params = useParams();
    const pathname = usePathname();
    const clientId = params.clientId as string;
    const activeKey = getActiveTabKey(clientId, pathname);

    return (
        <div className="border-b border-gray-200 bg-white">
            <LayoutGroup id="contacts-tabs">
                <nav className="flex items-center gap-1 px-4 lg:px-8" role="tablist">
                    {CONTACTS_TABS.map((tab) => {
                        const isActive = tab.key === activeKey;
                        return (
                            <Link
                                key={tab.key}
                                href={buildContactsHref(clientId, tab.hrefSuffix)}
                                role="tab"
                                aria-selected={isActive}
                                aria-disabled={tab.disabled}
                                tabIndex={tab.disabled ? -1 : 0}
                                className={cn(
                                    "relative px-4 py-3 text-sm font-medium transition-colors outline-none",
                                    "focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-t-md",
                                    tab.disabled
                                        ? "text-gray-300 cursor-not-allowed pointer-events-none"
                                        : isActive
                                          ? "text-indigo-600"
                                          : "text-gray-500 hover:text-gray-900",
                                )}
                            >
                                <span className="inline-flex items-center gap-2">
                                    {tab.label}
                                    {typeof tab.badge === "number" && (
                                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                                            {tab.badge}
                                        </span>
                                    )}
                                </span>
                                {isActive && (
                                    <motion.div
                                        layoutId="contacts-tab-indicator"
                                        className="absolute inset-x-0 -bottom-px h-0.5 bg-indigo-600"
                                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                    />
                                )}
                            </Link>
                        );
                    })}
                </nav>
            </LayoutGroup>
        </div>
    );
}
