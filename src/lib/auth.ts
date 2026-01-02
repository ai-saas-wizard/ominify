import { supabase } from './supabase';

/**
 * Check if an email or clerk_id is an admin
 */
export async function isAdmin(emailOrClerkId: string): Promise<boolean> {
    const { data } = await supabase
        .from('admin_users')
        .select('id')
        .or(`email.eq.${emailOrClerkId},clerk_id.eq.${emailOrClerkId}`)
        .single();

    return !!data;
}

/**
 * Check if a user can access a specific client
 */
export async function canAccessClient(emailOrClerkId: string, clientId: string): Promise<boolean> {
    // First check if user is admin (admins can access all clients)
    if (await isAdmin(emailOrClerkId)) {
        return true;
    }

    // Check if user is a member of this client
    const { data } = await supabase
        .from('client_members')
        .select('id')
        .eq('client_id', clientId)
        .or(`email.eq.${emailOrClerkId},clerk_id.eq.${emailOrClerkId}`)
        .single();

    if (data) return true;

    // Check if user is the client owner (via clerk_id on clients table)
    const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('clerk_id', emailOrClerkId)
        .single();

    return !!client;
}

/**
 * Get all admins
 */
export async function getAllAdmins(): Promise<Array<{
    id: string;
    email: string;
    name: string | null;
    added_by: string | null;
    created_at: string;
}>> {
    const { data, error } = await supabase
        .from('admin_users')
        .select('id, email, name, added_by, created_at')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Add a new admin
 */
export async function addAdmin(email: string, name?: string, addedBy?: string): Promise<void> {
    const { error } = await supabase
        .from('admin_users')
        .insert({
            email: email.toLowerCase().trim(),
            name,
            added_by: addedBy
        });

    if (error) throw error;
}

/**
 * Remove an admin
 */
export async function removeAdmin(adminId: string): Promise<void> {
    const { error } = await supabase
        .from('admin_users')
        .delete()
        .eq('id', adminId);

    if (error) throw error;
}

/**
 * Get client team members
 */
export async function getClientMembers(clientId: string): Promise<Array<{
    id: string;
    email: string;
    name: string | null;
    role: string;
    invited_by: string | null;
    accepted_at: string | null;
    created_at: string;
}>> {
    const { data, error } = await supabase
        .from('client_members')
        .select('id, email, name, role, invited_by, accepted_at, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Add a client team member
 */
export async function addClientMember(
    clientId: string,
    email: string,
    role: 'owner' | 'admin' | 'member' = 'member',
    invitedBy?: string,
    name?: string
): Promise<void> {
    const { error } = await supabase
        .from('client_members')
        .insert({
            client_id: clientId,
            email: email.toLowerCase().trim(),
            role,
            invited_by: invitedBy,
            name
        });

    if (error) throw error;
}

/**
 * Remove a client team member
 */
export async function removeClientMember(memberId: string): Promise<void> {
    const { error } = await supabase
        .from('client_members')
        .delete()
        .eq('id', memberId);

    if (error) throw error;
}

/**
 * Update client member's clerk_id when they sign in
 */
export async function linkClerkIdToMember(email: string, clerkId: string): Promise<void> {
    await supabase
        .from('client_members')
        .update({ clerk_id: clerkId, accepted_at: new Date().toISOString() })
        .eq('email', email.toLowerCase().trim());

    await supabase
        .from('admin_users')
        .update({ clerk_id: clerkId })
        .eq('email', email.toLowerCase().trim());
}

/**
 * Get all clients a user can access
 */
export async function getAccessibleClients(emailOrClerkId: string): Promise<Array<{
    id: string;
    name: string;
    email: string;
}>> {
    // If admin, return all clients
    if (await isAdmin(emailOrClerkId)) {
        const { data } = await supabase
            .from('clients')
            .select('id, name, email')
            .order('name');
        return data || [];
    }

    // Get clients where user is a member
    const { data: memberClients } = await supabase
        .from('client_members')
        .select('client_id, clients(id, name, email)')
        .or(`email.eq.${emailOrClerkId},clerk_id.eq.${emailOrClerkId}`);

    // Get clients where user is owner
    const { data: ownedClients } = await supabase
        .from('clients')
        .select('id, name, email')
        .eq('clerk_id', emailOrClerkId);

    const allClients: Array<{ id: string; name: string; email: string }> = [];

    // Add member clients
    memberClients?.forEach(mc => {
        const client = mc.clients as any;
        if (client && !allClients.find(c => c.id === client.id)) {
            allClients.push({ id: client.id, name: client.name, email: client.email });
        }
    });

    // Add owned clients
    ownedClients?.forEach(c => {
        if (!allClients.find(ac => ac.id === c.id)) {
            allClients.push(c);
        }
    });

    return allClients;
}
