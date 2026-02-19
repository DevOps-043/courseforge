'use server';

import { createClient } from '@/utils/supabase/server';

export async function generateArtifactAction(formData: {
    title: string;
    description: string;
    targetAudience: string;
    expectedResults: string;
    courseId?: string;
}) {
    const supabase = await createClient();

    // Auth Check & Get Session Token
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    try {
        console.log('Initiating background generation for:', formData.title);

        // Auto-generate course_id if missing
        let finalCourseId = formData.courseId?.trim();
        if (!finalCourseId) {
            // Generate ID: "WORD-XXXX"
            const prefix = formData.title.split(' ')[0].toUpperCase().substring(0, 10).replace(/[^A-Z0-9]/g, '');
            const random = Math.floor(1000 + Math.random() * 9000); // 4 digit random
            finalCourseId = `${prefix || 'COURSE'}-${random}`;
        }

        // 1. Create Placeholder Artifact
        // Initial State: GENERATING (as per Migration Guide)
        const { data: artifact, error } = await supabase.from('artifacts').insert({
            course_id: finalCourseId,
            idea_central: formData.title,
            nombres: [],
            objetivos: [],
            descripcion: {},
            generation_metadata: {
                original_input: formData,
                started_at: new Date().toISOString()
            },
            state: 'GENERATING',
            created_by: user.id
        }).select().single();

        if (error) {
            console.error('Database Insert Error:', error);
            throw new Error(`Database Error: ${error.message}`);
        }

        // 2. Trigger Netlify Background Function
        // Construct URL based on environment
        const baseUrl = process.env.URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/generate-artifact-background`;

        console.log(`Triggering background job at: ${backgroundFunctionUrl}`);

        // Fire request to background function
        // Note: Netlify Background Functions return 202 Accepted immediately.
        // We don't await the full processing, just the trigger.
        const triggerResponse = await fetch(backgroundFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                artifactId: artifact.id,
                formData: formData,
                userToken: session.access_token
            })
        });

        if (!triggerResponse.ok) {
            console.warn(`Background trigger might have failed: ${triggerResponse.status}`);
            // We still return success because the artifact is created, but log warning.
            // Client might retry or checking status will eventually fail/timeout.
        }

        return { success: true, artifactId: artifact.id, status: 'queued' };

    } catch (error: any) {
        console.error('Generation Action Error:', error);
        return { success: false, error: error.message || 'Error initating generation' };
    }
}

export async function regenerateArtifactAction(artifactId: string, feedback?: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    // 1. Get Original Input
    const { data: artifact } = await supabase.from('artifacts').select('generation_metadata').eq('id', artifactId).single();
    if (!artifact) return { success: false, error: 'Artifact not found' };

    const originalInput = artifact.generation_metadata?.original_input;
    if (!originalInput) return { success: false, error: 'Original input lost' };

    // 2. Reset Artifact
    const { error: resetError } = await supabase.from('artifacts').update({
        nombres: [],
        objetivos: [],
        descripcion: {},
        state: 'GENERATING',
        generation_metadata: {
            ...artifact.generation_metadata,
            feedback_history: [...(artifact.generation_metadata.feedback_history || []), { date: new Date(), feedback }],
            last_feedback: feedback
        }
    }).eq('id', artifactId);

    if (resetError) return { success: false, error: resetError.message };

    // 3. Trigger Background Job
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:8888';

    // We need to pass the same payload as create, but we reuse originalInput
    const payload = {
        artifactId,
        userToken: session.access_token,
        formData: originalInput,
        feedback // Pass feedback to influence generation if supported (currently just passing it for context if needed in future)
    };

    try {
        console.log('Triggering background regeneration...');

        // IMPORTANT: await is required in serverless to ensure the request completes before function terminates
        const triggerResponse = await fetch(`${appUrl}/.netlify/functions/generate-artifact-background`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!triggerResponse.ok) {
            console.warn(`Background regeneration trigger might have failed: ${triggerResponse.status}`);
        }

        return { success: true };
    } catch (e: any) {
        console.error("Background trigger error:", e);
        return { success: false, error: e.message };
    }
}

export async function updateArtifactContentAction(artifactId: string, updates: { nombres?: string[], objetivos?: string[], descripcion?: any }) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('artifacts')
        .update(updates)
        .eq('id', artifactId);

    if (error) return { success: false, error: error.message };

    return { success: true };
}

// NUEVA ACCIÓN para actualizar el estado del artefacto (ej: aprobar fase 1)
export async function updateArtifactStatusAction(artifactId: string, status: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('artifacts')
        .update({ state: status })
        .eq('id', artifactId);

    if (error) {
        console.error('Error updating artifact status:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

export async function generateInstructionalPlanAction(artifactId: string, customPrompt?: string, useCustomPrompt: boolean = false) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
    // Construct the URL ensuring we don't have double slashes if env var has trailing slash
    const baseUrl = appUrl.replace(/\/$/, '');
    const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/instructional-plan-background`;

    try {
        console.log('Triggering Instructional Plan generation...');
        console.log('URL:', backgroundFunctionUrl);

        // IMPORTANT: await is required in serverless to ensure the request completes before function terminates
        const triggerResponse = await fetch(backgroundFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                artifactId,
                userToken: session.access_token,
                customPrompt,
                useCustomPrompt
            }),
        });

        if (!triggerResponse.ok) {
            console.warn(`Background trigger might have failed: ${triggerResponse.status}`);
        }

        // Return immediately to letting UI show "Generating..." state
        return { success: true };
    } catch (e: any) {
        console.error("Background trigger error:", e);
        return { success: false, error: e.message };
    }
}

