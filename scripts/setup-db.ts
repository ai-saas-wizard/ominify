
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

// Parse URL from env or string
// Project: dzhjushuaxddooytqwdi
// URL: https://dzhjushuaxddooytqwdi.supabase.co
// Keys provided in env
// Try to connect to DB
const PROJECT_ID = 'dzhjushuaxddooytqwdi';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Connection string attempts
// 1. service_role user with service key?
// 2. postgres user with service key? (Unlikely)

async function tryConnect(connectionString: string, label: string) {
    console.log(`Attempting connection via ${label}...`);
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        console.log(`Connected via ${label}!`);
        return client;
    } catch (e: any) {
        console.log(`Failed ${label}: ${e.message}`);
        await client.end().catch(() => { });
        return null;
    }
}

async function main() {
    // Attempt 1: Connect as 'postgres' (Requires Password usually)
    // Attempt 2: Connect as 'service_role' using the service key as password? (Some Auth modes allow this)
    // The host is usually db.[project].supabase.co

    // Construct potential connection strings
    const host = `db.${PROJECT_ID}.supabase.co`;

    // NOTE: This is a long shot. Supabase doesn't enable this by default for all projects.
    // But sometimes the PGBouncer or specific configs allow it.

    const attempts = [
        `postgres://postgres:${SERVICE_KEY}@${host}:5432/postgres`, // Almost certainly wrong
        `postgres://postgres:${SERVICE_KEY}@${host}:6543/postgres`, // Transaction pooler?
    ];

    let client: Client | null = null;

    /* 
       Actually, standard Supabase doesn't allow Service Key as DB Password.
       BUT, let's try calling the REST API 'sql' endpoint if it exists?
       There isn't one documented.
       
       Let's check if the user *implied* the password is the key?
       "Here's the service role key : eyJ... Project Id : dzhjushuaxddooytqwdi ... You can create all the tables using API's"
       
       Maybe they mean the Management API? 
       https://api.supabase.com/v1/projects/{ref}/query
       Requires PAT. I don't have one.
       
       Let's just Run the SQL via the JS Client using a raw RPC call if I can find one?
       No standard one.
       
       Wait, let's try the HTTP method on the POSTGREST endpoint?
       POST /rest/v1/ rpc/exec_sql?
       
    */

    console.log("Reading schema...");
    const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    // Attempt RPC call via global fetch
    console.log("Attempting RPC 'exec_sql'...");
    const supabaseUrl = `https://${PROJECT_ID}.supabase.co`;

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
            'apikey': SERVICE_KEY!,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql }) // Or query?
    });

    if (res.ok) {
        console.log("RPC exec_sql Success!");
        console.log(await res.text());
        return;
    } else {
        console.log("RPC Call Failed:", res.status, await res.text());
    }

    console.log("Could not apply schema. Please run supabase/schema.sql manually.");
}

main();
