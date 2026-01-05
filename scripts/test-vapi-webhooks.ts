
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = 'http://localhost:3000/api/webhooks/vapi';

async function sendWebhook(name: string, filePath: string, modifyPayload?: (payload: any) => any) {
    try {
        console.log(`\n--- Testing ${name} ---`);
        const fileContent = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
        const json = JSON.parse(fileContent);

        // Extract body from sample structure (usually array -> object -> body)
        let body = Array.isArray(json) ? json[0].body : json.body || json;

        if (modifyPayload) {
            body = modifyPayload(body);
        }

        console.log(`Sending payload to ${WEBHOOK_URL}...`);

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        console.log(`Status: ${response.status}`);
        const text = await response.text();
        try {
            console.log('Response:', JSON.parse(text));
        } catch {
            console.log('Response:', text);
        }
    } catch (error) {
        console.error(`Error in ${name}:`, error);
    }
}

async function main() {
    const cwd = process.cwd();

    // 1. Call Started
    await sendWebhook('Call Started', path.join(cwd, 'Call Started.txt'));

    // Wait
    await new Promise(r => setTimeout(r, 2000));

    // 2. Conversation Update
    await sendWebhook('Conversation Update', path.join(cwd, 'Convo Update.txt'));

    // Wait
    await new Promise(r => setTimeout(r, 2000));

    // 3. Status Update (Ended) - Optional, just updates status
    // Use Call-ended file but keep type as status-update
    await sendWebhook('Status Update (Ended)', path.join(cwd, 'Call-ended-Vapi-Webhook.txt'));

    // Wait
    await new Promise(r => setTimeout(r, 2000));

    // 4. End of Call Report (Simulated)
    // We use the same ended file but change type to end-of-call-report and add summary
    await sendWebhook('End of Call Report', path.join(cwd, 'Call-ended-Vapi-Webhook.txt'), (body) => {
        body.message.type = 'end-of-call-report';
        if (!body.message.call.analysis) {
            body.message.call.analysis = {};
        }
        body.message.call.analysis.summary = "This was a test call simulated by the verification script.";
        return body;
    });

    console.log('\nDone.');
}

main();
