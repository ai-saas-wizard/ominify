import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// NOTE: using service role key on server-side only. 
// For client-side, we should use the anon key if we had RLS, 
// but for this MVP with Admin focus, we might use server actions mostly.
// However, to be safe, let's export a client that uses the public key if available, 
// or falls back to service key for server-side operations (context aware).

// Actually, since we only have the SERVICE_ROLE_KEY in the env provided (based on user request),
// We must be careful not to expose this to the client-side bundle.
// The user gave: "Here's the service role key". Usually we need the ANON key for client side.
// But we can build this using Server Actions where we use the Service Role Key securely.

export const supabase = createClient(supabaseUrl, supabaseKey)
