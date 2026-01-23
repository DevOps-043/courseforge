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

export async function startCurationAction(artifactId: string, attemptNumber: number = 1, gaps: string[] = []) {
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
            gaps
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

    // Fetch existing assets to merge
    const { data: component } = await supabase
        .from('material_components')
        .select('assets')
        .eq('id', componentId)
        .single();

    const currentAssets = component?.assets || {};
    const newAssets = { ...currentAssets, ...assets };

    const { error } = await supabase
        .from('material_components')
        .update({ assets: newAssets })
        .eq('id', componentId);

    if (error) return { success: false, error: error.message };

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
