// TEMP read-only — B2B Wizards agent vapi_id + config/blueprint.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const B2B = '36b43327-ea8c-4432-90fc-0ddca6b17498';

const { data: agents } = await db.from('agents')
  .select('id,name,vapi_id,agent_type,agent_blueprint,config,agent_config,override_variables').eq('client_id', B2B);
for (const a of (agents||[])) {
  console.log(`\nagent ${a.id}  "${a.name}"  [${a.agent_type}]`);
  console.log(`  vapi_id (VAPI assistant id) = ${a.vapi_id ?? 'NULL'}`);
  console.log(`  agent_blueprint present     = ${a.agent_blueprint ? 'yes' : 'no'}`);
  const cfg = a.config || a.agent_config || {};
  const keys = cfg && typeof cfg === 'object' ? Object.keys(cfg) : [];
  console.log(`  config keys                 = ${keys.join(', ') || '(none)'}`);
  if (cfg && (cfg.first_message || cfg.firstMessage)) console.log(`  first_message               = ${(cfg.first_message||cfg.firstMessage).slice(0,90)}`);
}
process.exit(0);
