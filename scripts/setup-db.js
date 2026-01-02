
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
    try {
        const envPath = path.join(process.cwd(), '.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const env = {};
        envContent.split('\n').forEach(line => {
            const [key, ...value] = line.split('=');
            if (key && value) {
                env[key.trim()] = value.join('=').trim();
            }
        });
        return env;
    } catch (e) {
        return {};
    }
}

const env = loadEnv();
const PROJECT_ID = 'dzhjushuaxddooytqwdi';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
    if (!SERVICE_KEY) {
        console.error("No Service Key found!");
        return;
    }

    const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    // Try connecting
    // Host: db.dzhjushuaxddooytqwdi.supabase.co
    const connectionString = `postgres://postgres:${SERVICE_KEY}@db.${PROJECT_ID}.supabase.co:5432/postgres`;

    console.log("Attempting PG Connection...");
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log("Connected! Running Schema...");
        await client.query(sql);
        console.log("Schema applied successfully!");
        await client.end();
    } catch (e) {
        console.log("PG Connection Failed:", e.message);

        // Try service_role user?
        const conn2 = `postgres://service_role:${SERVICE_KEY}@db.${PROJECT_ID}.supabase.co:5432/postgres`;
        console.log("Attempting PG Connection (service_role)...");
        const client2 = new Client({ connectionString: conn2, ssl: { rejectUnauthorized: false } });
        try {
            await client2.connect();
            console.log("Connected as service_role! Running Schema...");
            await client2.query(sql);
            console.log("Schema applied successfully!");
            await client2.end();
        } catch (e2) {
            console.log("PG Connection Failed (service_role):", e2.message);
        }
    }
}

main();
