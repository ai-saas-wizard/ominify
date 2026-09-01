// Supabase/PostgREST silently caps any un-paginated select — including
// embedded joins like `sequences.select("*, sequence_enrollments(...)")` —
// at 1000 rows. Reads that need "all rows" (enrollment stats, enrollment
// tables) must page with .range(), or a 3,000-lead sequence reports 1,000.
//
// Usage:
//   const rows = await fetchAllRows((from, to) =>
//       supabase.from("t").select("a, b").eq("x", y).order("id").range(from, to),
//   );
// The query MUST have a deterministic .order() for pages to be stable.

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
    page: (from: number, to: number) => PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
    }>,
): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await page(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        out.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return out;
}