export async function validateInstructionalPlanAction(artifactId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
    const baseUrl = appUrl.replace(/\/$/, '');
    const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/validate-plan-background`;

    try {
        // 1. CLEAR previous validation to ensure fresh results
        // This prevents the UI from "flashing" old data during polling
        await supabase
            .from('instructional_plans')
            .update({ validation: null })
            .eq('artifact_id', artifactId);

        console.log('Triggering Instructional Plan Validation...');

        // 2. Trigger Background Job
        // IMPORTANT: await is required in serverless to ensure the request completes before function terminates
        const triggerResponse = await fetch(backgroundFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                artifactId,
                userToken: session.access_token,
            }),
        });

        if (!triggerResponse.ok) {
            console.warn(`Background validation trigger might have failed: ${triggerResponse.status}`);
        }

        return { success: true };
    } catch (e: any) {
        console.error("Background validation trigger error:", e);
        return { success: false, error: e.message };
    }
}

export async function updateInstructionalPlanStatusAction(artifactId: string, status: string, feedback?: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const updateData: any = { state: status };

    // Construct approvals JSON object to match existing schema
    const approvalData = {
        notes: feedback || '',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.email || 'user',
        architect_status: status === 'STEP_APPROVED' ? 'APPROVED' : 'REJECTED'
    };

    updateData.approvals = approvalData;

    const { error } = await supabase
        .from('instructional_plans')
        .update(updateData)
        .eq('artifact_id', artifactId);

    if (error) {
        console.error('Error updating instructional plan status:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

// NUEVA ACCIÓN para actualizar el contenido del plan instruccional (edición manual)
export async function updateInstructionalPlanContentAction(artifactId: string, lessonPlans: any[]) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('instructional_plans')
        .update({
            lesson_plans: lessonPlans,
            updated_at: new Date().toISOString()
        })
        .eq('artifact_id', artifactId);

    if (error) {
        console.error('Error updating instructional plan content:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

export async function deleteInstructionalPlanAction(artifactId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('instructional_plans')
        .delete()
        .eq('artifact_id', artifactId);

    if (error) {
        console.error('Error deleting instructional plan:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

// ==============================================================================
// CURATION ACTIONS (Step 4)
// ==============================================================================

export async function startCurationAction(artifactId: string, attemptNumber: number = 1, gaps: string[] = [], resume: boolean = false) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    try {
        // 1. Get Artifact Data
        const { data: artifact } = await supabase
            .from('artifacts')
            .select('idea_central, course_id') // course_id usually stores the name/code
            .eq('id', artifactId)
            .single();

        if (!artifact) throw new Error('Artifact not found');

        // 2. Get Instructional Plan (Source of components)
        const { data: plan, error: planError } = await supabase
            .from('instructional_plans')
            .select('lesson_plans') // Correct column name
            .eq('artifact_id', artifactId)
            .maybeSingle();

        if (planError) {
            console.error('[Actions] DB Error fetching plan:', planError);
            throw new Error(`Database error fetching plan: ${planError.message}`);
        }

        if (!plan) {
            console.error(`[Actions] Plan not found for artifact: ${artifactId}`);
            throw new Error('No Instructional Plan found. Please go back to Step 3 and generate/approve the plan first.');
        }

        if (!plan.lesson_plans || (Array.isArray(plan.lesson_plans) && plan.lesson_plans.length === 0)) {
            console.error(`[Actions] Plan has no lessons: ${artifactId}`);
            throw new Error('Instructional Plan is empty. Please regenerate the plan in Step 3.');
        }

        // 3. Extract Components from Plan
        // Map lesson_plans JSON to flat list of components
        const components: any[] = [];
        const lessons = (plan.lesson_plans as any[]);

        lessons.forEach((l: any) => {
            const lessonId = l.lesson_id || l.id || `L${Math.random().toString(36).substr(2, 5)}`;
            const lessonTitle = l.lesson_title || l.title || 'Untitled Lesson';

            if (Array.isArray(l.components)) {
                l.components.forEach((c: any) => {
                    const compType = typeof c === 'string' ? c : c.type || c.component || 'UNKNOWN';
                    // Check critical flag if exists
                    const isCritical = typeof c === 'object' && c.is_critical ? true : false;

                    components.push({
                        lesson_id: lessonId,
                        lesson_title: lessonTitle,
                        component: compType,
                        is_critical: isCritical
                    });
                });
            }
        });

        if (components.length === 0) throw new Error('No components found in the plan');

        // 4. Create or Update Curation Entry
        // Check if exists first to avoid duplicates or reset state
        const { data: existingCuration } = await supabase
            .from('curation')
            .select('id')
            .eq('artifact_id', artifactId)
            .maybeSingle();

        let curationId = existingCuration?.id;

        if (existingCuration) {
            // Update existing
            await supabase
                .from('curation')
                .update({
                    state: 'PHASE2_GENERATING',
                    attempt_number: attemptNumber,
                    updated_at: new Date().toISOString()
                })
                .eq('id', curationId);
        } else {
            // Create new
            const { data: newCuration, error: createError } = await supabase
                .from('curation')
                .insert({
                    artifact_id: artifactId,
                    state: 'PHASE2_GENERATING',
                    attempt_number: attemptNumber
                })
                .select('id')
                .single();

            if (createError) throw new Error(`Failed to create curation record: ${createError.message}`);
            curationId = newCuration.id;
        }

        // 5. Trigger Background Function
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
        const baseUrl = appUrl.replace(/\/$/, '');
        const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/curation-background`;

        console.log('[Actions] Triggering Curation Background:', backgroundFunctionUrl);

        // Fetch System Prompt Code if needed, but the Background function will handle the specific prompt building.
        // We pass the payload expected by curation-background.ts

        const payload = {
            curationId,
            artifactId,
            components,
            courseName: artifact.course_id || 'Untitled Course', // Using course_id as name proxy if titles are mixed
            ideaCentral: artifact.idea_central,
            accessToken: session.access_token,
            attemptNumber,
            gaps,
            resume // Pass resume flag
        };

        const triggerResponse = await fetch(backgroundFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!triggerResponse.ok) {
            console.warn(`[Actions] Curation trigger failed: ${triggerResponse.status}`);
        }

        return { success: true, curationId };

    } catch (error: any) {
        console.error('[Actions] Start Curation Error:', error);
        return { success: false, error: error.message };
    }
}

