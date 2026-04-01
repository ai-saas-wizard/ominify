"use server";

import { supabase } from "@/lib/supabase";

export async function getPipelineAnalytics(pipelineId: string, daysBack: number = 30) {
    try {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - daysBack);
        const since = sinceDate.toISOString();

        // Get stages
        const { data: stages } = await supabase
            .from("pipeline_stages")
            .select("id, name, color, position, is_terminal")
            .eq("pipeline_id", pipelineId)
            .order("position", { ascending: true });

        if (!stages || stages.length === 0) {
            return { success: true, data: { stages: [], funnel: [], durations: [], velocity: [], sources: [] } };
        }

        // Get pipeline_contacts with current stage
        const { data: pipelineContacts } = await supabase
            .from("pipeline_contacts")
            .select("id, stage_id, contact_id, created_at")
            .eq("pipeline_id", pipelineId);

        // ─── Conversion Funnel ──────────────────────────────────
        const stageCountMap: Record<string, number> = {};
        for (const pc of pipelineContacts || []) {
            if (pc.stage_id) {
                stageCountMap[pc.stage_id] = (stageCountMap[pc.stage_id] || 0) + 1;
            }
        }

        const funnel = stages.map((stage: any, i: number) => {
            const count = stageCountMap[stage.id] || 0;
            const prevCount = i > 0 ? stageCountMap[stages[i - 1].id] || 0 : count;
            const dropOff = prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0;
            return {
                stageId: stage.id,
                stageName: stage.name,
                color: stage.color,
                count,
                dropOffPercent: i === 0 ? 0 : dropOff,
            };
        });

        // ─── Stage Durations ────────────────────────────────────
        const pcIds = (pipelineContacts || []).map((pc: any) => pc.id);
        let durations: { stageName: string; color: string; avgHours: number }[] = [];

        if (pcIds.length > 0) {
            const { data: history } = await supabase
                .from("pipeline_contact_history")
                .select("pipeline_contact_id, from_stage_id, to_stage_id, moved_at")
                .in("pipeline_contact_id", pcIds)
                .order("moved_at", { ascending: true });

            if (history && history.length > 1) {
                // Calculate time between consecutive moves for each pipeline_contact
                const durationsByStage: Record<string, number[]> = {};
                const grouped: Record<string, any[]> = {};

                for (const h of history) {
                    if (!grouped[h.pipeline_contact_id]) grouped[h.pipeline_contact_id] = [];
                    grouped[h.pipeline_contact_id].push(h);
                }

                for (const moves of Object.values(grouped)) {
                    for (let i = 0; i < moves.length - 1; i++) {
                        const stageId = moves[i].to_stage_id;
                        const enterTime = new Date(moves[i].moved_at).getTime();
                        const exitTime = new Date(moves[i + 1].moved_at).getTime();
                        const hours = (exitTime - enterTime) / (1000 * 60 * 60);
                        if (hours > 0 && hours < 8760) { // Cap at 1 year
                            if (!durationsByStage[stageId]) durationsByStage[stageId] = [];
                            durationsByStage[stageId].push(hours);
                        }
                    }
                }

                durations = stages.map((stage: any) => {
                    const times = durationsByStage[stage.id] || [];
                    const avg = times.length > 0
                        ? times.reduce((a: number, b: number) => a + b, 0) / times.length
                        : 0;
                    return {
                        stageName: stage.name,
                        color: stage.color,
                        avgHours: Math.round(avg * 10) / 10,
                    };
                });
            }
        }

        // ─── Pipeline Velocity (contacts entering per week) ─────
        const velocity: { week: string; entered: number; exited: number }[] = [];
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();

        for (let w = 0; w < 4; w++) {
            const weekStart = new Date(now - (w + 1) * weekMs);
            const weekEnd = new Date(now - w * weekMs);
            const entered = (pipelineContacts || []).filter((pc: any) => {
                const created = new Date(pc.created_at).getTime();
                return created >= weekStart.getTime() && created < weekEnd.getTime();
            }).length;

            velocity.unshift({
                week: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                entered,
                exited: 0, // Would need history to compute accurately
            });
        }

        // ─── Source Breakdown ────────────────────────────────────
        const contactIds = (pipelineContacts || []).map((pc: any) => pc.contact_id);
        let sources: { source: string; count: number }[] = [];

        if (contactIds.length > 0) {
            const { data: enrollments } = await supabase
                .from("sequence_enrollments")
                .select("contact_id, enrollment_source")
                .in("contact_id", contactIds);

            const sourceMap: Record<string, number> = {};
            for (const e of enrollments || []) {
                const src = e.enrollment_source || "unknown";
                sourceMap[src] = (sourceMap[src] || 0) + 1;
            }

            sources = Object.entries(sourceMap)
                .map(([source, count]) => ({ source, count }))
                .sort((a, b) => b.count - a.count);
        }

        return {
            success: true,
            data: {
                stages: stages.map((s: any) => ({ id: s.id, name: s.name, color: s.color })),
                funnel,
                durations,
                velocity,
                sources,
                totalContacts: (pipelineContacts || []).length,
            },
        };
    } catch (error: any) {
        console.error("getPipelineAnalytics error:", error);
        return { success: false, error: error?.message || "Internal error" };
    }
}
