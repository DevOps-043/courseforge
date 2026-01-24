import { createClient } from '@/utils/supabase/client';
import {
    MaterialsPayload,
    MaterialLesson,
    MaterialComponent,
    MaterialBlocker,
    Esp05StepState,
    LessonMaterialState,
    LessonDod,
    QADecision,
} from '../types/materials.types';
import { runAllValidations } from '../validators/materials.validators';

export const materialsService = {
    /**
     * Obtiene el registro de materiales para un artefacto
     */
    async getMaterialsByArtifactId(artifactId: string): Promise<MaterialsPayload | null> {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('materials')
            .select('*')
            .eq('artifact_id', artifactId)
            .maybeSingle();

        if (error) {
            console.error('Error fetching materials:', error);
            return null;
        }

        if (!data) return null;

        // Obtener las lecciones asociadas
        const lessons = await this.getMaterialLessons(data.id);

        return {
            ...data,
            lessons,
            global_blockers: data.global_blockers || [],
            dod: data.dod || { checklist: [], automatic_checks: [] },
            qa_decision: data.qa_decision,
            package: data.package,
        } as MaterialsPayload;
    },

    /**
     * Obtiene las lecciones de un registro de materiales
     */
    async getMaterialLessons(materialsId: string): Promise<MaterialLesson[]> {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('material_lessons')
            .select('*')
            .eq('materials_id', materialsId)
            .order('module_id', { ascending: true })
            .order('lesson_id', { ascending: true });

        if (error) {
            console.error('Error fetching material lessons:', error);
            return [];
        }

        return data as MaterialLesson[];
    },

    /**
     * Obtiene los componentes de una lección
     */
    async getLessonComponents(lessonId: string): Promise<MaterialComponent[]> {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('material_components')
            .select('*')
            .eq('material_lesson_id', lessonId)
            .order('iteration_number', { ascending: false });

        if (error) {
            console.error('Error fetching lesson components:', error);
            return [];
        }

        // Deduplicate by type, keeping the latest iteration (since we ordered by iteration DESC)
        const components = data as MaterialComponent[];
        const uniqueComponents = new Map<string, MaterialComponent>();
        
        for (const comp of components) {
            if (!uniqueComponents.has(comp.type)) {
                uniqueComponents.set(comp.type, comp);
            }
        }

        // Return sorted by type order usually, or just values. 
        // Let's sort them alphabetically or by some standard order if needed, 
        // but for now values() is fine, maybe sort by type for consistency.
        return Array.from(uniqueComponents.values()).sort((a, b) => a.type.localeCompare(b.type));
    },

    /**
     * Inicia la generación de materiales para un artefacto
     * Crea el registro en 'materials' y dispara el background job
     */
    async startMaterialsGeneration(artifactId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = createClient();

        // Verificar que no existe ya un registro de materiales
        const existing = await this.getMaterialsByArtifactId(artifactId);
        if (existing) {
            // Si existe pero está en DRAFT o NEEDS_FIX, permitir re-generar
            if (!['PHASE3_DRAFT', 'PHASE3_NEEDS_FIX'].includes(existing.state)) {
                return { success: false, error: 'Ya existe un proceso de materiales en curso' };
            }
        }

        // Crear o actualizar registro de materiales
        const { data: materials, error: materialsError } = await supabase
            .from('materials')
            .upsert({
                artifact_id: artifactId,
                state: 'PHASE3_GENERATING' as Esp05StepState,
                prompt_version: 'prompt05',
                version: existing ? existing.version + 1 : 1,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'artifact_id' })
            .select()
            .single();

        if (materialsError) {
            console.error('Error creating materials record:', materialsError);
            return { success: false, error: materialsError.message };
        }

        // Disparar el background job de Netlify
        try {
            const response = await fetch('/.netlify/functions/materials-generation-background', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artifactId, materialsId: materials.id }),
            });

            if (!response.ok) {
                throw new Error(`Background job failed: ${response.status}`);
            }

            return { success: true };
        } catch (error) {
            console.error('Error triggering background job:', error);

            // Revertir estado si falla
            await supabase
                .from('materials')
                .update({ state: 'PHASE3_DRAFT' as Esp05StepState })
                .eq('id', materials.id);

            return { success: false, error: 'Error al iniciar generación' };
        }
    },

    /**
     * Ejecuta las validaciones DoD para una lección
     */
    async runValidations(
        lessonId: string,
        aptaSourceIds: string[],
        nonAptaSourceIds: string[]
    ): Promise<LessonDod> {
        const supabase = createClient();

        // Obtener lección
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('*')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            console.error('Error fetching lesson:', lessonError);
            return {
                control3_consistency: 'FAIL',
                control4_sources: 'FAIL',
                control5_quiz: 'FAIL',
                errors: ['No se pudo obtener la lección'],
            };
        }

        // Obtener componentes
        const components = await this.getLessonComponents(lessonId);

        // Ejecutar validaciones
        const { dod, checks } = runAllValidations(
            lesson as MaterialLesson,
            components,
            aptaSourceIds,
            nonAptaSourceIds
        );

        // Actualizar DoD en la lección
        const newState: LessonMaterialState =
            dod.errors.length === 0 ? 'APPROVABLE' : 'NEEDS_FIX';

        await supabase
            .from('material_lessons')
            .update({
                dod,
                state: newState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        return dod;
    },

    /**
     * Ejecuta iteración dirigida (fix mode) para una lección
     */
    async runFixIteration(
        lessonId: string,
        fixInstructions: string
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = createClient();

        // Obtener lección
        const { data: lesson, error: lessonError } = await supabase
            .from('material_lessons')
            .select('*, materials_id')
            .eq('id', lessonId)
            .single();

        if (lessonError || !lesson) {
            return { success: false, error: 'Lección no encontrada' };
        }

        // Verificar que no exceda máximo de iteraciones
        if (lesson.iteration_count >= lesson.max_iterations) {
            return { success: false, error: `Máximo de iteraciones alcanzado (${lesson.max_iterations})` };
        }

        // Actualizar estado a GENERATING
        await supabase
            .from('material_lessons')
            .update({
                state: 'GENERATING' as LessonMaterialState,
                iteration_count: lesson.iteration_count + 1,
                updated_at: new Date().toISOString(),
            })
            .eq('id', lessonId);

        // Disparar background job para esta lección específica
        try {
            const response = await fetch('/.netlify/functions/materials-generation-background', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    artifactId: null, // No es necesario para iteración de lección
                    materialsId: lesson.materials_id,
                    lessonId,
                    fixInstructions,
                    iterationNumber: lesson.iteration_count + 1,
                }),
            });

            if (!response.ok) {
                throw new Error(`Background job failed: ${response.status}`);
            }

            return { success: true };
        } catch (error) {
            console.error('Error triggering fix iteration:', error);
            return { success: false, error: 'Error al iniciar iteración' };
        }
    },

    /**
     * Envía los materiales a QA
     */
    async submitToQA(materialsId: string): Promise<{ success: boolean; error?: string }> {
        const supabase = createClient();

        // Verificar que todas las lecciones están en APPROVABLE
        const lessons = await this.getMaterialLessons(materialsId);
        const notApprovable = lessons.filter((l) => l.state !== 'APPROVABLE');

        if (notApprovable.length > 0) {
            return {
                success: false,
                error: `${notApprovable.length} lecciones no están listas para QA`,
            };
        }

        // Actualizar estado
        const { error } = await supabase
            .from('materials')
            .update({
                state: 'PHASE3_READY_FOR_QA' as Esp05StepState,
                updated_at: new Date().toISOString(),
            })
            .eq('id', materialsId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    },

    /**
     * Aplica la decisión de QA
     */
    async applyQADecision(
        materialsId: string,
        decision: 'APPROVED' | 'REJECTED',
        notes?: string,
        reviewedBy?: string
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = createClient();

        const qaDecision: QADecision = {
            decision,
            notes,
            reviewed_by: reviewedBy,
            reviewed_at: new Date().toISOString(),
        };

        const newState: Esp05StepState =
            decision === 'APPROVED' ? 'PHASE3_APPROVED' : 'PHASE3_REJECTED';

        const { error } = await supabase
            .from('materials')
            .update({
                state: newState,
                qa_decision: qaDecision,
                updated_at: new Date().toISOString(),
            })
            .eq('id', materialsId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    },

    /**
     * Crea un bloqueador
     */
    async addBlocker(
        materialsId: string,
        blocker: Omit<MaterialBlocker, 'id' | 'created_at'>
    ): Promise<{ success: boolean; error?: string }> {
        const supabase = createClient();

        // Obtener bloqueadores actuales
        const { data: materials, error: fetchError } = await supabase
            .from('materials')
            .select('global_blockers')
            .eq('id', materialsId)
            .single();

        if (fetchError) {
            return { success: false, error: fetchError.message };
        }

        const currentBlockers = materials?.global_blockers || [];
        const newBlocker: MaterialBlocker = {
            ...blocker,
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
        };

        const { error } = await supabase
            .from('materials')
            .update({
                global_blockers: [...currentBlockers, newBlocker],
                updated_at: new Date().toISOString(),
            })
            .eq('id', materialsId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    },

    /**
     * Suscripción en tiempo real a cambios en materials y material_lessons
     */
    subscribeToMaterials(materialsId: string, callback: () => void) {
        const supabase = createClient();

        // Canal para materials
        const materialsChannel = supabase
            .channel(`materials:${materialsId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'materials',
                    filter: `id=eq.${materialsId}`,
                },
                () => callback()
            )
            .subscribe();

        // Canal para material_lessons
        const lessonsChannel = supabase
            .channel(`material_lessons:${materialsId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'material_lessons',
                    filter: `materials_id=eq.${materialsId}`,
                },
                () => callback()
            )
            .subscribe();

        return {
            unsubscribe: () => {
                supabase.removeChannel(materialsChannel);
                supabase.removeChannel(lessonsChannel);
            },
        };
    },
};
