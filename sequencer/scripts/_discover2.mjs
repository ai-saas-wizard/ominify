// TEMP focused discovery — read-only. Inspect target sequence routing + step details.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const VISHXX01 = '8a63ab5e-a1a3-40fd-9172-6768b1ea703f';
const TARGET_SEQ = 'f73a33fa-9527-46ce-b871-d8fe42a8cba8';

console.log('\n===== vishxx01 ACTIVE sequences: urgency + trigger_conditions (match order) =====');
const { data: seqs } = await db.from('sequences')
  .select('id,name,urgency_tier,generation_mode,trigger_conditions')
  .eq('client_id', VISHXX01).eq('is_active', true)
  .order('urgency_tier', { ascending: true });
for (const s of (seqs||[])) {
  console.log(`  [${s.urgency_tier}] ${s.id} ${s.generation_mode} "${s.name}"`);
  console.log(`        trigger_conditions=${JSON.stringify(s.trigger_conditions)}`);
}

console.log('\n===== TARGET sequence steps (f73a33fa) =====');
const { data: steps } = await db.from('sequence_steps')
  .select('step_order,channel,delay_minutes,vapi_assistant_id,subject,content')
  .eq('sequence_id', TARGET_SEQ).is('enrollment_id', null).order('step_order');
for (const st of (steps||[])) {
  const body = (st.content||'').replace(/\s+/g,' ').slice(0,90);
  console.log(`  step ${st.step_order} | ${st.channel} | delay_min=${st.delay_minutes} | vapi_assistant_id=${st.vapi_assistant_id ?? 'NULL'}`);
  console.log(`        ${st.subject ? '['+st.subject+'] ' : ''}${body}`);
}

console.log('\n===== vishxx01 vapi assignment + phone numbers =====');
const { data: va } = await db.from('tenant_vapi_assignments').select('*').eq('client_id', VISHXX01).limit(3);
console.log('  tenant_vapi_assignments rows:', (va||[]).map(r=>({is_active:r.is_active, umbrella_id:r.umbrella_id, assistant_id:r.assistant_id, phone_number_id:r.phone_number_id})));
const { data: tpn } = await db.from('tenant_phone_numbers').select('purpose,phone_number,is_active,vapi_phone_number_id').eq('client_id', VISHXX01).limit(10);
console.log('  tenant_phone_numbers:', JSON.stringify(tpn));

console.log('\n===== existing test contacts/enrollments for vishxx01 (source e2e) =====');
const { data: existing } = await db.from('contacts').select('id,phone,name,opted_out_at,phone_type').eq('client_id', VISHXX01).ilike('name','%E2E%').limit(10);
console.log('  e2e contacts:', JSON.stringify(existing));

console.log('\n===== sequence_enrollments columns sanity (one row) =====');
const { data: oneEnr } = await db.from('sequence_enrollments').select('*').eq('tenant_id', VISHXX01).limit(1);
if (oneEnr && oneEnr[0]) console.log('  columns:', Object.keys(oneEnr[0]).join(', '));
else console.log('  (no enrollments yet for vishxx01)');

process.exit(0);
