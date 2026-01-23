'use client';

import { useState, useEffect, useCallback } from 'react';
import { materialsService } from '../services/materials.service';
import {
    MaterialsPayload,
    MaterialLesson,
    MaterialComponent,
    Esp05StepState,
} from '../types/materials.types';

interface UseMaterialsReturn {
    // Data
    materials: MaterialsPayload | null;
    loading: boolean;
    error: string | null;

    // Actions
    startGeneration: () => Promise<void>;
    runFixIteration: (lessonId: string, fixInstructions: string) => Promise<void>;
    submitToQA: () => Promise<void>;
    applyQADecision: (decision: 'APPROVED' | 'REJECTED', notes?: string) => Promise<void>;
    validateMaterials: () => Promise<void>;
    refresh: () => Promise<void>;

    // Helpers
    getLessonComponents: (lessonId: string) => Promise<MaterialComponent[]>;
    isGenerating: boolean;
    isValidating: boolean;
    isReadyForQA: boolean;
    isApproved: boolean;
}

export function useMaterials(artifactId: string): UseMaterialsReturn {
    const [materials, setMaterials] = useState<MaterialsPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Cargar materiales
    const loadMaterials = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await materialsService.getMaterialsByArtifactId(artifactId);
            setMaterials(data);
        } catch (err) {
            console.error('Error loading materials:', err);
            setError('Error al cargar materiales');
        } finally {
            setLoading(false);
        }
    }, [artifactId]);

    // Cargar al montar y suscribirse a cambios
    useEffect(() => {
        loadMaterials();
    }, [loadMaterials]);

    // Suscripción en tiempo real
    useEffect(() => {
        if (!materials?.id) return;

        const subscription = materialsService.subscribeToMaterials(
            materials.id,
            () => {
                // Refrescar cuando hay cambios
                loadMaterials();
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, [materials?.id, loadMaterials]);

    // === ACTIONS ===

    const startGeneration = useCallback(async () => {
        try {
            setError(null);
            const result = await materialsService.startMaterialsGeneration(artifactId);
            if (!result.success) {
                setError(result.error || 'Error al iniciar generación');
                return;
            }
            // La suscripción actualizará automáticamente
        } catch (err) {
            console.error('Error starting generation:', err);
            setError('Error al iniciar generación');
        }
    }, [artifactId]);

    const runFixIteration = useCallback(async (lessonId: string, fixInstructions: string) => {
        try {
            setError(null);
            const result = await materialsService.runFixIteration(lessonId, fixInstructions);
            if (!result.success) {
                setError(result.error || 'Error en iteración dirigida');
                return;
            }
        } catch (err) {
            console.error('Error running fix iteration:', err);
            setError('Error en iteración dirigida');
        }
    }, []);

    const submitToQA = useCallback(async () => {
        if (!materials?.id) {
            setError('No hay materiales para enviar');
            return;
        }

        try {
            setError(null);
            const result = await materialsService.submitToQA(materials.id);
            if (!result.success) {
                setError(result.error || 'Error al enviar a QA');
                return;
            }
        } catch (err) {
            console.error('Error submitting to QA:', err);
            setError('Error al enviar a QA');
        }
    }, [materials?.id]);

    const applyQADecision = useCallback(async (decision: 'APPROVED' | 'REJECTED', notes?: string) => {
        if (!materials?.id) {
            setError('No hay materiales para evaluar');
            return;
        }

        try {
            setError(null);
            const result = await materialsService.applyQADecision(materials.id, decision, notes);
            if (!result.success) {
                setError(result.error || 'Error al aplicar decisión');
                return;
            }
        } catch (err) {
            console.error('Error applying QA decision:', err);
            setError('Error al aplicar decisión');
        }
    }, [materials?.id]);

    const validateMaterials = useCallback(async () => {
        if (!materials?.artifact_id) {
            setError('No hay artefacto para validar');
            return;
        }

        try {
            setError(null);
            // Call the validation action
            const response = await fetch('/.netlify/functions/validate-materials-background', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artifactId: materials.artifact_id }),
            });

            if (!response.ok) {
                throw new Error('Error en validación');
            }

            // Refresh to get updated states
            await loadMaterials();
        } catch (err) {
            console.error('Error validating materials:', err);
            setError('Error al validar materiales');
        }
    }, [materials?.artifact_id, loadMaterials]);

    const getLessonComponents = useCallback(async (lessonId: string): Promise<MaterialComponent[]> => {
        return materialsService.getLessonComponents(lessonId);
    }, []);

    // === HELPERS ===

    const isGenerating = materials?.state === 'PHASE3_GENERATING' ||
        materials?.lessons.some((l) => l.state === 'GENERATING');

    const isReadyForQA = materials?.state === 'PHASE3_READY_FOR_QA';

    const isApproved = materials?.state === 'PHASE3_APPROVED';

    const isValidating = materials?.state === 'PHASE3_VALIDATING';

    return {
        materials,
        loading,
        error,
        startGeneration,
        runFixIteration,
        submitToQA,
        applyQADecision,
        validateMaterials,
        refresh: loadMaterials,
        getLessonComponents,
        isGenerating: isGenerating || false,
        isValidating,
        isReadyForQA,
        isApproved,
    };
}

/**
 * Hook para obtener el estado label y color
 */
export function useMaterialStateStyles(state: Esp05StepState | undefined) {
    const getStateLabel = (state: Esp05StepState | undefined): string => {
        const labels: Record<Esp05StepState, string> = {
            PHASE3_DRAFT: 'Borrador',
            PHASE3_GENERATING: 'Generando...',
            PHASE3_VALIDATING: 'Validando...',
            PHASE3_NEEDS_FIX: 'Requiere correcciones',
            PHASE3_READY_FOR_QA: 'Listo para QA',
            PHASE3_APPROVED: 'Aprobado',
            PHASE3_REJECTED: 'Rechazado',
            PHASE3_ESCALATED: 'Escalado',
        };
        return labels[state || 'PHASE3_DRAFT'] || state || 'Desconocido';
    };

    const getStateColor = (state: Esp05StepState | undefined): string => {
        const colors: Record<Esp05StepState, string> = {
            PHASE3_DRAFT: 'bg-gray-100 text-gray-800',
            PHASE3_GENERATING: 'bg-blue-100 text-blue-800',
            PHASE3_VALIDATING: 'bg-yellow-100 text-yellow-800',
            PHASE3_NEEDS_FIX: 'bg-orange-100 text-orange-800',
            PHASE3_READY_FOR_QA: 'bg-purple-100 text-purple-800',
            PHASE3_APPROVED: 'bg-green-100 text-green-800',
            PHASE3_REJECTED: 'bg-red-100 text-red-800',
            PHASE3_ESCALATED: 'bg-red-200 text-red-900',
        };
        return colors[state || 'PHASE3_DRAFT'] || 'bg-gray-100 text-gray-800';
    };

    return {
        label: getStateLabel(state),
        color: getStateColor(state),
        getStateLabel,
        getStateColor,
    };
}
