/**
 * Analytics Worker (Phase 5: Outcome-Based Learning)
 *
 * Runs on a scheduled interval to:
 * 1. Compute step-level analytics for all active sequences
 * 2. Compute sequence-level analytics
 * 3. Evaluate active A/B tests and auto-promote winners
 * 4. Generate optimization suggestions
 * 5. Compute industry benchmarks (weekly)
 */

import 'dotenv/config';
import { runAnalyticsJob, runBenchmarkJob } from '../lib/outcome-learning.js';

const ANALYTICS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BENCHMARK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

let lastBenchmarkRun = 0;

/**
 * Main analytics tick
 */
async function tick(): Promise<void> {
    const startTime = Date.now();

    try {
        console.log('[ANALYTICS] Starting hourly analytics run...');

        // Run hourly analytics (step + sequence analytics, A/B tests, optimizations)
        await runAnalyticsJob();

        // Run weekly benchmarks
        const now = Date.now();
        if (now - lastBenchmarkRun > BENCHMARK_INTERVAL_MS) {
            console.log('[ANALYTICS] Running weekly benchmark computation...');
            await runBenchmarkJob();
            lastBenchmarkRun = now;
        }

        const duration = Date.now() - startTime;
        console.log(`[ANALYTICS] Analytics tick completed in ${duration}ms`);
    } catch (error) {
        console.error('[ANALYTICS] Analytics tick error:', error);
    }
}

/**
 * Start the analytics worker
 */
async function start(): Promise<void> {
    console.log('[ANALYTICS] Starting analytics worker...');
    console.log(`[ANALYTICS] Analytics interval: ${ANALYTICS_INTERVAL_MS / 1000}s`);
    console.log(`[ANALYTICS] Benchmark interval: ${BENCHMARK_INTERVAL_MS / 1000}s`);

    // Run initial tick after a short delay (let other workers start first)
    setTimeout(async () => {
        await tick();
        // Set up interval
        setInterval(tick, ANALYTICS_INTERVAL_MS);
    }, 10000); // 10s startup delay

    console.log('[ANALYTICS] Analytics worker running');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('[ANALYTICS] Received SIGTERM, shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[ANALYTICS] Received SIGINT, shutting down...');
    process.exit(0);
});

// Start the worker
start().catch((error) => {
    console.error('[ANALYTICS] Fatal error:', error);
    process.exit(1);
});
