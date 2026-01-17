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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
        return { success: false, error: 'Unauthorized' };
    }

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
            created_by: session.user.id
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
        fetch(`${appUrl}/.netlify/functions/generate-artifact-background`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }).catch(err => console.error("Background trigger error (ignored):", err));
        
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function updateArtifactContentAction(artifactId: string, updates: { nombres?: string[], objetivos?: string[], descripcion?: any }) {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

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
