// Sub-navigation config for the contacts shell. Add entries here to expand
// the tab bar later (Bulk Actions / Tasks / Companies). The pathname check is
// startsWith-based, so deep routes (`.../lists/[listId]`) correctly highlight
// their parent tab.

export interface ContactsTabItem {
    key: string;
    label: string;
    /** Suffix appended to `/client/{clientId}/contacts`. Empty string = root. */
    hrefSuffix: string;
    badge?: number | null;
    disabled?: boolean;
    /** Match this prefix on the current pathname (excluding /client/{id}/contacts/). */
    matchPrefix: string;
}

export const CONTACTS_TABS: ContactsTabItem[] = [
    { key: "contacts", label: "Contacts", hrefSuffix: "", matchPrefix: "" },
    { key: "lists", label: "Lists", hrefSuffix: "/lists", matchPrefix: "/lists" },
];

export function buildContactsHref(clientId: string, suffix: string): string {
    return `/client/${clientId}/contacts${suffix}`;
}

export function getActiveTabKey(clientId: string, pathname: string | null): string {
    if (!pathname) return "contacts";
    const base = `/client/${clientId}/contacts`;
    if (!pathname.startsWith(base)) return "contacts";
    const suffix = pathname.slice(base.length);
    // Find the longest-matching prefix that isn't empty (so /lists wins over /).
    const sorted = [...CONTACTS_TABS].sort((a, b) => b.matchPrefix.length - a.matchPrefix.length);
    for (const t of sorted) {
        if (t.matchPrefix === "") continue;
        if (suffix.startsWith(t.matchPrefix)) return t.key;
    }
    return "contacts";
}
