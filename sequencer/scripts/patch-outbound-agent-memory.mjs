#!/usr/bin/env node
/**
 * Patch existing OUTBOUND VAPI assistant(s) so the voice agent can recall the
 * cross-channel conversation (prior SMS + calls). It splices a
 * "Prior Conversation — cross-channel memory" section, carrying the
 * {{conversation_history}}, {{task_context}} and {{tone_directive}} placeholders,
 * into the assistant's system prompt on VAPI. The sequencer already computes and
 * passes those variables at call time (scheduler-worker.ts → vapi-worker.ts); this
 * gives the baked-in prompt the slots to receive them.
 *
 * Why a one-off script: the fix in src/lib/verticals/saas/outbound-prompt-templates.ts
 * only affects NEWLY deployed agents. Assistants that were already created (e.g.
 * "Omnify - Book Demo") have the old prompt baked into VAPI and must be patched live.
 *
 * Mirrors the app's proven update shape (src/app/actions/agent-actions.ts):
 *   GET assistant → splice block → PATCH { model: { ...model (no messages), systemPrompt } }
 *
 * Idempotent: skips any assistant whose prompt already contains
 * {{conversation_history}}. DRY RUN by default; pass --apply to write to VAPI.
 * Reads secrets from sequencer/.env.production and NEVER prints them.
 *
 * USAGE (from sequencer/):
 *   node scripts/patch-outbound-agent-memory.mjs                    # dry-run: Omnify - Book Demo (B2B Wizards)
 *   node scripts/patch-outbound-agent-memory.mjs --apply            # apply that one
 *   node scripts/patch-outbound-agent-memory.mjs --all-outbound     # dry-run: every outbound agent on the tenant
 *   node scripts/patch-outbound-agent-memory.mjs --all-outbound --apply
 *   node scripts/patch-outbound-agent-memory.mjs --vapi-id <id> --apply
 *
 * FLAGS:
 *   --tenant <uuid>   client/tenant whose VAPI umbrella key to use (default B2B Wizards)
 *   --vapi-id <id>    target a specific VAPI assistant id (default Omnify - Book Demo)
 *   --all-outbound    target every agent_type='outbound' agent on the tenant instead
 *   --apply           actually PATCH VAPI (omit = dry run, GET + preview only)
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const CFG = {
    tenantId: opt('tenant', '36b43327-ea8c-4432-90fc-0ddca6b17498'), // B2B Wizards
    vapiId: opt('vapi-id', 'c16fa8c6-4646-4f0d-857b-86b83e519853'),  // Omnify - Book Demo
    allOutbound: flag('all-outbound'),
    apply: flag('apply'),
};

// ── the block to splice in (kept identical to crossChannelMemoryBlock() in
//    src/lib/verticals/saas/outbound-prompt-templates.ts) ───────────────────
const MEMORY_BLOCK = `## [Prior Conversation — cross-channel memory, READ FIRST]

This lead may have already heard from us on other channels. Everything below is context — read it silently, never aloud.

**Conversation so far — every call, text, and email with this lead, both directions (this is empty only if it's the very first touch):**
{{conversation_history}}

**What this specific outreach is about:** {{task_context}}

**Tone to strike on this call:** {{tone_directive}}

**Continuity rules:**
- If the conversation above is non-empty, you have ALREADY been in contact. Do NOT reintroduce yourself as if it's the first time, and do NOT re-ask anything they've already answered.
- Treat texts and past calls as one continuous relationship — reference what they told you before ("When we texted, you mentioned...", "Last time we talked, you were weighing...").
- If they raised an objection earlier, address it head-on instead of waiting for it to come up again.
- Let this shape your opener: a lead who's been texting with us is warmer than a cold dial — match that energy.`;

const MARKER = '{{conversation_history}}'; // idempotency sentinel
const ANCHOR = '## [Style]';               // splice the block in just before this section

// ── crypto (mirrors sequencer/src/lib/encryption.ts) ────────────────────────
function decrypt(enc) {
    const SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
    if (!SHAPE.test(enc)) return enc; // legacy plaintext passthrough
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const [iv, tag, ct] = enc.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return d.update(ct, 'base64', 'utf8') + d.final('utf8');
}

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// ── helpers ─────────────────────────────────────────────────────────────────
function readSystemPrompt(model) {
    if (!model) return '';
    if (typeof model.systemPrompt === 'string' && model.systemPrompt) return model.systemPrompt;
    const sys = (model.messages || []).find((m) => m.role === 'system');
    return sys?.content || '';
}

function splice(prompt) {
    if (prompt.includes(MARKER)) return { changed: false, prompt, how: 'already-present' };
    if (prompt.includes(ANCHOR)) {
        return { changed: true, prompt: prompt.replace(ANCHOR, `${MEMORY_BLOCK}\n\n${ANCHOR}`), how: `before "${ANCHOR}"` };
    }
    return { changed: true, prompt: `${MEMORY_BLOCK}\n\n${prompt}`, how: 'prepended (anchor not found)' };
}

async function resolveVapiKey(tenantId) {
    const { data, error } = await sb
        .from('tenant_vapi_assignments')
        .select('vapi_umbrellas ( vapi_api_key_encrypted )')
        .eq('client_id', tenantId)
        .eq('is_active', true)
        .single();
    if (error || !data?.vapi_umbrellas?.vapi_api_key_encrypted) {
        throw new Error(`No active VAPI umbrella for tenant ${tenantId}: ${error?.message || 'not found'}`);
    }
    return decrypt(data.vapi_umbrellas.vapi_api_key_encrypted);
}

async function vapiGet(id, key) {
    const r = await fetch(`https://api.vapi.ai/assistant/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`VAPI GET ${id} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
}

async function vapiPatchModel(id, key, model) {
    const r = await fetch(`https://api.vapi.ai/assistant/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
    });
    if (!r.ok) throw new Error(`VAPI PATCH ${id} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\nPatch outbound agent memory — ${CFG.apply ? 'APPLY (writes to VAPI)' : 'DRY RUN (no writes)'}`);
    console.log(`tenant ${CFG.tenantId}\n`);

    const key = await resolveVapiKey(CFG.tenantId);

    // Resolve target list
    let targets;
    if (CFG.allOutbound) {
        const { data, error } = await sb
            .from('agents')
            .select('id, name, vapi_id, agent_type')
            .eq('client_id', CFG.tenantId)
            .eq('agent_type', 'outbound')
            .not('vapi_id', 'is', null);
        if (error) throw new Error(`agents query: ${error.message}`);
        targets = data;
    } else {
        const { data } = await sb.from('agents').select('id, name, vapi_id').eq('vapi_id', CFG.vapiId).maybeSingle();
        targets = [{ vapi_id: CFG.vapiId, name: data?.name || '(unknown — patching by vapi-id)' }];
    }

    if (!targets.length) { console.log('No target agents found.'); process.exit(0); }

    let patched = 0, skipped = 0, failed = 0;
    for (const t of targets) {
        const label = `${t.name} [${t.vapi_id}]`;
        try {
            const assistant = await vapiGet(t.vapi_id, key);
            const model = assistant.model || {};
            const current = readSystemPrompt(model);
            if (!current) { console.log(`  ⚠ ${label}: no system prompt found on VAPI — skipping`); skipped++; continue; }

            const { changed, prompt: next, how } = splice(current);
            if (!changed) { console.log(`  ✓ ${label}: already has cross-channel memory — skipped`); skipped++; continue; }

            console.log(`  • ${label}`);
            console.log(`      prompt ${current.length} → ${next.length} chars; block inserted ${how}`);

            if (!CFG.apply) {
                const idx = next.indexOf(MEMORY_BLOCK);
                console.log(`      preview (context around insertion):`);
                console.log('      …' + next.slice(Math.max(0, idx - 60), idx + 120).replace(/\n/g, '\n      ') + '…');
                patched++; // would-patch
                continue;
            }

            const newModel = { ...model };
            delete newModel.messages;      // mirror agent-actions.ts: use flat systemPrompt
            newModel.systemPrompt = next;
            await vapiPatchModel(t.vapi_id, key, newModel);
            console.log(`      ✓ PATCHed on VAPI`);
            patched++;
        } catch (err) {
            console.log(`  ✗ ${label}: ${err.message}`);
            failed++;
        }
    }

    console.log(`\n${CFG.apply ? 'Applied' : 'Would patch'}: ${patched} | skipped: ${skipped} | failed: ${failed}`);
    if (!CFG.apply && patched > 0) console.log('Re-run with --apply to write these to VAPI.');
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
