#!/usr/bin/env node
/**
 * Backfill: dual-channel agent messaging (voice + SMS + shared context)
 * =====================================================================
 *
 * Agents deployed BEFORE the dual-channel change only have a slim agent_config
 * (persona, product one-liner, ICP, goal) and no sms_prompt / shared_context /
 * voice_prompt. Their sequences also predate enable_chatbot_mode + agent
 * binding. This one-time script brings an existing tenant (e.g. the Omnify
 * self-account) up to the new shape so the sequencer can adapt per channel.
 *
 * For each OUTBOUND agent of the target client it ensures agent_config has:
 *   - shared_context   (assembled from whatever structured fields exist)
 *   - sms_prompt / sms_first_message   (a sensible default if missing)
 *   - voice_prompt     (fetched from VAPI when VAPI_API_KEY is set — optional)
 * For each sequence of the client it sets:
 *   - agent_id          (when null and the client has exactly one outbound agent)
 *   - enable_chatbot_mode = true
 *
 * After running, refine the SMS prompt per agent in the dashboard
 * (Agents → <agent> → SMS tab).
 *
 * Secrets are read from sequencer/.env.production and never printed.
 *
 * Scope: by default it sweeps ALL non-custom (shared-VAPI-key) accounts and
 * skips own-key "custom" accounts (CUSTOM / type_a_byoa) — we don't auto-mutate
 * real external customers' agents. Pass --client to target one, or
 * --include-custom to override the skip.
 *
 * USAGE
 *   node scripts/backfill-agent-messaging.mjs                  # DRY RUN, all non-custom accounts
 *   node scripts/backfill-agent-messaging.mjs --apply          # write, all non-custom accounts
 *   node scripts/backfill-agent-messaging.mjs --client <uuid>          # dry run, one client
 *   node scripts/backfill-agent-messaging.mjs --client <uuid> --apply  # write, one client
 *   node scripts/backfill-agent-messaging.mjs --include-custom --apply # also custom accounts
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_KEY (required); VAPI_API_KEY (optional).
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, env, dflt) => {
  const i = argv.indexOf(`--${n}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[env] ?? dflt;
};

const CLIENT_ID = opt('client', 'CLIENT_ID', null); // optional — omit to sweep all non-custom
const APPLY = flag('apply');
const INCLUDE_CUSTOM = flag('include-custom');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPI_API_KEY = process.env.VAPI_API_KEY || null;

// Own-VAPI-key ("custom") account types — skipped by default. We don't auto-inject
// SMS prompts / enable auto-replies / rebind agents on real external customers'
// accounts (and their assistants live under their own VAPI key anyway).
const CUSTOM_ACCOUNT_TYPES = ['CUSTOM', 'type_a_byoa'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in sequencer/.env.production');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);

// ── Build a shared_context object from whatever the old agent_config has ──
function buildSharedContext(cfg) {
  const sc = {};
  const set = (k, v) => {
    if (v !== undefined && v !== null && v !== '') sc[k] = v;
  };
  set('company_name', cfg.company_name || cfg.voice_name);
  set('product_one_liner', cfg.product_one_liner);
  set('icp', cfg.icp);
  set('value_props', cfg.value_props);
  set('common_objections', cfg.common_objections);
  set('pricing_summary', cfg.pricing_summary);
  set('markets', cfg.markets);
  set('deal_types', cfg.deal_types);
  set('appointment_type', cfg.appointment_type);
  set('persona_name', cfg.persona_name);
  set('goal', cfg.outbound_goal || cfg.goal);
  return sc;
}

// ── A compact default SMS prompt assembled from the shared context. The
//    in-app builders produce richer copy; this is a serviceable backfill the
//    operator can refine in the SMS tab. ──
function defaultSmsPrompt(sc) {
  const persona = sc.persona_name || 'our team';
  const company = sc.company_name || 'us';
  const lines = [
    `# ${company} — Outbound SMS Agent`,
    ``,
    `You are ${persona}, texting on behalf of ${company}.`,
    sc.product_one_liner ? `What ${company} does: ${sc.product_one_liner}` : null,
    sc.icp ? `Who you're texting: ${sc.icp}` : null,
    ``,
    `## Goal`,
    `Earn a reply and get the lead to agree to a quick call. You do NOT close on text — the call does that.`,
    ``,
    sc.value_props ? `## Talking points (use one at a time, only when it helps)\n${sc.value_props}` : null,
    sc.common_objections ? `## Objections to expect (answer in one line, then steer to the call)\n${sc.common_objections}` : null,
    sc.pricing_summary
      ? `## Pricing\nIf asked, you may share: ${sc.pricing_summary}. Then steer back to the call.`
      : `## Pricing\nNever quote or invent a price. If asked, say it depends and that's what the call covers.`,
    ``,
    `## SMS style`,
    `- Under 160 characters; one idea per text; sound like a real person.`,
    `- Use the first name at most once or twice. Never reveal you're an AI.`,
    `- Never invent a fact, feature, or number not in the lead data.`,
    `- Always end with a soft, concrete next step — never a dead end.`,
    `- Reference the prior conversation (including any previous call) naturally.`,
  ].filter(Boolean);
  return lines.join('\n');
}

async function fetchVapiPrompt(vapiId) {
  if (!VAPI_API_KEY || !vapiId) return null;
  try {
    const res = await fetch(`https://api.vapi.ai/assistant/${vapiId}`, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
    });
    if (!res.ok) return null;
    const a = await res.json();
    const sysPrompt =
      a?.model?.systemPrompt ||
      (Array.isArray(a?.model?.messages)
        ? a.model.messages.find((m) => m.role === 'system')?.content
        : null);
    return { voice_prompt: sysPrompt || null, voice_first_message: a?.firstMessage || null };
  } catch {
    return null;
  }
}

// Returns counts so the sweep can print a summary.
async function processClient(client) {
  const clientId = client.id;
  const counts = { agents: 0, agentsUpdated: 0, seqsUpdated: 0 };

  const { data: agents, error: aErr } = await db
    .from('agents')
    .select('id, name, vapi_id, agent_type, agent_config')
    .eq('client_id', clientId)
    .eq('agent_type', 'outbound');
  if (aErr) {
    log(`  ! agents query failed: ${aErr.message}`);
    return counts;
  }
  if (!agents || agents.length === 0) return counts; // nothing outbound here

  log(`\n── Client ${clientId} (account_type=${client.account_type ?? 'null'}) — ${agents.length} outbound agent(s) ──`);
  counts.agents = agents.length;

  for (const agent of agents) {
    const cfg = { ...(agent.agent_config || {}) };
    const before = `shared=${!!cfg.shared_context} sms=${!!cfg.sms_prompt} voice=${!!cfg.voice_prompt}`;

    if (!cfg.shared_context) cfg.shared_context = buildSharedContext(cfg);
    if (!cfg.sms_prompt) cfg.sms_prompt = defaultSmsPrompt(cfg.shared_context);
    if (!cfg.sms_first_message) {
      const persona = cfg.shared_context.persona_name || 'the team';
      const company = cfg.shared_context.company_name || 'us';
      cfg.sms_first_message = `Hey {{first_name}}, it's ${persona} from ${company} — got a quick sec?`;
    }
    if (!cfg.voice_prompt) {
      const v = await fetchVapiPrompt(agent.vapi_id);
      if (v?.voice_prompt) cfg.voice_prompt = v.voice_prompt;
      if (v?.voice_first_message) cfg.voice_first_message = v.voice_first_message;
    }

    log(`  agent ${agent.name} (${agent.id}): ${before} → shared=${!!cfg.shared_context} sms=${!!cfg.sms_prompt} voice=${!!cfg.voice_prompt}`);
    if (APPLY) {
      const { error } = await db.from('agents').update({ agent_config: cfg }).eq('id', agent.id);
      if (error) log(`    ! update failed: ${error.message}`);
      else { log('    ✓ agent_config updated'); counts.agentsUpdated++; }
    } else {
      counts.agentsUpdated++;
    }
  }

  // ── Sequences: bind agent (if unambiguous) + enable chatbot ──
  const onlyOutboundAgentId = agents.length === 1 ? agents[0].id : null;
  const { data: seqs, error: sErr } = await db
    .from('sequences')
    .select('id, name, agent_id, enable_chatbot_mode')
    .eq('client_id', clientId);
  if (sErr) {
    log(`  ! sequences query failed: ${sErr.message}`);
    return counts;
  }

  for (const seq of seqs || []) {
    const updates = {};
    if (!seq.agent_id && onlyOutboundAgentId) updates.agent_id = onlyOutboundAgentId;
    if (!seq.enable_chatbot_mode) updates.enable_chatbot_mode = true;
    if (Object.keys(updates).length === 0) continue;

    log(`  sequence ${seq.name} (${seq.id}) → ${JSON.stringify(updates)}`);
    if (APPLY) {
      const { error } = await db.from('sequences').update(updates).eq('id', seq.id);
      if (error) log(`    ! update failed: ${error.message}`);
      else { log('    ✓ sequence updated'); counts.seqsUpdated++; }
    } else {
      counts.seqsUpdated++;
    }
  }

  return counts;
}

async function main() {
  log(`\nBackfill agent messaging — ${APPLY ? 'APPLY' : 'DRY RUN'} — skipping account types: ${CUSTOM_ACCOUNT_TYPES.join(', ')}${INCLUDE_CUSTOM ? ' (overridden: --include-custom)' : ''}\n`);

  // Resolve the target client list.
  let clients;
  if (CLIENT_ID) {
    const { data, error } = await db
      .from('clients')
      .select('id, account_type')
      .eq('id', CLIENT_ID)
      .maybeSingle();
    if (error) throw error;
    if (!data) { log(`Client ${CLIENT_ID} not found.`); return; }
    if (!INCLUDE_CUSTOM && CUSTOM_ACCOUNT_TYPES.includes(data.account_type)) {
      log(`Client ${CLIENT_ID} is account_type=${data.account_type} (custom/own-key) — skipping. Pass --include-custom to force.`);
      return;
    }
    clients = [data];
  } else {
    const { data, error } = await db.from('clients').select('id, account_type');
    if (error) throw error;
    const all = data || [];
    clients = all.filter((c) => INCLUDE_CUSTOM || !CUSTOM_ACCOUNT_TYPES.includes(c.account_type));
    log(`${clients.length} non-custom client(s) to scan; ${all.length - clients.length} custom client(s) skipped.`);
  }

  const totals = { clientsTouched: 0, agents: 0, agentsUpdated: 0, seqsUpdated: 0 };
  for (const c of clients) {
    const r = await processClient(c);
    if (r.agents > 0) totals.clientsTouched++;
    totals.agents += r.agents;
    totals.agentsUpdated += r.agentsUpdated;
    totals.seqsUpdated += r.seqsUpdated;
  }

  log(`\n── Summary ──`);
  log(`clients with outbound agents: ${totals.clientsTouched}`);
  log(`agents ${APPLY ? 'updated' : 'to update'}: ${totals.agentsUpdated}/${totals.agents}`);
  log(`sequences ${APPLY ? 'updated' : 'to update'}: ${totals.seqsUpdated}`);
  log(`\nDone.${APPLY ? '' : ' (dry run — re-run with --apply to write)'}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
