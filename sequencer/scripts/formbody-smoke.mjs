// Smoke test: Twilio posts application/x-www-form-urlencoded; Fastify 4
// only parses JSON/text by default, so @fastify/formbody must be
// registered or every Twilio webhook 415s before the handler runs
// (review C2). Run: node scripts/formbody-smoke.mjs
import Fastify from 'fastify';
import formbody from '@fastify/formbody';

const app = Fastify();
await app.register(formbody);
app.post('/webhooks/twilio/sms-status/:tenantId', async (req) => ({ parsed: req.body }));

const res = await app.inject({
    method: 'POST',
    url: '/webhooks/twilio/sms-status/tenant-123',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'MessageSid=SM123abc&MessageStatus=delivered&To=%2B15551234567',
});

console.log('status:', res.statusCode);
console.log('body:', res.body);
if (res.statusCode !== 200 || !res.body.includes('SM123abc')) {
    console.error('SMOKE TEST FAILED');
    process.exit(1);
}
console.log('SMOKE TEST PASSED: form-encoded Twilio payload parses');
