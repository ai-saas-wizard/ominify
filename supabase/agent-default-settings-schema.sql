-- Agent Default Settings Schema
-- Stores VAPI configuration templates for inbound/outbound agents
-- These templates are used as base configs when deploying new agents
-- Dynamic fields (name, model.messages, model.toolIds, voice.voiceId, server.url) are set at deploy time

CREATE TABLE IF NOT EXISTS agent_default_settings (
    id TEXT PRIMARY KEY,                -- 'inbound' or 'outbound'
    direction TEXT NOT NULL,            -- 'inbound' or 'outbound'
    settings JSONB NOT NULL,            -- Full VAPI config template (minus dynamic parts)
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with inbound defaults
INSERT INTO agent_default_settings (id, direction, settings) VALUES (
    'inbound',
    'inbound',
    '{
        "voice": {
            "model": "eleven_flash_v2_5",
            "speed": 1.1,
            "style": 0.2,
            "provider": "11labs",
            "stability": 0.4,
            "similarityBoost": 0.6,
            "useSpeakerBoost": false
        },
        "model": {
            "model": "gpt-4o-mini",
            "provider": "openai",
            "maxTokens": 250,
            "temperature": 0.65
        },
        "transcriber": {
            "model": "nova-3",
            "language": "en",
            "numerals": true,
            "provider": "deepgram"
        },
        "recordingEnabled": true,
        "endCallFunctionEnabled": true,
        "endCallPhrases": ["goodbye", "talk to you soon"],
        "dialKeypadFunctionEnabled": true,
        "maxDurationSeconds": 3083,
        "firstMessageMode": "assistant-speaks-first-with-model-generated-message",
        "voicemailDetection": {
            "provider": "vapi",
            "backoffPlan": {
                "maxRetries": 6,
                "startAtSeconds": 5,
                "frequencySeconds": 5
            },
            "beepMaxAwaitSeconds": 0
        },
        "messagePlan": {
            "idleMessages": ["Are you still there?"]
        },
        "stopSpeakingPlan": {
            "numWords": 3
        },
        "server": {
            "timeoutSeconds": 20
        },
        "clientMessages": ["transcript", "hang", "function-call", "speech-update", "metadata", "conversation-update", "status-update", "assistant.started"],
        "serverMessages": ["end-of-call-report", "status-update", "hang", "function-call", "conversation-update", "assistant.started", "transfer-update", "speech-update"],
        "compliancePlan": {
            "hipaaEnabled": false,
            "pciEnabled": false
        }
    }'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Seed with outbound defaults
INSERT INTO agent_default_settings (id, direction, settings) VALUES (
    'outbound',
    'outbound',
    '{
        "voice": {
            "model": "eleven_turbo_v2_5",
            "speed": 1.1,
            "provider": "11labs",
            "stability": 0.2,
            "similarityBoost": 0.75
        },
        "model": {
            "model": "gpt-4o-mini",
            "provider": "openai",
            "temperature": 0.6
        },
        "transcriber": {
            "model": "nova-2",
            "language": "en",
            "numerals": true,
            "provider": "deepgram"
        },
        "recordingEnabled": true,
        "endCallFunctionEnabled": true,
        "endCallPhrases": ["goodbye", "talk to you soon"],
        "firstMessageMode": "assistant-waits-for-user",
        "voicemailDetection": {
            "provider": "vapi",
            "backoffPlan": {
                "maxRetries": 6,
                "startAtSeconds": 5,
                "frequencySeconds": 5
            },
            "beepMaxAwaitSeconds": 0
        },
        "messagePlan": {
            "idleMessages": ["Are you still there?"]
        },
        "startSpeakingPlan": {
            "waitSeconds": 0.7,
            "smartEndpointingPlan": {
                "provider": "livekit"
            }
        },
        "stopSpeakingPlan": {
            "numWords": 3,
            "backoffSeconds": 3
        },
        "server": {
            "timeoutSeconds": 20
        },
        "clientMessages": ["transcript", "hang", "function-call", "speech-update", "metadata", "conversation-update", "status-update", "assistant.started"],
        "serverMessages": ["end-of-call-report", "status-update", "hang", "function-call", "conversation-update", "assistant.started", "transfer-update", "speech-update"],
        "compliancePlan": {
            "hipaaEnabled": false,
            "pciEnabled": false
        }
    }'::jsonb
) ON CONFLICT (id) DO NOTHING;
