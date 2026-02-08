import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

/**
 * Helper to execute raw SQL queries via Supabase RPC
 * For complex queries that Supabase client doesn't support well
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    // For most operations, use the Supabase client methods
    // This is a placeholder - in production you might use pg directly
    // or create RPC functions in Supabase for complex queries
    throw new Error('Use supabase client methods or create RPC functions for complex queries');
}

/**
 * Helper to get a single row or null
 */
export async function getOne<T>(
    table: string,
    conditions: Record<string, any>
): Promise<T | null> {
    let query = supabase.from(table).select('*');

    for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
    }

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        console.error(`[DB] Error fetching from ${table}:`, error);
        throw error;
    }

    return data as T | null;
}

/**
 * Helper to insert and return the inserted row
 */
export async function insertOne<T>(
    table: string,
    data: Record<string, any>
): Promise<T> {
    const { data: inserted, error } = await supabase
        .from(table)
        .insert(data)
        .select()
        .single();

    if (error) {
        console.error(`[DB] Error inserting into ${table}:`, error);
        throw error;
    }

    return inserted as T;
}

/**
 * Helper to update rows
 */
export async function updateWhere(
    table: string,
    conditions: Record<string, any>,
    updates: Record<string, any>
): Promise<number> {
    let query = supabase.from(table).update(updates);

    for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
    }

    const { error, count } = await query;

    if (error) {
        console.error(`[DB] Error updating ${table}:`, error);
        throw error;
    }

    return count || 0;
}

export default supabase;