export async function updateCurationRowAction(rowId: string, updates: any) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    // Validate allowed fields to update
    const allowedUpdates: any = {};
    if (updates.apta !== undefined) allowedUpdates.apta = updates.apta;
    if (updates.cobertura_completa !== undefined) allowedUpdates.cobertura_completa = updates.cobertura_completa;
    if (updates.motivo_no_apta !== undefined) allowedUpdates.motivo_no_apta = updates.motivo_no_apta;
    if (updates.notes !== undefined) allowedUpdates.notes = updates.notes;

    const { error } = await supabase
        .from('curation_rows')
        .update(allowedUpdates)
        .eq('id', rowId);

    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function updateCurationStatusAction(artifactId: string, status: string, notes?: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    // Map generic step status to specific Phase 2 status if needed
    // The UI might send STEP_APPROVED, we map it to PHASE2_APPROVED
    let finalStatus = status;
    let decision = 'PENDING';

    if (status === 'STEP_APPROVED') {
        finalStatus = 'PHASE2_APPROVED';
        decision = 'APPROVED';
    } else if (status === 'STEP_REJECTED') {
        finalStatus = 'PHASE2_BLOCKED';
        decision = 'BLOCKED';
    } else if (status === 'PAUSED_REQUESTED') {
        finalStatus = 'PAUSED_REQUESTED';
    } else if (status === 'STOPPED_REQUESTED') {
        finalStatus = 'STOPPED_REQUESTED';
    }

    const updateData: any = { state: finalStatus };

    // Construct qa_decision JSON object (matching curation schema)
    const decisionData = {
        notes: notes || '',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.email || 'user',
        decision: decision
    };

    // Use qa_decision column instead of approvals
    updateData.qa_decision = decisionData;

    const { error } = await supabase
        .from('curation')
        .update(updateData)
        .eq('artifact_id', artifactId);

    if (error) {
        console.error('Error updating curation status:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

export async function deleteCurationAction(artifactId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('curation')
        .delete()
        .eq('artifact_id', artifactId);

    if (error) {
        console.error('Error deleting curation:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Import curation sources from a JSON payload (e.g. pasted from ChatGPT).
 * This is the manual alternative when GPT Actions fail.
 * Reuses the same insertion logic as /api/gpt/sources/route.ts
 */
export async function importCurationJsonAction(artifactId: string, jsonString: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'No autorizado' };

    try {
        // 1. Parse JSON
        let payload: any;
        try {
            payload = JSON.parse(jsonString);
        } catch {
            return { success: false, error: 'JSON inválido. Verifica el formato e intenta de nuevo.' };
        }

        // 2. Validate structure
        if (!payload.sources || !Array.isArray(payload.sources) || payload.sources.length === 0) {
            return { success: false, error: 'El JSON debe contener un array "sources" con al menos una fuente.' };
        }

        // Validate each source has required fields
        for (let i = 0; i < payload.sources.length; i++) {
            const src = payload.sources[i];
            if (!src.url || !src.title || !src.lesson_id) {
                return {
                    success: false,
                    error: `Fuente #${i + 1} incompleta: requiere al menos "url", "title" y "lesson_id".`
                };
            }
        }

        console.log(`[importCurationJson] Processing ${payload.sources.length} sources for artifact ${artifactId}`);

        // 3. Get or create curation record
        let curationId: string;
        const { data: existingCuration } = await supabase
            .from('curation')
            .select('id')
            .eq('artifact_id', artifactId)
            .maybeSingle();

        if (existingCuration) {
            curationId = existingCuration.id;

            // Clear existing GPT-generated rows (keep manual and automatic ones)
            const { error: deleteError } = await supabase
                .from('curation_rows')
                .delete()
                .eq('curation_id', curationId)
                .eq('source_rationale', 'GPT_GENERATED');

            if (deleteError) {
                console.warn('[importCurationJson] Could not clear old GPT rows:', deleteError);
            }
        } else {
            const { data: newCuration, error: createError } = await supabase
                .from('curation')
                .insert({
                    artifact_id: artifactId,
                    state: 'PHASE2_GENERATED',
                    attempt_number: 1
                })
                .select('id')
                .single();

            if (createError || !newCuration) {
                console.error('[importCurationJson] Failed to create curation:', createError);
                return { success: false, error: 'Error creando registro de curaduría.' };
            }
            curationId = newCuration.id;
        }

        // 4. Insert sources as curation_rows
        const rowsToInsert = payload.sources.map((source: any) => ({
            curation_id: curationId,
            lesson_id: source.lesson_id,
            lesson_title: source.lesson_title || '',
            component: (source.type || 'DOCUMENTATION').toUpperCase(),
            is_critical: false,
            source_ref: source.url,
            source_title: source.title,
            source_rationale: 'GPT_GENERATED',
            url_status: 'VALID',
            apta: source.validated ?? true,
            auto_evaluated: true,
            auto_reason: source.summary || 'Importado manualmente desde GPT'
        }));

        const { error: insertError } = await supabase
            .from('curation_rows')
            .insert(rowsToInsert);

        if (insertError) {
            console.error('[importCurationJson] Insert error:', insertError);
            return { success: false, error: `Error insertando fuentes: ${insertError.message}` };
        }

        // 5. Update curation state
        await supabase
            .from('curation')
            .update({
                state: 'PHASE2_GENERATED',
                updated_at: new Date().toISOString()
            })
            .eq('id', curationId);

        console.log(`[importCurationJson] Successfully saved ${payload.sources.length} sources`);

        return {
            success: true,
            message: `${payload.sources.length} fuentes importadas exitosamente.`,
            sourcesSaved: payload.sources.length
        };

    } catch (error: any) {
        console.error('[importCurationJson] Error:', error);
        return { success: false, error: error.message || 'Error interno del servidor' };
    }
}

// ==============================================================================
// STEP 6: VISUAL PRODUCTION ACTIONS
// ==============================================================================

export async function generateVideoPromptsAction(componentId: string, storyboard: any[]) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
    const baseUrl = appUrl.replace(/\/$/, '');
    const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/video-prompts-generation`;

    try {
        // Trigger Background Function - Note: Netlify functions might timeout if we await robust generation
        // But for prompts (text) it should be fast enough (< 10s)
        const response = await fetch(backgroundFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                componentId,
                storyboard,
                userToken: session.access_token
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to generate prompts');
        }

        return { success: true, prompts: data.prompts };

    } catch (error: any) {
        console.error('Error generating video prompts:', error);
        return { success: false, error: error.message };
    }
}

export async function saveMaterialAssetsAction(componentId: string, assets: any) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    // Fetch existing component data with hierarchy for ID generation
    const { data: component } = await supabase
        .from('material_components')
        .select(`
            assets, type, material_lesson_id,
            material_lessons (
                lesson_id, lesson_title, module_id,
                materials (
                    artifact_id,
                    artifacts ( course_id )
                )
            )
        `)
        .eq('id', componentId)
        .single();

    const currentAssets = component?.assets || {};
    const mergedAssets = { ...currentAssets, ...assets };

    // Auto-calculate DoD checklist based on merged assets
    const dodChecklist = {
        has_slides_url: !!mergedAssets.slides_url,
        has_video_url: !!mergedAssets.video_url,
        has_screencast_url: !!mergedAssets.screencast_url,
        has_b_roll_prompts: !!mergedAssets.b_roll_prompts,
        has_final_video_url: !!mergedAssets.final_video_url,
    };

    // Auto-calculate production status based on component type and assets
    const componentType = component?.type || '';
    let productionStatus = 'PENDING';

    // Determine required assets based on component type
    const needsSlides = componentType === 'VIDEO_THEORETICAL' || componentType === 'VIDEO_GUIDE';
    const needsScreencast = componentType === 'DEMO_GUIDE' || componentType === 'VIDEO_GUIDE';
    const needsVideo = componentType.includes('VIDEO');
    const needsFinalVideo = componentType.includes('VIDEO');

    // Calculate status - COMPLETED only when final video is set
    const hasRequiredSlides = !needsSlides || dodChecklist.has_slides_url;
    const hasRequiredScreencast = !needsScreencast || dodChecklist.has_screencast_url;
    const hasRequiredVideo = !needsVideo || dodChecklist.has_video_url;
    const hasRequiredFinalVideo = !needsFinalVideo || dodChecklist.has_final_video_url;

    if (hasRequiredSlides && hasRequiredScreencast && hasRequiredVideo && hasRequiredFinalVideo) {
        productionStatus = 'COMPLETED';
    } else if (dodChecklist.has_final_video_url) {
        // Has final video but missing some intermediate assets - still completed
        productionStatus = 'COMPLETED';
    } else if (dodChecklist.has_slides_url || dodChecklist.has_video_url || dodChecklist.has_screencast_url) {
        productionStatus = 'IN_PROGRESS';
    } else if (dodChecklist.has_b_roll_prompts) {
        productionStatus = 'IN_PROGRESS';
    }

    // Generate Composite ID if missing (gamma_deck_id)
    let gammaDeckId = mergedAssets.gamma_deck_id;
    if (!gammaDeckId && component?.material_lessons) {
        // Extract data for ID generation
        const lesson = component.material_lessons as any;
        const materials = lesson.materials as any;
        const artifact = materials?.artifacts as any;

        const courseId = artifact?.course_id || 'CRS';
        // Try to parse lesson number from title (e.g. "1.1 Intro") -> "1.1"
        const lessonNumMatch = lesson.lesson_title.match(/^(\d+(\.\d+)*)/);
        const lessonNum = lessonNumMatch ? lessonNumMatch[0] : 'L' + lesson.lesson_id.substring(0, 4);

        // Component Type Shortcut
        const typeMap: Record<string, string> = {
            'VIDEO_THEORETICAL': 'VTH',
            'VIDEO_GUIDE': 'VGD',
            'VIDEO_DEMO': 'VDM',
            'DEMO_GUIDE': 'DG',
            'QUIZ': 'QZ'
        };
        const typeCode = typeMap[componentType] || 'UNK';

        // Format: [COURSE]-[LESSON]-[TYPE]-[RANDOM_SUFFIX]
        // Example: COURSE-3030-1.2-VTH-X9Y
        const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
        gammaDeckId = `${courseId}-${lessonNum}-${typeCode}-${suffix}`;
    }

    // Build final assets object
    const finalAssets = {
        ...mergedAssets,
        gamma_deck_id: gammaDeckId,
        production_status: productionStatus,
        dod_checklist: dodChecklist,
        updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
        .from('material_components')
        .update({ assets: finalAssets })
        .eq('id', componentId);

    if (error) return { success: false, error: error.message };

    // Log pipeline event for status change
    if (component?.material_lesson_id) {
        // Fetch artifact_id through the chain
        const { data: lesson } = await supabase
            .from('material_lessons')
            .select('materials_id')
            .eq('id', component.material_lesson_id)
            .single();

        if (lesson?.materials_id) {
            const { data: materials } = await supabase
                .from('materials')
                .select('artifact_id')
                .eq('id', lesson.materials_id)
                .single();

            if (materials?.artifact_id) {
                await logPipelineEventAction(
                    materials.artifact_id,
                    productionStatus === 'COMPLETED' ? 'GO-OP-06_ASSET_COMPLETED' : 'GO-OP-06_ASSET_UPDATED',
                    {
                        component_id: componentId,
                        component_type: componentType,
                        production_status: productionStatus,
                        dod_checklist: dodChecklist,
                    },
                    'GO-OP-06',
                    componentId,
                    'material_component'
                );
            }
        }
    }

    return { success: true, productionStatus, dodChecklist };
}

// Registrar eventos de pipeline para trazabilidad
export async function logPipelineEventAction(
    artifactId: string,
    eventType: string,
    eventData: Record<string, any> = {},
    stepId?: string,
    entityId?: string,
    entityType?: string
) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('pipeline_events')
        .insert({
            artifact_id: artifactId,
            event_type: eventType,
            event_data: {
                ...eventData,
                triggered_by: user.email || user.id,
                timestamp: new Date().toISOString(),
            },
            step_id: stepId || null,
            entity_id: entityId || null,
            entity_type: entityType || null,
        });

    if (error) {
        console.error('Error logging pipeline event:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

export async function validateMaterialsAction(artifactId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
    const baseUrl = appUrl.replace(/\/$/, '');
    const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/validate-materials-background`;

    try {
        console.log('[Actions] Triggering Materials Validation...');

        const response = await fetch(backgroundFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artifactId,
                userToken: session.access_token
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Validation failed');
        }

        return { success: true, ...data };

    } catch (error: any) {
        console.error('Error validating materials:', error);
        return { success: false, error: error.message };
    }
}

export async function validateLessonAction(lessonId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    try {
        // Fetch lesson
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('*, materials_id')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            return { success: false, error: 'Lesson not found' };
        }

        // Fetch components
        const { data: components } = await supabase
            .from('material_components')
            .select('*')
            .eq('material_lesson_id', lessonId);

        // Simple inline validation
        const expectedTypes = lesson.expected_components || [];
        const generatedTypes = (components || []).map((c: any) => c.type);
        const missing = expectedTypes.filter((type: string) => !generatedTypes.includes(type));
        const errors: string[] = [];

        if (missing.length > 0) {
            errors.push(`Faltan componentes: ${missing.join(', ')}`);
        }

        // Quiz validation
        const quizComponent = (components || []).find((c: any) => c.type === 'QUIZ');
        if (expectedTypes.includes('QUIZ') && !quizComponent) {
            errors.push('Se esperaba QUIZ pero no fue generado');
        }

        const hasErrors = errors.length > 0;
        const newState = hasErrors ? 'NEEDS_FIX' : 'APPROVABLE';

        const dod = {
            control3_consistency: missing.length > 0 ? 'FAIL' : 'PASS',
            control4_sources: 'PASS',
            control5_quiz: quizComponent ? 'PASS' : (expectedTypes.includes('QUIZ') ? 'FAIL' : 'PASS'),
            errors,
        };

        // Update lesson
        await supabase
            .from('material_lessons')
            .update({
                dod,
                state: newState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        return { success: true, state: newState, dod };

    } catch (error: any) {
        console.error('Error validating lesson:', error);
        return { success: false, error: error.message };
    }
}

export async function regenerateLessonAction(lessonId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    try {
        // Fetch lesson
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('*, materials_id')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            return { success: false, error: 'Lesson not found' };
        }

        // Check max iterations
        if (lesson.iteration_count >= lesson.max_iterations) {
            return { success: false, error: 'Max iterations reached' };
        }

        // Update state to GENERATING
        await supabase
            .from('material_lessons')
            .update({
                state: 'GENERATING',
                iteration_count: lesson.iteration_count + 1,
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        // Trigger background job
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
        const baseUrl = appUrl.replace(/\/$/, '');

        await fetch(`${baseUrl}/.netlify/functions/materials-generation-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                materialsId: lesson.materials_id,
                lessonId: lessonId,
                iterationNumber: lesson.iteration_count + 1,
            })
        });

        return { success: true };

    } catch (error: any) {
        console.error('Error regenerating lesson:', error);
        return { success: false, error: error.message };
    }
}

export async function markLessonForFixAction(lessonId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    try {
        // Update lesson state to NEEDS_FIX
        const { error } = await supabase
            .from('material_lessons')
            .update({
                state: 'NEEDS_FIX',
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        if (error) throw error;

        return { success: true };

    } catch (error: any) {
        console.error('Error marking lesson for fix:', error);
        return { success: false, error: error.message };
    }
}

export async function updateProductionStatusAction(artifactId: string, isComplete: boolean) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { error } = await supabase
        .from('artifacts')
        .update({ production_complete: isComplete })
        .eq('id', artifactId);

    if (error) {
        console.error('Error updating production status:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

// NUEVA ACCIÓN para eliminar artefactos con limpieza de dependencias
export async function deleteArtifactAction(artifactId: string) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    try {
        console.log(`[deleteArtifactAction] Deleting artifact ${artifactId}...`);

        // 1. Delete dependent: Publication Requests (The reported error)
        const { error: pubError } = await supabase.from('publication_requests').delete().eq('artifact_id', artifactId);
        if (pubError) console.warn('Error deleting publication_requests:', pubError);

        // 2. Delete dependent: Pipeline Events
        const { error: pipeError } = await supabase.from('pipeline_events').delete().eq('artifact_id', artifactId);
        if (pipeError) console.warn('Error deleting pipeline_events:', pipeError);

        // 3. Delete dependent: Curation
        const { error: curError } = await supabase.from('curation').delete().eq('artifact_id', artifactId);
        if (curError) console.warn('Error deleting curation:', curError);

        // 4. Delete dependent: Instructional Plans
        const { error: planError } = await supabase.from('instructional_plans').delete().eq('artifact_id', artifactId);
        if (planError) console.warn('Error deleting instructional_plans:', planError);

        // 5. Delete dependent: Syllabus
        const { error: sylError } = await supabase.from('syllabus').delete().eq('artifact_id', artifactId);
        if (sylError) console.warn('Error deleting syllabus:', sylError);

        // 6. Delete dependent: Materials
        const { error: matError } = await supabase.from('materials').delete().eq('artifact_id', artifactId);
        if (matError) console.warn('Error deleting materials:', matError);

        // 7. Finally Delete Artifact
        const { error } = await supabase.from('artifacts').delete().eq('id', artifactId);

        if (error) {
            console.error('Error deleting artifact record:', error);
            throw new Error(error.message);
        }

        return { success: true };

    } catch (error: any) {
        console.error('Error in deleteArtifactAction:', error);
        return { success: false, error: error.message || "Error eliminando dependencias." };
    }
}
