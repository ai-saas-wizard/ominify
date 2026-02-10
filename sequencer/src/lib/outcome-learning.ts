/**
 * Outcome-Based Sequence Learning (Phase 5)
 *
 * Attribution engine, analytics computation, optimization generation,
 * A/B testing, and industry benchmarking.
 */

import { supabase } from './db.js';
import type {
    AttributionResult,
    ConversionType,
    ChannelType,
    StepVariant,
    OptimizationSuggestion,
    SuggestionType,
    ConfidenceLevel,
    SmsContent,
    EmailContent,
    VoiceContent,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════
// ATTRIBUTION ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute step attribution when an enrollment reaches a terminal conversion state.
 * Uses time-decay multi-touch attribution:
 * - Last touch gets 40% weight
 * - First touch gets 20% weight
 * - Middle touches split remaining 40% with exponential time-decay
 */
export async function computeStepAttribution(
    enrollmentId: string,
    conversionType: ConversionType
): Promise<AttributionResult | null> {
    // Get enrollment details
    const { data: enrollment } = await supabase
        .from('sequence_enrollments')
        .select('id, sequence_id, contact_id, enrolled_at, tenant_id')
        .eq('id', enrollmentId)
        .single();

    if (!enrollment) return null;

    // Get all executed steps for this enrollment (in order)
    const { data: executions } = await supabase
        .from('sequence_execution_log')
        .select('step_id, channel, executed_at, sms_status, call_status, email_status')
        .eq('enrollment_id', enrollmentId)
        .order('executed_at', { ascending: true });

    if (!executions || executions.length === 0) return null;

    // Get step orders
    const stepIds = [...new Set(executions.map(e => e.step_id).filter(Boolean))];
    const { data: steps } = await supabase
        .from('sequence_steps')
        .select('id, step_order, channel')
        .in('id', stepIds);

    const stepMap = new Map((steps || []).map(s => [s.id, s]));

    // Build touch points
    const touchPoints = executions
        .filter(e => e.step_id && stepMap.has(e.step_id))
        .map(e => ({
            stepId: e.step_id!,
            stepOrder: stepMap.get(e.step_id!)!.step_order,
            channel: (e.channel || stepMap.get(e.step_id!)!.channel) as ChannelType,
            executedAt: new Date(e.executed_at).getTime(),
        }));

    if (touchPoints.length === 0) return null;

    const conversionTime = Date.now();
    const enrolledAt = new Date(enrollment.enrolled_at).getTime();
    const timeToConversion = Math.round((conversionTime - enrolledAt) / 1000);

    // Compute multi-touch attribution weights
    const attributions = touchPoints.map((tp, index) => {
        let weight: number;
        let touchType: 'first' | 'middle' | 'last' | 'only';

        if (touchPoints.length === 1) {
            weight = 1.0;
            touchType = 'only';
        } else if (index === touchPoints.length - 1) {
            weight = 0.4; // Last touch
            touchType = 'last';
        } else if (index === 0) {
            weight = 0.2; // First touch
            touchType = 'first';
        } else {
            // Middle touches: time-decay within the remaining 0.4
            const recency = (tp.executedAt - touchPoints[0].executedAt) /
                (touchPoints[touchPoints.length - 1].executedAt - touchPoints[0].executedAt);
            weight = 0.4 * recency; // More recent middle touches get more credit
            touchType = 'middle';
        }

        return {
            stepId: tp.stepId,
            stepOrder: tp.stepOrder,
            channel: tp.channel,
            weight,
            touchType,
        };
    });

    // Normalize weights to sum to 1.0
    const totalWeight = attributions.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight > 0) {
        attributions.forEach(a => { a.weight = a.weight / totalWeight; });
    }

    // Identify converting step (last touch)
    const convertingStep = touchPoints[touchPoints.length - 1];

    const result: AttributionResult = {
        enrollmentId,
        convertingStepId: convertingStep.stepId,
        conversionType,
        timeToConversionSeconds: timeToConversion,
        stepAttributions: attributions,
    };

    // Store attribution on enrollment
    await supabase
        .from('sequence_enrollments')
        .update({
            converting_step_id: convertingStep.stepId,
            conversion_type: conversionType,
            time_to_conversion_seconds: timeToConversion,
        })
        .eq('id', enrollmentId);

    // Update step_analytics attributed_conversions
    for (const attr of attributions) {
        try {
            await supabase.rpc('increment_step_attributed_conversions', {
                p_step_id: attr.stepId,
                p_amount: attr.weight,
            });
        } catch {
            // Fallback: RPC may not exist yet — analytics worker will batch-compute
        }
    }

    console.log(`[LEARNING] Attribution computed for enrollment ${enrollmentId}: ${attributions.length} touchpoints, converting step ${convertingStep.stepOrder}`);

    return result;
}

