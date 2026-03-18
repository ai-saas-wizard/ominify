/**
 * Pipeline Auto-Advance Utility
 *
 * Forward-only stage advancement for the sequencer worker.
 * Skips advancement if the contact was manually moved by a user.
 */

import { supabase } from './db.js';

/**
 * Auto-advance a contact's pipeline stage.
 * - Forward-only: never moves a contact backward
 * - Respects manual moves: if pipeline_stage_moved_by = 'user', skips
 * - Sets stage to target if contact has no stage yet
 */
export async function autoAdvancePipelineStage(
    contactId: string,
    clientId: string,
    targetStageName: string
): Promise<{ advanced: boolean; reason?: string }> {
    try {
        // Get contact's current stage info
        const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('pipeline_stage_id, pipeline_stage_moved_by')
            .eq('id', contactId)
            .single();

        if (contactError) {
            console.error('[PIPELINE] Error fetching contact:', contactError);
            return { advanced: false, reason: 'contact_fetch_error' };
        }

        // Skip if user manually moved the contact
        if (contact?.pipeline_stage_moved_by === 'user') {
            console.log(`[PIPELINE] Skipping auto-advance for ${contactId} — manually moved`);
            return { advanced: false, reason: 'manual_move' };
        }

        // Get all stages for this client
        const { data: stages, error: stagesError } = await supabase
            .from('pipeline_stages')
            .select('id, name, position, is_default')
            .eq('client_id', clientId)
            .order('position', { ascending: true });

        if (stagesError || !stages || stages.length === 0) {
            // No pipeline stages configured yet — skip silently
            return { advanced: false, reason: 'no_stages' };
        }

        const targetStage = stages.find((s) => s.name === targetStageName);
        if (!targetStage) {
            return { advanced: false, reason: 'stage_not_found' };
        }

        // If contact has no stage, always set it
        if (!contact?.pipeline_stage_id) {
            await setContactStage(contactId, targetStage.id);
            console.log(`[PIPELINE] ${contactId} → ${targetStageName} (first stage)`);
            return { advanced: true };
        }

        // Find current stage position
        const currentStage = stages.find((s) => s.id === contact.pipeline_stage_id);
        if (!currentStage) {
            // Current stage was deleted, set to target
            await setContactStage(contactId, targetStage.id);
            console.log(`[PIPELINE] ${contactId} → ${targetStageName} (stage was deleted)`);
            return { advanced: true };
        }

        // Only advance forward
        if (targetStage.position > currentStage.position) {
            await setContactStage(contactId, targetStage.id);
            console.log(`[PIPELINE] ${contactId} → ${targetStageName} (advanced from ${currentStage.name})`);
            return { advanced: true };
        }

        return { advanced: false, reason: 'already_ahead' };
    } catch (error) {
        console.error('[PIPELINE] Auto-advance error:', error);
        return { advanced: false, reason: 'error' };
    }
}

async function setContactStage(contactId: string, stageId: string): Promise<void> {
    await supabase
        .from('contacts')
        .update({
            pipeline_stage_id: stageId,
            pipeline_stage_moved_at: new Date().toISOString(),
            pipeline_stage_moved_by: 'auto',
        })
        .eq('id', contactId);
}
