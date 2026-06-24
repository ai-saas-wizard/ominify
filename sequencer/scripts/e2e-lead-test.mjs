#!/usr/bin/env node
/**
 * Omnify Sequencer — End-to-End Lead Test Harness
 * ================================================
 *
 * Pushes ONE contact into the live sequencer exactly like a real lead source,
 * then verifies the backend actually dispatched the SMS + voice call (and the
 * designated tone), reading the same artifacts the workers write.
 *
 * It talks to:
 *   - the sequencer webhook-server  (HTTP lead ingestion)   — the real entry path
 *   - Supabase                       (read: verification; write: enrollment control)
 *
 * Secrets are read from sequencer/.env.production and NEVER printed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 *   node scripts/e2e-lead-test.mjs --phone +15551234567                 # DRY RUN (default, no call/SMS)
 *   node scripts/e2e-lead-test.mjs --phone +15551234567 --live          # LIVE: real SMS + voice call
 *   node scripts/e2e-lead-test.mjs --phone +15551234567 --live --tone casual
 *   node scripts/e2e-lead-test.mjs --phone +15551234567 --cleanup       # remove the test contact afterwards
 *   node scripts/e2e-lead-test.mjs --cleanup-only --phone +15551234567  # just delete prior test data
 *
 * KEY FLAGS / ENV (flags override env):
 *   --phone        TEST_PHONE        (required)  E.164 mobile you OWN
 *   --tenant       TENANT_ID         (default vishxx01: 8a63ab5e-…)  client/tenant UUID
 *   --sequence     SEQUENCE_ID       (optional)  force a sequence; default = auto-match (same as prod)
 *   --url          SEQUENCER_URL     (default WEBHOOK_BASE_URL or http://54.156.90.226:3000)
 *   --live                           actually dispatch (omit = dry run)
 *   --tone <t>                       set EI tone on the enrollment to prove tone (e.g. casual, urgent, warm)
 *   --email <e>                      give the contact an email so the email steps also fire (default: none → email steps skip)
 *   --timeout <s>  TIMEOUT_S         (default 180) seconds to wait for dispatch
 *   --cleanup                        delete the test contact + enrollments + logs at the end
 *   --cleanup-only                   delete prior test data for --phone and exit
 *   --no-test-mode                   do NOT set is_test (keeps real delays + TCPA/business-hours gating)
 *
 * EXIT CODE: 0 = PASS, 1 = FAIL.  Wire it into anything.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

// ── tiny arg parser ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, env, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[env] ?? dflt;
};

const CFG = {
  url: (opt('url', 'SEQUENCER_URL', process.env.WEBHOOK_BASE_URL || 'http://54.156.90.226:3000')).replace(/\/$/, ''),
  tenantId: opt('tenant', 'TENANT_ID', '8a63ab5e-a1a3-40fd-9172-6768b1ea703f'), // vishxx01
  phone: opt('phone', 'TEST_PHONE', ''),
  email: opt('email', 'TEST_EMAIL', ''),
  sequenceId: opt('sequence', 'SEQUENCE_ID', ''),
  tone: opt('tone', '', ''),
  timeoutS: parseInt(opt('timeout', 'TIMEOUT_S', '180'), 10),
  live: flag('live'),
  cleanup: flag('cleanup'),
  cleanupOnly: flag('cleanup-only'),
  checkOnly: flag('check-only'),
  testMode: !flag('no-test-mode'),
  // Provision an ephemeral SMS→voice test sequence (for clients that have no
  // active sequence). Wired to a real VAPI assistant so the call uses the real
  // persona. Removed again by --cleanup.
  createTestSeq: flag('create-test-seq'),
  assistant: opt('assistant', 'TEST_ASSISTANT_ID', ''), // VAPI assistant id (agents.vapi_id) for the voice step
  agent: opt('agent', 'TEST_AGENT_ID', ''),             // agents.id for phone/blueprint resolution
  noVoice: flag('no-voice'),                            // sms-only test sequence
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LEAD_TOKEN = process.env.LEAD_INGESTION_API_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

// ── pretty output ────────────────────────────────────────────────────────────
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const line = (s = '') => console.log(s);
const ok = (s) => line(`${C.g}  ✓${C.x} ${s}`);
const bad = (s) => line(`${C.r}  ✗${C.x} ${s}`);
const warn = (s) => line(`${C.y}  !${C.x} ${s}`);
const info = (s) => line(`${C.c}  →${C.x} ${s}`);
const head = (s) => line(`\n${C.b}${C.c}${s}${C.x}`);
const fail = (msg) => { bad(msg); printReport(false); process.exit(1); };

const RUN_ID = `e2e-${Date.now()}`;
const stamp = new Date().toISOString();

// ── results we accumulate for the final report ───────────────────────────────
const R = {
  mode: CFG.live ? (CFG.testMode ? 'LIVE (test-mode)' : 'LIVE (real timing)') : 'DRY RUN',
  health: null, ingest: null, contactId: null, enrollmentId: null,
  matchedSeq: null, enrollmentStatus: null, stepAdvanced: null,
  sms: null, voice: null, tone: null, createdSeqId: null,
};

// ── env guard ────────────────────────────────────────────────────────────────
function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  if (!CFG.cleanupOnly && !CFG.checkOnly && !LEAD_TOKEN) missing.push('LEAD_INGESTION_API_TOKEN');
  if (missing.length) {
    bad(`Missing required env in sequencer/.env.production: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (CFG.checkOnly) return; // read-only readiness check needs no phone
  if (!CFG.phone) { bad('Missing --phone (E.164 mobile you own). See --help.'); process.exit(1); }
  if (!/^\+\d{8,15}$/.test(CFG.phone)) warn(`Phone "${CFG.phone}" is not E.164 (+countrycode…). Twilio/landline checks may reject it.`);
}

const db = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ── replicate the route's findMatchingSequence so dry-run/dup-lookup agree ────
async function resolveMatchedSequence(sb, source) {
  if (CFG.sequenceId) {
    const { data } = await sb.from('sequences').select('id,name,urgency_tier,generation_mode').eq('id', CFG.sequenceId).maybeSingle();
    return data || null;
  }
  const { data: seqs } = await sb.from('sequences').select('id,name,urgency_tier,generation_mode,trigger_conditions')
    .eq('client_id', CFG.tenantId).eq('is_active', true).order('urgency_tier', { ascending: true });
  if (!seqs || !seqs.length) return null;
  for (const s of seqs) {
    const c = s.trigger_conditions || {};
    if (c.lead_source && c.lead_source.length && !c.lead_source.includes(source) && !c.lead_source.includes('*')) continue;
    return s; // job_type_keywords needs `keywords` we don't send → treated as match here
  }
  return seqs.find(s => { const c = s.trigger_conditions || {}; return !c.lead_source && !c.job_type_keywords; }) || null;
}

async function stepChannels(sb, seqId) {
  const { data } = await sb.from('sequence_steps').select('step_order,channel,delay_minutes').is('enrollment_id', null).eq('sequence_id', seqId).order('step_order');
  return (data || []);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  let body; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
async function postJson(url, payload, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  let body; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

// ── steps ────────────────────────────────────────────────────────────────────
async function healthCheck() {
  head('1. Health check');
  let res;
  try { res = await getJson(`${CFG.url}/health`); }
  catch (e) { fail(`Cannot reach sequencer at ${CFG.url} — ${e.message}`); }
  if (res.status !== 200 || res.body?.status !== 'ok') fail(`/health returned ${res.status} ${JSON.stringify(res.body)}`);
  R.health = true;
  ok(`webhook-server up at ${CFG.url} (uptime ${Math.round(res.body.uptime / 3600)}h)`);
}

async function preflight(sb) {
  head('2. Preflight readiness (warnings only)');
  const tenant = CFG.tenantId;
  const { data: cli } = await sb.from('clients').select('name,account_type').eq('id', tenant).maybeSingle();
  info(`tenant ${tenant} ${cli ? `→ ${cli.account_type} "${cli.name}"` : '(NOT FOUND in clients!)'}`);

  const { data: tp } = await sb.from('tenant_profiles').select('client_id').eq('client_id', tenant).maybeSingle();
  tp ? ok('tenant_profiles row present (scheduler will not skip)') : warn('tenant_profiles MISSING → scheduler silently skips every tick!');

  const matched = await resolveMatchedSequence(sb, 'e2e');
  if (!matched) { warn('No active sequence will match → enrollment will be null. Fix before --live.'); }
  else {
    R.matchedSeq = matched;
    const chans = await stepChannels(sb, matched.id);
    const hasSms = chans.some(c => c.channel === 'sms');
    const hasVoice = chans.some(c => c.channel === 'voice');
    info(`will enroll into: "${matched.name}" [${matched.urgency_tier}/${matched.generation_mode}] ${matched.id}`);
    info(`   steps: ${chans.map(c => `${c.step_order}:${c.channel}(${c.delay_minutes}m)`).join(' ') || '(none)'}`);
    hasSms ? ok('sequence has an SMS step') : warn('sequence has NO sms step → SMS leg cannot pass');
    hasVoice ? ok('sequence has a voice step') : warn('sequence has NO voice step → voice leg cannot pass');
  }

  const { data: tw } = await sb.from('tenant_twilio_accounts').select('status').eq('client_id', tenant).maybeSingle();
  tw?.status === 'active' ? ok('Twilio subaccount active') : warn(`Twilio account status=${tw?.status ?? 'MISSING'} → SMS will fail`);

  const { data: pns } = await sb.from('tenant_phone_numbers').select('phone_number,purpose,status,is_primary,vapi_phone_number_id').eq('client_id', tenant);
  if (pns && pns.length) for (const p of pns) info(`phone ${p.phone_number} [${p.purpose}/${p.status}${p.is_primary ? '/primary' : ''}${p.vapi_phone_number_id ? '/vapi-linked' : ''}]`);
  else warn('no rows in tenant_phone_numbers for this client');

  const { data: va } = await sb.from('tenant_vapi_assignments').select('is_active').eq('client_id', tenant).eq('is_active', true).maybeSingle();
  va ? ok('VAPI umbrella assignment active') : warn('No active VAPI assignment → voice will fail');

  const { data: mb } = await sb.from('minute_balances').select('balance_minutes,subscription_minutes').eq('client_id', tenant).maybeSingle();
  const mins = (mb?.balance_minutes || 0) + (mb?.subscription_minutes || 0);
  mins > 0 ? ok(`VAPI minutes available: ${mins}`) : warn('VAPI minutes = 0 → the voice call will log action="skipped_no_access" (SMS still works)');

  // List ALL active sequences + their channels (which one auto-matches is marked ←)
  const { data: allSeq } = await sb.from('sequences').select('id,name,urgency_tier,generation_mode').eq('client_id', tenant).eq('is_active', true).order('urgency_tier', { ascending: true });
  head('   active sequences (← = the one a new lead auto-matches)');
  if (!allSeq || !allSeq.length) warn('no active sequences');
  else for (const s of allSeq) {
    const chans = await stepChannels(sb, s.id);
    const tag = (chans.some(c => c.channel === 'sms') && chans.some(c => c.channel === 'voice')) ? `${C.g}[sms+voice]${C.x}` : `${C.d}[${[...new Set(chans.map(c => c.channel))].join(',') || 'no steps'}]${C.x}`;
    const arrow = R.matchedSeq && s.id === R.matchedSeq.id ? `${C.b}←${C.x}` : ' ';
    info(`${arrow} ${tag} "${s.name}" [${s.urgency_tier}/${s.generation_mode}] ${s.id}`);
  }

  if (CFG.live && !CFG.email) info('no --email given → email steps will skip+advance (keeps the test to SMS + voice)');
}

async function pushLead(autoEnroll) {
  head(`3. Push lead  →  POST ${CFG.url}/webhooks/leads/generic/${CFG.tenantId}`);
  const payload = {
    phone: CFG.phone,
    name: `E2E Test ${RUN_ID}`,
    source: 'e2e',
    enroll_in_sequence: autoEnroll,
    customVariables: { note: 'automated e2e harness', run_id: RUN_ID, pushed_at: stamp },
  };
  if (CFG.email) payload.email = CFG.email;
  const res = await postJson(`${CFG.url}/webhooks/leads/generic/${CFG.tenantId}`, payload, { Authorization: `Bearer ${LEAD_TOKEN}` });
  if (res.status !== 200) fail(`ingestion returned HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  R.ingest = true;
  R.contactId = res.body?.contactId || null;
  R.enrollmentId = res.body?.enrollmentId || null; // '' or null when dup/opted-out/no-match/enroll=false
  ok(`HTTP 200  contactId=${R.contactId}  enrollmentId=${R.enrollmentId || '(none returned)'}`);
  if (res.body?.skippedOptedOut) warn('contact is opted-out (opted_out_at set) → will not enroll. Clear it or use another number.');
  return res.body;
}

// ── DRY RUN: prove ingest + enrollment row, parked, zero dispatch ─────────────
async function runDryRun(sb) {
  await pushLead(false); // contact-only via the real endpoint (zero dispatch risk)
  if (!R.contactId) fail('no contactId returned from ingestion');
  const { data: c } = await sb.from('contacts').select('id,phone,opted_out_at,phone_type').eq('id', R.contactId).maybeSingle();
  c ? ok(`contact row verified (phone=${c.phone}, type=${c.phone_type ?? 'unknown'})`) : fail('contact row not found after ingest');

  head('4. Create a PAUSED enrollment (parked — scheduler only claims status=active)');
  if (!R.matchedSeq) fail('no sequence to enroll into (see preflight)');
  const { data: enr, error } = await sb.from('sequence_enrollments').insert({
    tenant_id: CFG.tenantId, sequence_id: R.matchedSeq.id, contact_id: R.contactId,
    status: 'paused', current_step_order: 0, next_step_at: stamp,
    enrollment_source: 'e2e-dryrun', custom_variables: { run_id: RUN_ID },
    sentiment_trend: 'stable', engagement_score: 50,
    contact_replied: false, contact_answered_call: false, appointment_booked: false,
  }).select('id').single();

  if (error?.code === '23505') {
    const { data: existing } = await sb.from('sequence_enrollments').select('id').eq('contact_id', R.contactId).eq('sequence_id', R.matchedSeq.id).maybeSingle();
    if (existing) { await sb.from('sequence_enrollments').update({ status: 'paused' }).eq('id', existing.id); R.enrollmentId = existing.id; ok('reused existing enrollment → set to paused'); }
    else fail(`enrollment insert failed: ${error.message}`);
  } else if (error) { fail(`enrollment insert failed: ${error.message}`);
  } else { R.enrollmentId = enr.id; ok(`paused enrollment created: ${enr.id}`); }
  R.enrollmentStatus = 'paused';
  warn('DRY RUN — nothing was dispatched. No SMS, no call, no email. Re-run with --live to dispatch.');
}

// ── optionally provision an ephemeral SMS→voice test sequence ────────────────
async function ensureTestSequence(sb) {
  head('2b. Provision ephemeral test sequence (SMS → voice)');
  if (!CFG.noVoice && !CFG.assistant) fail('--create-test-seq with a voice step needs --assistant <vapi_id> (or pass --no-voice for SMS-only)');
  // urgency_tier='critical' sorts first in findMatchingSequence; empty trigger_conditions matches any source → this wins auto-match.
  const { data: seq, error } = await sb.from('sequences').insert({
    client_id: CFG.tenantId,
    name: `E2E Test Sequence (auto ${RUN_ID})`,
    description: 'Ephemeral SMS+voice sequence created by e2e-lead-test.mjs — safe to delete',
    trigger_type: 'manual', trigger_conditions: {}, urgency_tier: 'critical',
    is_active: true, generation_mode: 'static', respect_business_hours: false,
    auto_created: true, agent_id: CFG.agent || null, metadata: { e2e: true, run_id: RUN_ID },
  }).select('id,name,urgency_tier,generation_mode').single();
  if (error) fail(`could not create test sequence: ${error.message}`);
  R.createdSeqId = seq.id;
  R.matchedSeq = seq;
  CFG.sequenceId = seq.id; // make resolve/dup-lookup target it
  ok(`created sequence ${seq.id}`);

  const steps = [{
    sequence_id: seq.id, step_order: 1, channel: 'sms', delay_type: 'immediate', delay_minutes: 0, is_active: true,
    content: { body: `E2E test from Omnify sequencer — reply STOP to opt out. (${RUN_ID})` },
    skip_conditions: { skip_if: [] }, on_success: { action: 'continue' }, on_failure: { action: 'skip' },
  }];
  if (!CFG.noVoice) steps.push({
    sequence_id: seq.id, step_order: 2, channel: 'voice', delay_type: 'after_previous', delay_minutes: 0, is_active: true,
    voice_agent_id: CFG.agent || null,
    content: {
      vapi_assistant_id: CFG.assistant,
      first_message: 'Hi, this is a quick automated test call from Omnify. Thanks for helping verify the system.',
      system_prompt: 'You are placing a brief automated test call to confirm the calling pipeline works. Greet the person, say this is an automated Omnify test, and end politely.',
    },
    skip_conditions: { skip_if: ['contact_answered_call'] }, on_success: { action: 'end_sequence' }, on_failure: { action: 'end_sequence' },
  });
  const { error: se } = await sb.from('sequence_steps').insert(steps);
  if (se) fail(`could not create test steps: ${se.message}`);
  ok(`steps created: 1:sms${CFG.noVoice ? '' : ` 2:voice(assistant=${CFG.assistant})`}`);
}

// ── LIVE: real dispatch + verification poll ──────────────────────────────────
async function runLive(sb) {
  if (CFG.createTestSeq) await ensureTestSequence(sb);
  const body = await pushLead(true);

  // Resolve the enrollment id (handle dup → reset so the harness is repeatable)
  if (!R.enrollmentId) {
    if (body?.skippedOptedOut) fail('contact opted-out; cannot enroll');
    if (!R.matchedSeq) fail('no matching active sequence; cannot enroll');
    const { data: existing } = await sb.from('sequence_enrollments').select('id').eq('contact_id', R.contactId).eq('sequence_id', R.matchedSeq.id).maybeSingle();
    if (!existing) fail('ingestion returned no enrollmentId and no existing enrollment found (unexpected)');
    R.enrollmentId = existing.id;
    info(`already enrolled — resetting enrollment ${existing.id} to step 0 for a fresh run`);
  }

  head('4. Arm enrollment (test-mode compression + tone) and run');
  const update = { status: 'active', current_step_order: 0, next_step_at: stamp,
    calls_made: 0, sms_sent: 0, emails_sent: 0,
    contact_replied: false, contact_answered_call: false, appointment_booked: false };
  if (CFG.testMode) update.is_test = true;
  if (CFG.tone) { update.recommended_tone = CFG.tone; update.last_emotion = 'interested'; update.is_hot_lead = true; R.tone = CFG.tone; }
  const { error: uerr } = await sb.from('sequence_enrollments').update(update).eq('id', R.enrollmentId);
  if (uerr) fail(`failed to arm enrollment: ${uerr.message}`);
  CFG.testMode ? ok('is_test=true (delays→30s, TCPA/business-hours bypassed)') : warn('real timing — voice step may be hours out and gated by TCPA/business hours');
  if (CFG.tone) ok(`tone armed: recommended_tone=${CFG.tone}, is_hot_lead=true`);

  head(`5. Poll for dispatch (up to ${CFG.timeoutS}s)  —  watching sequence_execution_log`);
  const deadline = Date.now() + CFG.timeoutS * 1000;
  let smsRow = null, voiceRow = null, voiceSkip = null, lastStep = -1;
  while (Date.now() < deadline) {
    await sleep(5000);
    const { data: logs } = await sb.from('sequence_execution_log')
      .select('channel,action,provider_id,sms_status,call_status,executed_at')
      .eq('enrollment_id', R.enrollmentId).order('executed_at');
    const { data: enr } = await sb.from('sequence_enrollments')
      .select('status,current_step_order,next_step_at,calls_made,sms_sent,emails_sent').eq('id', R.enrollmentId).maybeSingle();

    for (const l of (logs || [])) {
      if (l.channel === 'sms' && l.action === 'sent' && !smsRow) { smsRow = l; ok(`SMS sent — SID=${l.provider_id} (${l.sms_status || 'queued'})`); }
      if (l.channel === 'voice' && l.action === 'call_initiated' && !voiceRow) { voiceRow = l; ok(`VOICE call initiated — VAPI id=${l.provider_id}`); }
      if (l.channel === 'voice' && l.action?.startsWith('skipped') && !voiceSkip) { voiceSkip = l; warn(`VOICE skipped — action=${l.action} (see preflight: minutes/concurrency)`); }
    }
    if (enr && enr.current_step_order !== lastStep) {
      lastStep = enr.current_step_order;
      info(`enrollment: status=${enr.status} step=${enr.current_step_order} sms_sent=${enr.sms_sent} calls_made=${enr.calls_made} emails=${enr.emails_sent}`);
    }
    // nudge: if test-mode but a step advanced with a far-future next_step_at (lost the is_test race), pull it in
    if (CFG.testMode && enr?.status === 'active' && enr.next_step_at && (new Date(enr.next_step_at).getTime() - Date.now() > 90000)) {
      await sb.from('sequence_enrollments').update({ next_step_at: new Date().toISOString() }).eq('id', R.enrollmentId);
      info('   (nudged next_step_at→now to keep test-mode timing)');
    }
    if (smsRow && (voiceRow || voiceSkip)) break; // both legs exercised
  }
  R.sms = smsRow ? { sid: smsRow.provider_id, status: smsRow.sms_status } : null;
  R.voice = voiceRow ? { id: voiceRow.provider_id, status: voiceRow.call_status } : (voiceSkip ? { skipped: voiceSkip.action } : null);
  const { data: fin } = await sb.from('sequence_enrollments').select('current_step_order,status').eq('id', R.enrollmentId).maybeSingle();
  R.enrollmentStatus = fin?.status; R.stepAdvanced = fin?.current_step_order;
}

async function adminStats() {
  if (!ADMIN_TOKEN) return;
  const res = await getJson(`${CFG.url}/admin/stats`, { Authorization: `Bearer ${ADMIN_TOKEN}` }).catch(() => null);
  if (res?.status === 200 && res.body) {
    head('Admin corroboration (/admin/stats)');
    const q = res.body.queues || res.body;
    info(JSON.stringify(q).slice(0, 400));
  }
}

async function delEnrollments(sb, enrIds) {
  if (!enrIds.length) return;
  await sb.from('sequence_execution_log').delete().in('enrollment_id', enrIds);
  await sb.from('sequence_enrollments').delete().in('id', enrIds);
}

async function cleanup(sb) {
  head('Cleanup — removing test data');
  // 1. test contact (by phone) + its enrollments + logs
  if (CFG.phone) {
    const { data: cs } = await sb.from('contacts').select('id').eq('client_id', CFG.tenantId).eq('phone', CFG.phone);
    const ids = (cs || []).map(c => c.id);
    if (ids.length) {
      const { data: enrs } = await sb.from('sequence_enrollments').select('id').in('contact_id', ids);
      await delEnrollments(sb, (enrs || []).map(e => e.id));
      await sb.from('contacts').delete().in('id', ids);
      ok(`deleted ${ids.length} contact(s) + their enrollments/logs`);
    } else info('no test contact found for that phone');
  }
  // 2. ephemeral e2e test sequences (this run's, or any leftover by name) + steps + enrollments
  let seqIds = [];
  if (R.createdSeqId) seqIds.push(R.createdSeqId);
  const { data: leftover } = await sb.from('sequences').select('id').eq('client_id', CFG.tenantId).like('name', 'E2E Test Sequence (auto%');
  for (const s of (leftover || [])) if (!seqIds.includes(s.id)) seqIds.push(s.id);
  if (seqIds.length) {
    const { data: enrs } = await sb.from('sequence_enrollments').select('id').in('sequence_id', seqIds);
    await delEnrollments(sb, (enrs || []).map(e => e.id));
    await sb.from('sequence_steps').delete().in('sequence_id', seqIds);
    await sb.from('sequences').delete().in('id', seqIds);
    ok(`deleted ${seqIds.length} ephemeral test sequence(s) + their steps`);
  }
}

// ── final report ─────────────────────────────────────────────────────────────
function printReport(passed) {
  const fmt = (v, okMsg, skipMsg) => v == null ? `${C.d}—${C.x}` : (v.skipped ? `${C.y}SKIPPED (${v.skipped})${C.x}` : `${C.g}PASS${C.x} ${okMsg(v)}`);
  head('════════════ RESULT ════════════');
  line(`  Mode:            ${R.mode}`);
  line(`  Tenant:          ${CFG.tenantId}`);
  line(`  Phone:           ${CFG.phone}`);
  line(`  Health:          ${R.health ? C.g + 'PASS' + C.x : C.r + 'FAIL' + C.x}`);
  line(`  Lead ingest:     ${R.ingest ? C.g + 'PASS' + C.x : C.r + 'FAIL' + C.x}  contactId=${R.contactId || '—'}`);
  line(`  Enrollment:      ${R.enrollmentId ? C.g + 'PASS' + C.x : C.r + 'FAIL' + C.x}  id=${R.enrollmentId || '—'} status=${R.enrollmentStatus || '—'}`);
  if (R.matchedSeq) line(`  Sequence:        "${R.matchedSeq.name}" (${R.matchedSeq.id})${R.createdSeqId ? C.d + ' [ephemeral — removed by --cleanup]' + C.x : ''}`);
  if (CFG.live) {
    line(`  SMS send:        ${R.sms ? C.g + 'PASS' + C.x + ` SID=${R.sms.sid}` : C.r + 'TIMEOUT/FAIL' + C.x}`);
    line(`  Voice call:      ${fmt(R.voice, v => `id=${v.id}`)}`);
    line(`  Step advanced:   ${R.stepAdvanced != null ? 'step ' + R.stepAdvanced : '—'}`);
    if (R.tone) line(`  Tone applied:    recommended_tone=${R.tone}, is_hot_lead=true (check received SMS/call persona)`);
  } else {
    line(`  Dispatch:        ${C.y}none (dry run)${C.x}`);
  }
  line(`  ${passed ? C.g + C.b + 'OVERALL: PASS' : C.r + C.b + 'OVERALL: FAIL'}${C.x}`);
  line('');
  if (CFG.live && passed) info('Confirm in the real world: your phone should ring (designated persona) and the SMS should arrive.');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (flag('help') || flag('h')) { line(readHelp()); process.exit(0); }
  requireEnv();
  const sb = db();

  line(`${C.b}${C.c}Omnify Sequencer E2E${C.x}  ${C.d}${stamp}  run=${RUN_ID}${C.x}`);

  if (CFG.cleanupOnly) { await cleanup(sb); process.exit(0); }

  await healthCheck();
  await preflight(sb);

  if (CFG.checkOnly) { head('Read-only check complete (no writes, no dispatch).'); process.exit(0); }

  if (CFG.live) await runLive(sb);
  else await runDryRun(sb);

  await adminStats();

  // pass/fail logic
  let passed;
  if (CFG.live) passed = !!(R.health && R.ingest && R.enrollmentId && R.sms && R.voice && !R.voice.skipped);
  else passed = !!(R.health && R.ingest && R.contactId && R.enrollmentId);

  if (CFG.cleanup) await cleanup(sb);

  printReport(passed);
  process.exit(passed ? 0 : 1);
})().catch((e) => { bad(`unexpected error: ${e.stack || e.message}`); process.exit(1); });

function readHelp() {
  return `Omnify Sequencer E2E harness — see header comment for full docs.
  node scripts/e2e-lead-test.mjs --phone +1555...            # dry run (safe, no dispatch)
  node scripts/e2e-lead-test.mjs --phone +1555... --live     # real SMS + voice call
  node scripts/e2e-lead-test.mjs --check-only --tenant <uuid> # read-only readiness check (no phone, no writes)
  # client with no sequence — provision an ephemeral SMS→voice seq wired to a real assistant, run live, tear down:
  node scripts/e2e-lead-test.mjs --live --tenant <uuid> --phone +1555... --create-test-seq --assistant <vapi_id> --agent <agent_uuid> --cleanup
  flags: --tenant <uuid> --sequence <uuid> --tone <t> --email <e> --timeout <s>
         --create-test-seq --assistant <vapi_id> --agent <agent_uuid> --no-voice
         --cleanup --cleanup-only --check-only --no-test-mode --url <u>`;
}