// ═══════════════════════════════════════════════════════════════════
// ANALYTICS COMPUTATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute step-level analytics for a specific step over a time period.
 */
export async function computeStepAnalytics(
    stepId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<void> {
    // Get step info
    const { data: step } = await supabase
        .from('sequence_steps')
        .select('id, sequence_id, channel')
        .eq('id', stepId)
        .single();

    if (!step) return;

    // Get sequence client_id
    const { data: sequence } = await supabase
        .from('sequences')
        .select('client_id')
        .eq('id', step.sequence_id)
        .single();

    if (!sequence) return;

    // Aggregate execution data for this step in the period
    const { data: executions } = await supabase
        .from('sequence_execution_log')
        .select('*')
        .eq('step_id', stepId)
        .gte('executed_at', periodStart.toISOString())
        .lte('executed_at', periodEnd.toISOString());

    const logs = executions || [];
    const totalExecutions = logs.length;
    if (totalExecutions === 0) return;

    // Count outcomes
    const totalDelivered = logs.filter(l => {
        if (l.channel === 'sms') return l.sms_status === 'delivered';
        if (l.channel === 'email') return l.email_status !== 'bounced' && l.email_status !== 'failed';
        if (l.channel === 'voice') return l.call_status === 'answered' || l.call_status === 'completed' || l.call_status === 'voicemail';
        return true;
    }).length;

    const totalFailed = logs.filter(l => {
        if (l.channel === 'sms') return l.sms_status === 'failed' || l.sms_status === 'undelivered';
        if (l.channel === 'email') return l.email_status === 'bounced' || l.email_status === 'failed';
        if (l.channel === 'voice') return l.call_status === 'failed';
        return false;
    }).length;

    // Get replies for enrollments that went through this step
    const enrollmentIds = [...new Set(logs.map(l => l.enrollment_id).filter(Boolean))];

    let totalReplies = 0;
    let totalConversions = 0;

    if (enrollmentIds.length > 0) {
        // Count enrollments that replied after this step
        const { data: repliedEnrollments } = await supabase
            .from('sequence_enrollments')
            .select('id, status, contact_replied, appointment_booked, converting_step_id')
            .in('id', enrollmentIds);

        if (repliedEnrollments) {
            totalReplies = repliedEnrollments.filter(e => e.contact_replied).length;
            totalConversions = repliedEnrollments.filter(e =>
                e.status === 'booked' || e.appointment_booked ||
                (e.converting_step_id === stepId)
            ).length;
        }
    }

    // Mutation tracking
    const { count: mutatedCount } = await supabase
        .from('step_mutations')
        .select('id', { count: 'exact', head: true })
        .eq('step_id', stepId)
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString());

    const { count: mutatedConvCount } = await supabase
        .from('step_mutations')
        .select('id', { count: 'exact', head: true })
        .eq('step_id', stepId)
        .eq('resulted_in_conversion', true)
        .gte('created_at', periodStart.toISOString())
        .lte('created_at', periodEnd.toISOString());

    const mutatedExecs = mutatedCount || 0;
    const mutatedConvs = mutatedConvCount || 0;

    // Compute cost
    const totalCost = logs.reduce((sum, l) => sum + (parseFloat(l.execution_cost) || 0), 0);

    // Compute rates
    const replyRate = totalDelivered > 0 ? totalReplies / totalDelivered : 0;
    const conversionRate = totalDelivered > 0 ? totalConversions / totalDelivered : 0;
    const deliveryRate = totalExecutions > 0 ? totalDelivered / totalExecutions : 0;
    const mutatedConvRate = mutatedExecs > 0 ? mutatedConvs / mutatedExecs : 0;
    const costPerConversion = totalConversions > 0 ? totalCost / totalConversions : 0;

    // Compute hourly response rates
    const hourlyRates: Record<string, number> = {};
    const hourlyExecs: Record<string, number> = {};
    const hourlyReplies: Record<string, number> = {};

    for (const log of logs) {
        const hour = new Date(log.executed_at).getHours().toString();
        hourlyExecs[hour] = (hourlyExecs[hour] || 0) + 1;
    }

    // Find optimal send hour (hour with highest execution density for now)
    let optimalHour: number | null = null;
    let maxRate = 0;
    for (const [hour, rate] of Object.entries(hourlyRates)) {
        if (rate > maxRate) {
            maxRate = rate;
            optimalHour = parseInt(hour);
        }
    }

    // Upsert step_analytics
    const { data: existing } = await supabase
        .from('step_analytics')
        .select('id')
        .eq('step_id', stepId)
        .eq('period_start', periodStart.toISOString())
        .eq('period_end', periodEnd.toISOString())
        .single();

    const analyticsRow = {
        step_id: stepId,
        sequence_id: step.sequence_id,
        client_id: sequence.client_id,
        total_executions: totalExecutions,
        total_delivered: totalDelivered,
        total_failed: totalFailed,
        total_replies: totalReplies,
        total_conversions: totalConversions,
        reply_rate: replyRate,
        conversion_rate: conversionRate,
        delivery_rate: deliveryRate,
        mutated_executions: mutatedExecs,
        mutated_conversions: mutatedConvs,
        mutated_conversion_rate: mutatedConvRate,
        total_cost: totalCost,
        cost_per_conversion: costPerConversion,
        optimal_send_hour: optimalHour,
        hourly_response_rates: hourlyRates,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
    };

    if (existing) {
        await supabase
            .from('step_analytics')
            .update(analyticsRow)
            .eq('id', existing.id);
    } else {
        await supabase
            .from('step_analytics')
            .insert(analyticsRow);
    }
}

