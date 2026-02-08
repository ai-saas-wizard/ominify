/**
 * OMINIFY Sequencer - Entry Point
 * 
 * This module is not meant to be run directly.
 * See package.json scripts for individual worker/server commands:
 *   npm run scheduler
 *   npm run sms-worker
 *   npm run email-worker
 *   npm run vapi-worker
 *   npm run event-processor
 *   npm run webhook-server
 * 
 * For production, use PM2:
 *   pm2 start ecosystem.config.js --env production
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║            OMINIFY Sequencer Engine v1.0.0                   ║
╠══════════════════════════════════════════════════════════════╣
║  Available commands:                                         ║
║    npm run scheduler      - Start scheduler worker           ║
║    npm run sms-worker     - Start SMS worker                 ║
║    npm run email-worker   - Start email worker               ║
║    npm run vapi-worker    - Start VAPI worker                ║
║    npm run event-processor- Start event processor            ║
║    npm run webhook-server - Start webhook server             ║
║                                                              ║
║  Production:                                                 ║
║    pm2 start ecosystem.config.js --env production            ║
║                                                              ║
║  Docker:                                                     ║
║    docker-compose up -d                                      ║
╚══════════════════════════════════════════════════════════════╝
`);

export { };
