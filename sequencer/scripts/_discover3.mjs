// TEMP introspection — read-only. Print real columns + target step content.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const TARGET_SEQ = 'f73a33fa-9527-46ce-b871-d8fe42a8cba8';

const cols = async (t, filter) => {
  let qy = db.from(t).select('*').limit(1);
  if (filter) qy = filter(qy);
  const { data, error } = await qy;
  if (error) { console.log(`\n[${t}] ERROR ${error.message}`); return; }
  if (!data || !data.length) { console.log(`\n[${t}] (no rows) — cannot introspect`); return; }
  console.log(`\n[${t}] columns: ${Object.keys(data[0]).join(', ')}`);
};

await cols('sequence_steps', q => q.eq('sequence_id', TARGET_SEQ));
await cols('sequence_enrollments');
await cols('sequence_execution_log');
await cols('tenant_vapi_assignments');
await cols('vapi_umbrellas');
await cols('tenant_phone_numbers');
await cols('minute_balances');
await cols('contacts');

console.log('\n===== TARGET sequence steps (full) =====');
const { data: steps, error: se } = await db.from('sequence_steps').select('*').eq('sequence_id', TARGET_SEQ).order('step_order');
if (se) console.log('  ERROR', se.message);
else for (const st of (steps||[])) {
  console.log(`  --- step_order=${st.step_order} channel=${st.channel} delay_minutes=${st.delay_minutes} enrollment_id=${st.enrollment_id ?? 'null'}`);
  const interesting = {};
  for (const [k,v] of Object.entries(st)) {
    if (['id','sequence_id','created_at','updated_at','step_order','channel','delay_minutes','enrollment_id'].includes(k)) continue;
    if (v === null || v === '' || (typeof v==='object' && v && Object.keys(v).length===0)) continue;
    interesting[k] = typeof v === 'string' ? v.replace(/\s+/g,' ').slice(0,120) : v;
  }
  console.log('       ', JSON.stringify(interesting));
}
process.exit(0);