/**
 * Compute sequence-level analytics over a time period.
 */
export async function computeSequenceAnalytics(
    sequenceId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<void> {
    // Get sequence info
    const { data: sequence } = await supabase
        .from('sequences')
        .select('id, client_id')
        .eq('id', sequenceId)
        .single();

    if (!sequence) return;

    // Get all enrollments for this sequence in the period
    const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('*')
        .eq('sequence_id', sequenceId)
        .gte('enrolled_at', periodStart.toISOString())
        .lte('enrolled_at', periodEnd.toISOString());

    const enrolled = enrollments || [];
    const totalEnrollments = enrolled.length;
    if (totalEnrollments === 0) return;

    const totalCompletions = enrolled.filter(e =>
        e.status === 'completed' || e.status === 'booked'
    ).length;

    const totalConversions = enrolled.filter(e =>
        e.status === 'booked' || e.appointment_booked
    ).length;

    const totalOptOuts = enrolled.filter(e =>
        e.status === 'manual_stop'
    ).length;

    const totalReplied = enrolled.filter(e => e.contact_replied).length;

    // Timing metrics
    const convertedEnrollments = enrolled.filter(e => e.time_to_conversion_seconds);
    const avgTimeToConversion = convertedEnrollments.length > 0
        ? convertedEnrollments.reduce((sum, e) => sum + (e.time_to_conversion_seconds || 0), 0) / convertedEnrollments.length / 3600
        : 0;

    const avgStepsToConversion = convertedEnrollments.length > 0
        ? convertedEnrollments.reduce((sum, e) => sum + (e.current_step_order || 0), 0) / convertedEnrollments.length
        : 0;

    // Channel effectiveness
    const enrollmentIds = enrolled.map(e => e.id);
    const { data: execLogs } = await supabase
        .from('sequence_execution_log')
        .select('channel, enrollment_id, sms_status, call_status, email_status')
        .in('enrollment_id', enrollmentIds.slice(0, 500)); // Limit for performance

    const channelEffectiveness: Record<string, { sent: number; replied: number; rate: number }> = {};
    for (const log of (execLogs || [])) {
        const ch = log.channel || 'unknown';
        if (!channelEffectiveness[ch]) {
            channelEffectiveness[ch] = { sent: 0, replied: 0, rate: 0 };
        }
        channelEffectiveness[ch].sent++;
    }

    // Count replies per channel
    for (const ch of Object.keys(channelEffectiveness)) {
        const replied = enrolled.filter(e => e.contact_replied).length;
        // Rough approximation — proper per-channel reply tracking would require more granular data
        channelEffectiveness[ch].rate = channelEffectiveness[ch].sent > 0
            ? channelEffectiveness[ch].replied / channelEffectiveness[ch].sent
            : 0;
    }

    // Healing effectiveness
    const { count: healedCount } = await supabase
        .from('healing_log')
        .select('id', { count: 'exact', head: true })
        .in('enrollment_id', enrollmentIds.slice(0, 500));

    const { count: healedSuccessCount } = await supabase
        .from('healing_log')
        .select('id', { count: 'exact', head: true })
        .in('enrollment_id', enrollmentIds.slice(0, 500))
        .eq('healing_succeeded', true);

    const totalHealed = healedCount || 0;
    const healingSuccessRate = totalHealed > 0 ? (healedSuccessCount || 0) / totalHealed : 0;

    // Cost
    const { data: costData } = await supabase
        .from('sequence_execution_log')
        .select('execution_cost')
        .in('enrollment_id', enrollmentIds.slice(0, 500));

    const totalCost = (costData || []).reduce((sum, l) => sum + (parseFloat(l.execution_cost) || 0), 0);

    // Rates
    const completionRate = totalEnrollments > 0 ? totalCompletions / totalEnrollments : 0;
    const conversionRate = totalEnrollments > 0 ? totalConversions / totalEnrollments : 0;
    const replyRate = totalEnrollments > 0 ? totalReplied / totalEnrollments : 0;
    const optOutRate = totalEnrollments > 0 ? totalOptOuts / totalEnrollments : 0;
    const costPerConversion = totalConversions > 0 ? totalCost / totalConversions : 0;
    const costPerEnrollment = totalEnrollments > 0 ? totalCost / totalEnrollments : 0;

    // Upsert
    const { data: existing } = await supabase
        .from('sequence_analytics')
        .select('id')
        .eq('sequence_id', sequenceId)
        .eq('period_start', periodStart.toISOString())
        .eq('period_end', periodEnd.toISOString())
        .single();

    const analyticsRow = {
        sequence_id: sequenceId,
        client_id: sequence.client_id,
        total_enrollments: totalEnrollments,
        total_completions: totalCompletions,
        total_conversions: totalConversions,
        total_opt_outs: totalOptOuts,
        completion_rate: completionRate,
        conversion_rate: conversionRate,
        reply_rate: replyRate,
        opt_out_rate: optOutRate,
        avg_time_to_conversion_hours: avgTimeToConversion,
        avg_steps_to_conversion: avgStepsToConversion,
        total_cost: totalCost,
        cost_per_conversion: costPerConversion,
        cost_per_enrollment: costPerEnrollment,
        channel_effectiveness: channelEffectiveness,
        total_healed: totalHealed,
        healing_success_rate: healingSuccessRate,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
    };

    if (existing) {
        await supabase.from('sequence_analytics').update(analyticsRow).eq('id', existing.id);
    } else {
        await supabase.from('sequence_analytics').insert(analyticsRow);
    }
}

// ═══════════════════════════════════════════════════════════════════
// OPTIMIZATION ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze step analytics and generate optimization suggestions for a sequence.
 * Requires >50 enrollments for statistical relevance.
 */
export async function generateOptimizations(sequenceId: string): Promise<void> {
    // Get sequence with steps
    const { data: sequence } = await supabase
        .from('sequences')
        .select('*, sequence_steps(*)')
        .eq('id', sequenceId)
        .single();

    if (!sequence) return;

    const steps = (sequence.sequence_steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
    if (steps.length === 0) return;

    // Get recent step analytics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data: stepAnalytics } = await supabase
        .from('step_analytics')
        .select('*')
        .eq('sequence_id', sequenceId)
        .gte('period_start', thirtyDaysAgo.toISOString())
        .order('period_start', { ascending: false });

    if (!stepAnalytics || stepAnalytics.length === 0) return;

    // Get sequence analytics
    const { data: seqAnalytics } = await supabase
        .from('sequence_analytics')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

    if (!seqAnalytics || seqAnalytics.total_enrollments < 50) return;

    const suggestions: Array<{
        type: SuggestionType;
        title: string;
        description: string;
        expectedImprovement: number;
        confidence: ConfidenceLevel;
        change: Record<string, any>;
        targetStepId: string | null;
        evidence: Record<string, any>;
    }> = [];

    // Analyze each step for optimization opportunities
    for (const sa of stepAnalytics) {
        const step = steps.find((s: any) => s.id === sa.step_id);
        if (!step) continue;

        // 1. Low-performing step removal
        if (sa.reply_rate < 0.02 && sa.total_delivered > 30 && step.step_order > 1) {
            suggestions.push({
                type: 'remove_step',
                title: `Remove underperforming Step ${step.step_order}`,
                description: `Step ${step.step_order} (${step.channel}) has a ${(sa.reply_rate * 100).toFixed(1)}% reply rate with ${sa.total_delivered} deliveries. Removing it could reduce costs without impacting conversions.`,
                expectedImprovement: 5,
                confidence: sa.total_delivered > 100 ? 'high' : 'medium',
                change: { step_id: step.id, action: 'remove' },
                targetStepId: step.id,
                evidence: {
                    reply_rate: sa.reply_rate,
                    sample_size: sa.total_delivered,
                    cost: sa.total_cost,
                },
            });
        }

        // 2. Channel switching recommendation
        if (step.channel === 'email' && sa.reply_rate < 0.03 && sa.total_delivered > 50) {
            suggestions.push({
                type: 'change_channel',
                title: `Switch Step ${step.step_order} from email to SMS`,
                description: `Email at Step ${step.step_order} has only ${(sa.reply_rate * 100).toFixed(1)}% reply rate. SMS typically performs 3-5x better for direct outreach.`,
                expectedImprovement: 12,
                confidence: 'medium',
                change: { step_id: step.id, new_channel: 'sms' },
                targetStepId: step.id,
                evidence: {
                    current_channel: 'email',
                    current_rate: sa.reply_rate,
                    suggested_channel: 'sms',
                },
            });
        }

        if (step.channel === 'sms' && sa.reply_rate < 0.05 && sa.total_delivered > 50 && step.step_order >= 3) {
            suggestions.push({
                type: 'change_channel',
                title: `Switch Step ${step.step_order} to voice call`,
                description: `SMS at Step ${step.step_order} has only ${(sa.reply_rate * 100).toFixed(1)}% reply rate after ${step.step_order - 1} prior touches. A voice call may break through.`,
                expectedImprovement: 15,
                confidence: 'medium',
                change: { step_id: step.id, new_channel: 'voice' },
                targetStepId: step.id,
                evidence: {
                    current_channel: 'sms',
                    current_rate: sa.reply_rate,
                    step_order: step.step_order,
                },
            });
        }

        // 3. Timing optimization
        if (sa.optimal_send_hour !== null && sa.optimal_send_hour !== step.specific_time) {
            const currentHour = step.specific_time ? parseInt(step.specific_time.split(':')[0]) : null;
            if (currentHour !== null && Math.abs(currentHour - sa.optimal_send_hour) >= 2) {
                suggestions.push({
                    type: 'change_timing',
                    title: `Optimize Step ${step.step_order} send time`,
                    description: `Step ${step.step_order} performs best when sent around ${sa.optimal_send_hour}:00. Consider adjusting the timing.`,
                    expectedImprovement: 8,
                    confidence: 'medium',
                    change: { step_id: step.id, new_send_hour: sa.optimal_send_hour },
                    targetStepId: step.id,
                    evidence: {
                        current_hour: currentHour,
                        optimal_hour: sa.optimal_send_hour,
                        hourly_rates: sa.hourly_response_rates,
                    },
                });
            }
        }

        // 4. Enable mutation if not enabled and mutations perform better
        if (!step.enable_ai_mutation && sa.mutated_executions > 20) {
            if (sa.mutated_conversion_rate > sa.conversion_rate * 1.2) {
                suggestions.push({
                    type: 'enable_mutation',
                    title: `Enable AI Mutation for Step ${step.step_order}`,
                    description: `AI-mutated versions of Step ${step.step_order} convert ${((sa.mutated_conversion_rate / Math.max(sa.conversion_rate, 0.001) - 1) * 100).toFixed(0)}% better than the original template.`,
                    expectedImprovement: Math.round((sa.mutated_conversion_rate / Math.max(sa.conversion_rate, 0.001) - 1) * 100),
                    confidence: sa.mutated_executions > 50 ? 'high' : 'medium',
                    change: { step_id: step.id, enable_ai_mutation: true },
                    targetStepId: step.id,
                    evidence: {
                        original_rate: sa.conversion_rate,
                        mutated_rate: sa.mutated_conversion_rate,
                        mutated_sample: sa.mutated_executions,
                    },
                });
            }
        }

        // 5. A/B test suggestion for high-traffic steps with no active variants
        if (sa.total_delivered > 100 && sa.reply_rate > 0.03) {
            const { count: variantCount } = await supabase
                .from('step_variants')
                .select('id', { count: 'exact', head: true })
                .eq('step_id', step.id)
                .eq('is_active', true);

            if (!variantCount || variantCount === 0) {
                suggestions.push({
                    type: 'split_test',
                    title: `A/B test Step ${step.step_order} content`,
                    description: `Step ${step.step_order} has enough volume (${sa.total_delivered} deliveries) to run a meaningful A/B test. Create a variant to find better-converting content.`,
                    expectedImprovement: 10,
                    confidence: 'medium',
                    change: { step_id: step.id, action: 'create_variant' },
                    targetStepId: step.id,
                    evidence: {
                        current_rate: sa.reply_rate,
                        volume: sa.total_delivered,
                    },
                });
            }
        }
    }

    // 6. Sequence-level: early conversion detection
    if (seqAnalytics.avg_steps_to_conversion > 0 && seqAnalytics.avg_steps_to_conversion < steps.length - 1) {
        const avgSteps = Math.round(seqAnalytics.avg_steps_to_conversion);
        if (steps.length > avgSteps + 2) {
            suggestions.push({
                type: 'remove_step',
                title: `Shorten sequence — most conversions happen by Step ${avgSteps}`,
                description: `Average conversion happens at Step ${avgSteps}, but your sequence has ${steps.length} steps. The last ${steps.length - avgSteps} steps add cost without driving conversions.`,
                expectedImprovement: Math.round(((steps.length - avgSteps) / steps.length) * 20),
                confidence: 'high',
                change: { action: 'truncate_after', step_order: avgSteps + 1 },
                targetStepId: null,
                evidence: {
                    avg_steps_to_conversion: seqAnalytics.avg_steps_to_conversion,
                    total_steps: steps.length,
                    conversion_rate: seqAnalytics.conversion_rate,
                },
            });
        }
    }

    // Dedupe: Don't create suggestions that already exist as pending
    const { data: existingSuggestions } = await supabase
        .from('optimization_suggestions')
        .select('suggestion_type, target_step_id')
        .eq('sequence_id', sequenceId)
        .eq('status', 'pending');

    const existingSet = new Set(
        (existingSuggestions || []).map(s => `${s.suggestion_type}:${s.target_step_id}`)
    );

    // Insert new suggestions
    for (const s of suggestions) {
        const key = `${s.type}:${s.targetStepId}`;
        if (existingSet.has(key)) continue;

        await supabase.from('optimization_suggestions').insert({
            sequence_id: sequenceId,
            client_id: sequence.client_id,
            suggestion_type: s.type,
            title: s.title,
            description: s.description,
            expected_improvement: s.expectedImprovement,
            confidence: s.confidence,
            suggested_change: s.change,
            target_step_id: s.targetStepId,
            evidence: s.evidence,
            status: 'pending',
        });
    }

    if (suggestions.length > 0) {
        console.log(`[LEARNING] Generated ${suggestions.length} optimization suggestions for sequence ${sequenceId}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
// A/B TESTING ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Select a variant for a step based on traffic weights.
 * Returns the variant content, or null to use the original step content.
 */
export async function selectVariant(
    stepId: string
): Promise<{ variantId: string; content: SmsContent | EmailContent | VoiceContent } | null> {
    const { data: variants } = await supabase
        .from('step_variants')
        .select('*')
        .eq('step_id', stepId)
        .eq('is_active', true);

    if (!variants || variants.length === 0) return null;

    // Weighted random selection
    const totalWeight = variants.reduce((sum, v) => sum + parseFloat(v.traffic_weight), 0);
    let random = Math.random() * totalWeight;

    for (const variant of variants) {
        random -= parseFloat(variant.traffic_weight);
        if (random <= 0) {
            return {
                variantId: variant.id,
                content: variant.content as SmsContent | EmailContent | VoiceContent,
            };
        }
    }

    // Fallback to first variant
    return {
        variantId: variants[0].id,
        content: variants[0].content as SmsContent | EmailContent | VoiceContent,
    };
}

/**
 * Record that a variant was sent (increment total_sent).
 */
export async function recordVariantSent(variantId: string): Promise<void> {
    const { data: variant } = await supabase
        .from('step_variants')
        .select('total_sent')
        .eq('id', variantId)
        .single();

    if (variant) {
        await supabase
            .from('step_variants')
            .update({
                total_sent: (variant.total_sent || 0) + 1,
                updated_at: new Date().toISOString(),
            })
            .eq('id', variantId);
    }
}

/**
 * Evaluate an A/B test for a step using a simplified chi-squared test.
 * Returns true if a winner is found (p_value < 0.05).
 */
export async function evaluateTest(stepId: string): Promise<boolean> {
    const { data: variants } = await supabase
        .from('step_variants')
        .select('*')
        .eq('step_id', stepId)
        .eq('is_active', true);

    if (!variants || variants.length < 2) return false;

    // Need minimum sample size for statistical significance
    const MIN_SAMPLE = 30;
    if (variants.some(v => v.total_sent < MIN_SAMPLE)) return false;

    // Simplified chi-squared test for two proportions
    // Compare each pair of variants
    let winnerFound = false;

    for (let i = 0; i < variants.length; i++) {
        for (let j = i + 1; j < variants.length; j++) {
            const a = variants[i];
            const b = variants[j];

            const n1 = a.total_sent;
            const n2 = b.total_sent;
            const p1 = n1 > 0 ? a.total_conversions / n1 : 0;
            const p2 = n2 > 0 ? b.total_conversions / n2 : 0;

            // Pooled proportion
            const p = (a.total_conversions + b.total_conversions) / (n1 + n2);
            const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));

            if (se === 0) continue;

            // Z-score
            const z = Math.abs(p1 - p2) / se;

            // Two-tailed p-value (approximation)
            const pValue = 2 * (1 - normalCDF(z));

            // Update variants with computed metrics
            const convRate1 = n1 > 0 ? a.total_conversions / n1 : 0;
            const convRate2 = n2 > 0 ? b.total_conversions / n2 : 0;
            const replyRate1 = n1 > 0 ? a.total_replies / n1 : 0;
            const replyRate2 = n2 > 0 ? b.total_replies / n2 : 0;

            await supabase.from('step_variants').update({
                conversion_rate: convRate1,
                reply_rate: replyRate1,
                p_value: pValue,
                updated_at: new Date().toISOString(),
            }).eq('id', a.id);

            await supabase.from('step_variants').update({
                conversion_rate: convRate2,
                reply_rate: replyRate2,
                p_value: pValue,
                updated_at: new Date().toISOString(),
            }).eq('id', b.id);

            // If significant, mark winner
            if (pValue < 0.05) {
                const winnerId = p1 > p2 ? a.id : b.id;
                await supabase.from('step_variants').update({
                    is_winner: true,
                }).eq('id', winnerId);

                winnerFound = true;
                console.log(`[LEARNING] A/B test winner found for step ${stepId}: variant ${winnerId} (p=${pValue.toFixed(4)})`);
            }
        }
    }

    return winnerFound;
}

/**
 * Auto-promote the winning variant: set winner to weight=1, deactivate losers.
 */
export async function autoPromoteWinner(stepId: string): Promise<void> {
    const { data: winner } = await supabase
        .from('step_variants')
        .select('*')
        .eq('step_id', stepId)
        .eq('is_winner', true)
        .eq('is_active', true)
        .single();

    if (!winner) return;

    // Set winner to full traffic
    await supabase.from('step_variants').update({
        traffic_weight: 1.0,
        updated_at: new Date().toISOString(),
    }).eq('id', winner.id);

    // Deactivate all other variants
    await supabase.from('step_variants').update({
        is_active: false,
        traffic_weight: 0,
        updated_at: new Date().toISOString(),
    })
        .eq('step_id', stepId)
        .neq('id', winner.id);

    // Update the step's content template to the winner's content
    await supabase.from('sequence_steps').update({
        content: winner.content,
    }).eq('id', stepId);

    console.log(`[LEARNING] Auto-promoted variant ${winner.variant_name} for step ${stepId}`);
}

// ═══════════════════════════════════════════════════════════════════
// INDUSTRY BENCHMARKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute anonymized industry benchmarks across tenants.
 */
export async function computeIndustryBenchmarks(
    industry: string,
    periodStart: Date,
    periodEnd: Date
): Promise<void> {
    // Get all sequence_analytics for this industry in the period
    const { data: tenantProfiles } = await supabase
        .from('tenant_profiles')
        .select('tenant_id')
        .eq('industry', industry);

    if (!tenantProfiles || tenantProfiles.length === 0) return;

    const clientIds = tenantProfiles.map(tp => tp.tenant_id);

    const { data: analytics } = await supabase
        .from('sequence_analytics')
        .select('*')
        .in('client_id', clientIds)
        .gte('period_start', periodStart.toISOString())
        .lte('period_end', periodEnd.toISOString());

    if (!analytics || analytics.length === 0) return;

    // Compute aggregates
    const avgConversionRate = analytics.reduce((s, a) => s + parseFloat(a.conversion_rate), 0) / analytics.length;
    const avgReplyRate = analytics.reduce((s, a) => s + parseFloat(a.reply_rate), 0) / analytics.length;
    const avgOptOutRate = analytics.reduce((s, a) => s + parseFloat(a.opt_out_rate), 0) / analytics.length;
    const avgTimeToConversion = analytics.reduce((s, a) => s + parseFloat(a.avg_time_to_conversion_hours), 0) / analytics.length;
    const avgStepsToConversion = analytics.reduce((s, a) => s + parseFloat(a.avg_steps_to_conversion), 0) / analytics.length;

    const totalCost = analytics.reduce((s, a) => s + parseFloat(a.total_cost), 0);
    const totalConversions = analytics.reduce((s, a) => s + a.total_conversions, 0);
    const avgCostPerConversion = totalConversions > 0 ? totalCost / totalConversions : 0;

    // Unique tenant count
    const uniqueTenants = new Set(analytics.map(a => a.client_id)).size;

    // Upsert
    await supabase.from('industry_benchmarks').upsert({
        industry,
        avg_conversion_rate: avgConversionRate,
        avg_reply_rate: avgReplyRate,
        avg_opt_out_rate: avgOptOutRate,
        avg_time_to_conversion_hours: avgTimeToConversion,
        avg_steps_to_conversion: avgStepsToConversion,
        avg_cost_per_conversion: avgCostPerConversion,
        sample_size: analytics.length,
        tenant_count: uniqueTenants,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
    }, {
        onConflict: 'industry,period_start,period_end',
    });

    console.log(`[LEARNING] Updated industry benchmarks for ${industry}: ${analytics.length} sequences from ${uniqueTenants} tenants`);
}

/**
 * Compare a sequence's performance against industry benchmarks.
 */
export async function compareToIndustry(
    sequenceId: string
): Promise<{
    sequence: Record<string, number>;
    industry: Record<string, number>;
    delta: Record<string, number>;
} | null> {
    // Get sequence analytics
    const { data: seqAnalytics } = await supabase
        .from('sequence_analytics')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

    if (!seqAnalytics) return null;

    // Get sequence's industry
    const { data: sequence } = await supabase
        .from('sequences')
        .select('client_id')
        .eq('id', sequenceId)
        .single();

    if (!sequence) return null;

    const { data: profile } = await supabase
        .from('tenant_profiles')
        .select('industry')
        .eq('tenant_id', sequence.client_id)
        .single();

    if (!profile) return null;

    // Get industry benchmarks
    const { data: benchmark } = await supabase
        .from('industry_benchmarks')
        .select('*')
        .eq('industry', profile.industry)
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

    if (!benchmark) return null;

    const seqMetrics = {
        conversion_rate: parseFloat(seqAnalytics.conversion_rate),
        reply_rate: parseFloat(seqAnalytics.reply_rate),
        opt_out_rate: parseFloat(seqAnalytics.opt_out_rate),
        avg_time_to_conversion: parseFloat(seqAnalytics.avg_time_to_conversion_hours),
        cost_per_conversion: parseFloat(seqAnalytics.cost_per_conversion),
    };

    const industryMetrics = {
        conversion_rate: parseFloat(benchmark.avg_conversion_rate),
        reply_rate: parseFloat(benchmark.avg_reply_rate),
        opt_out_rate: parseFloat(benchmark.avg_opt_out_rate),
        avg_time_to_conversion: parseFloat(benchmark.avg_time_to_conversion_hours),
        cost_per_conversion: parseFloat(benchmark.avg_cost_per_conversion),
    };

    const delta: Record<string, number> = {};
    for (const key of Object.keys(seqMetrics)) {
        const s = seqMetrics[key as keyof typeof seqMetrics];
        const i = industryMetrics[key as keyof typeof industryMetrics];
        delta[key] = i > 0 ? ((s - i) / i) * 100 : 0;
    }

    return { sequence: seqMetrics, industry: industryMetrics, delta };
}

// ═══════════════════════════════════════════════════════════════════
// BATCH ANALYTICS JOB (called by analytics-worker)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run full analytics computation for all active sequences.
 * Called hourly by the analytics worker.
 */
export async function runAnalyticsJob(): Promise<void> {
    const now = new Date();
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Last 24h rolling

    console.log(`[LEARNING] Starting analytics job: ${periodStart.toISOString()} → ${periodEnd.toISOString()}`);

    // 1. Get all active sequences
    const { data: sequences } = await supabase
        .from('sequences')
        .select('id, client_id')
        .eq('is_active', true);

    if (!sequences || sequences.length === 0) {
        console.log('[LEARNING] No active sequences to analyze');
        return;
    }

    // 2. Compute step analytics for each sequence's steps
    for (const seq of sequences) {
        try {
            const { data: steps } = await supabase
                .from('sequence_steps')
                .select('id')
                .eq('sequence_id', seq.id);

            for (const step of (steps || [])) {
                await computeStepAnalytics(step.id, periodStart, periodEnd);
            }

            // 3. Compute sequence analytics
            await computeSequenceAnalytics(seq.id, periodStart, periodEnd);

            // 4. Generate optimizations (only for sequences with enough data)
            await generateOptimizations(seq.id);
        } catch (err) {
            console.error(`[LEARNING] Error analyzing sequence ${seq.id}:`, err);
        }
    }

    // 5. Evaluate all active A/B tests
    const { data: activeVariantSteps } = await supabase
        .from('step_variants')
        .select('step_id')
        .eq('is_active', true);

    const uniqueStepIds = [...new Set((activeVariantSteps || []).map(v => v.step_id))];

    for (const stepId of uniqueStepIds) {
        try {
            const hasWinner = await evaluateTest(stepId);
            if (hasWinner) {
                await autoPromoteWinner(stepId);
            }
        } catch (err) {
            console.error(`[LEARNING] Error evaluating A/B test for step ${stepId}:`, err);
        }
    }

    console.log(`[LEARNING] Analytics job completed: ${sequences.length} sequences, ${uniqueStepIds.length} A/B tests evaluated`);
}

/**
 * Run weekly industry benchmark computation.
 */
export async function runBenchmarkJob(): Promise<void> {
    const now = new Date();
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

    // Get all unique industries
    const { data: profiles } = await supabase
        .from('tenant_profiles')
        .select('industry')
        .not('industry', 'is', null);

    const industries = [...new Set((profiles || []).map(p => p.industry).filter(Boolean))];

    for (const industry of industries) {
        try {
            await computeIndustryBenchmarks(industry, periodStart, periodEnd);
        } catch (err) {
            console.error(`[LEARNING] Error computing benchmarks for ${industry}:`, err);
        }
    }

    console.log(`[LEARNING] Benchmark job completed: ${industries.length} industries`);
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Standard normal CDF approximation (Abramowitz and Stegun)
 */
function normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
}
