import { listVoices } from "../src/lib/vapi";

async function main() {
    console.log("Testing listVoices...");
    const voices = await listVoices(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY);
    console.log("Voices found:", voices.length);
    if (voices.length > 0) {
        console.log("Sample voice:", voices[0]);
    }
}

main().catch(console.error);
