#!/usr/bin/env node
/**
 * Queue a one-off booking-link SMS for an enrollment through the sequencer's
 * own `sms-send` queue — same payload shape as maybeSendBookingLinkSms in
 * event-processor, so the sms-worker applies opt-out, TCPA window, dedup and
 * interaction recording exactly as it would for an automatic send.
 *
 * Run ON the sequencer host (needs its .env + Redis):
 *   cd /opt/omnify/sequencer && node scripts/send-booking-link-sms.mjs \
 *     --enrollment <uuid> --call-id <vapi call id> [--body "<text>"] [--apply]
 *
 * DRY RUN by default: prints the payload and the scheduled send time.
 * The body defaults to the standard "grab a time here" message with the
 * tenant's booking_link.
 */
import 'dotenv/config';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };

const enrollmentId = opt('enrollment');
const callId = opt('call-id') || 'manual';
if (!enrollmentId) { console.error('usage: --enrollment <uuid> [--call-id <id>] [--body "<text>"] [--apply]'); process.exit(1); }

const db = await import('../dist/lib/db.js');
const supabase = db.supabase || db.default?.supabase;
const compliance = await import('../dist/lib/compliance.js');
const { isTCPACompliant, getNextBusinessHoursStart } = compliance.default || compliance;
const redis = await import('../dist/lib/redis.js');
const smsQueue = redis.smsQueue || redis.default?.smsQueue;

const { data: enrollment, error } = await supabase
    .from('sequence_enrollments')
    .select('id, tenant_id, status, appointment_booked, contacts(phone, name, opted_out_at)')
    .eq('id', enrollmentId)
    .single();
if (error || !enrollment) { console.error('enrollment not found:', error?.message); process.exit(1); }
const contact = enrollment.contacts;
if (!contact?.phone) { console.error('contact has no phone'); process.exit(1); }
if (contact.opted_out_at) { console.error(`contact opted out at ${contact.opted_out_at} — refusing`); process.exit(1); }
if (enrollment.appointment_booked || enrollment.status === 'booked') { console.error('already booked — nothing to send'); process.exit(1); }

const { data: profile } = await supabase
    .from('tenant_profiles')
    .select('booking_link, timezone, business_hours')
    .eq('client_id', enrollment.tenant_id)
    .maybeSingle();
const bookingLink = (profile?.booking_link || '').trim();
if (!bookingLink) { console.error('tenant has no booking_link configured'); process.exit(1); }

const firstName = contact.name?.split(' ')[0] || '';
const body = opt('body')
    || `${firstName ? `${firstName}, great` : 'Great'} talking with you just now! You can grab a time that works for you here: ${bookingLink}`;

const timezone = profile?.timezone || 'America/New_York';
let delayMs = 0;
if (!isTCPACompliant(timezone)) {
    const resumeAt = getNextBusinessHoursStart(timezone, profile?.business_hours || null, new Date());
    delayMs = Math.max(0, resumeAt.getTime() - Date.now());
}

const payload = {
    tenantId: enrollment.tenant_id,
    contactPhone: contact.phone,
    body,
    enrollmentId,
    stepId: null,
    dedupKey: `booking-link:${enrollmentId}:${callId}`,
    metadata: { source: 'booking_link', callId, manual: true },
};
const sendAt = new Date(Date.now() + delayMs);
console.log(`to: ${contact.name} ${contact.phone}`);
console.log(`body (${body.length} chars): ${body}`);
console.log(`send at: ${sendAt.toISOString()} (${delayMs > 0 ? `delayed ${Math.round(delayMs / 60000)} min for the ${timezone} window` : 'immediately'})`);
console.log(`dedupKey: ${payload.dedupKey}`);

if (!flag('apply')) {
    console.log('\nDRY RUN — pass --apply to queue it.');
} else {
    const job = await smsQueue.add('sms:booking-link', payload, delayMs > 0 ? { delay: delayMs } : {});
    console.log(`\nqueued job ${job.id} on sms-send`);
}
await smsQueue.close();
process.exit(0);
