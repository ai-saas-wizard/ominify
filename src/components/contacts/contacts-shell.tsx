"use client";

import { ReactNode } from "react";
import { ContactsTabBar } from "./contacts-tab-bar";
import { ImportJobsBanner } from "./import-jobs-banner";

interface ContactsShellProps {
    title: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    showTabs?: boolean;
}

// Common wrapper for all contacts/* tab pages. Renders the GHL-style tab bar
// followed by a header row (title + actions) then page-specific children.
// Pages that should NOT show the tab bar (e.g. the import wizard) simply do
// not use this shell.
export function ContactsShell({
    title,
    subtitle,
    actions,
    children,
    showTabs = true,
}: ContactsShellProps) {
    return (
        <div className="flex flex-col">
            {showTabs && <ContactsTabBar />}
            <div className="p-4 lg:p-8 space-y-6">
                <ImportJobsBanner />
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                            {title}
                        </h1>
                        {subtitle && (
                            <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
                        )}
                    </div>
                    {actions && <div className="flex items-center gap-2">{actions}</div>}
                </div>
                {children}
            </div>
        </div>
    );
}
