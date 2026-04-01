'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePolling } from '@/shared/hooks/usePolling';
import { materialsService } from '../services/materials.service';
import {
  MaterialsPayload,
  MaterialComponent,
  Esp05StepState,
} from '../types/materials.types';

interface UseMaterialsReturn {
  materials: MaterialsPayload | null;
  loading: boolean;
  error: string | null;
  startGeneration: () => Promise<void>;
  runFixIteration: (lessonId: string, fixInstructions: string, componentTypes?: string[]) => Promise<void>;
  validateLesson: (lessonId: string) => Promise<void>;
  markLessonForFix: (lessonId: string) => Promise<void>;
  submitToQA: () => Promise<void>;
  applyQADecision: (
    decision: 'APPROVED' | 'REJECTED',
    notes?: string,
  ) => Promise<void>;
  validateMaterials: () => Promise<void>;
  forceResetGeneration: () => Promise<void>;
  refresh: () => Promise<void>;
  getLessonComponents: (lessonId: string) => Promise<MaterialComponent[]>;
  isGenerating: boolean;
  isValidating: boolean;
  isReadyForQA: boolean;
  isApproved: boolean;
  generationStuckInfo: { isStuck: boolean; minutesElapsed: number } | null;
}

function getGenerationStuckInfo(
  materials: Pick<MaterialsPayload, 'state' | 'updated_at'> | null,
) {
  if (!materials?.updated_at || materials.state !== 'PHASE3_GENERATING') {
    return null;
  }

  const updatedAt = new Date(materials.updated_at).getTime();
  const minutesElapsed = Math.floor((Date.now() - updatedAt) / 60000);

  return {
    isStuck: minutesElapsed >= 30,
    minutesElapsed,
  };
}

export function useMaterials(artifactId: string): UseMaterialsReturn {
  const [materials, setMaterials] = useState<MaterialsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generationStuckInfo, setGenerationStuckInfo] = useState<{
    isStuck: boolean;
    minutesElapsed: number;
  } | null>(null);

  const loadMaterials = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await materialsService.getMaterialsByArtifactId(artifactId);
      setMaterials(data);
      setGenerationStuckInfo(getGenerationStuckInfo(data));
    } catch (err) {
      console.error('Error loading materials:', err);
      setError('Error al cargar materiales');
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    if (!materials?.id) return;

    const subscription = materialsService.subscribeToMaterials(materials.id, () => {
      loadMaterials();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [materials?.id, loadMaterials]);

  const isGenerating =
    materials?.state === 'PHASE3_GENERATING' ||
    Boolean(materials?.lessons?.some((lesson) => lesson.state === 'GENERATING'));

  usePolling(loadMaterials, isGenerating, { intervalMs: 8000 });

  const startGeneration = useCallback(async () => {
    try {
      setError(null);
      const result = await materialsService.startMaterialsGeneration(artifactId);
      if (!result.success) {
        setError(result.error || 'Error al iniciar generacion');
        return;
      }

      await loadMaterials();
    } catch (err) {
      console.error('Error starting generation:', err);
      setError('Error al iniciar generacion');
    }
  }, [artifactId, loadMaterials]);

  const runFixIteration = useCallback(
    async (lessonId: string, fixInstructions: string, componentTypes?: string[]) => {
      try {
        setError(null);
        const result = await materialsService.runFixIteration(
          lessonId,
          fixInstructions,
          componentTypes,
        );
        if (!result.success) {
          setError(result.error || 'Error en iteracion dirigida');
          return;
        }
      } catch (err) {
        console.error('Error running fix iteration:', err);
        setError('Error en iteracion dirigida');
      }
    },
    [],
  );

  const validateLesson = useCallback(
    async (lessonId: string) => {
      try {
        setError(null);
        const result = await materialsService.validateLesson(lessonId);
        if (!result.success) {
          setError(result.error || 'Error al validar la leccion');
          return;
        }

        await loadMaterials();
      } catch (err) {
        console.error('Error validating lesson:', err);
        setError('Error al validar la leccion');
      }
    },
    [loadMaterials],
  );

  const markLessonForFix = useCallback(
    async (lessonId: string) => {
      try {
        setError(null);
        const result = await materialsService.markLessonForFix(lessonId);
        if (!result.success) {
          setError(result.error || 'Error al marcar la leccion para correccion');
          return;
        }

        await loadMaterials();
      } catch (err) {
        console.error('Error marking lesson for fix:', err);
        setError('Error al marcar la leccion para correccion');
      }
    },
    [loadMaterials],
  );

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

  const applyQADecision = useCallback(
    async (decision: 'APPROVED' | 'REJECTED', notes?: string) => {
      if (!materials?.id) {
        setError('No hay materiales para evaluar');
        return;
      }

      try {
        setError(null);
        const result = await materialsService.applyQADecision(
          materials.id,
          decision,
          notes,
        );
        if (!result.success) {
          setError(result.error || 'Error al aplicar decision');
          return;
        }
      } catch (err) {
        console.error('Error applying QA decision:', err);
        setError('Error al aplicar decision');
      }
    },
    [materials?.id],
  );

  const validateMaterials = useCallback(async () => {
    if (!materials?.artifact_id) {
      setError('No hay artefacto para validar');
      return;
    }

    try {
      setError(null);
      const result = await materialsService.validateMaterials(
        materials.artifact_id,
      );
      if (!result.success) {
        setError(result.error || 'Error al validar materiales');
        return;
      }

      await loadMaterials();
    } catch (err) {
      console.error('Error validating materials:', err);
      setError('Error al validar materiales');
    }
  }, [materials?.artifact_id, loadMaterials]);

  const forceResetGeneration = useCallback(async () => {
    try {
      setError(null);
      const result = await materialsService.forceResetGeneration(artifactId);
      if (!result.success) {
        setError(result.error || 'Error al resetear generacion');
        return;
      }

      setGenerationStuckInfo(null);
      await loadMaterials();
    } catch (err) {
      console.error('Error forcing reset:', err);
      setError('Error al resetear generacion');
    }
  }, [artifactId, loadMaterials]);

  const getLessonComponents = useCallback(async (lessonId: string) => {
    return materialsService.getLessonComponents(lessonId);
  }, []);

  return {
    materials,
    loading,
    error,
    startGeneration,
    runFixIteration,
    validateLesson,
    markLessonForFix,
    submitToQA,
    applyQADecision,
    validateMaterials,
    forceResetGeneration,
    refresh: loadMaterials,
    getLessonComponents,
    isGenerating: isGenerating || false,
    isValidating: materials?.state === 'PHASE3_VALIDATING',
    isReadyForQA: materials?.state === 'PHASE3_READY_FOR_QA',
    isApproved: materials?.state === 'PHASE3_APPROVED',
    generationStuckInfo,
  };
}

export function useMaterialStateStyles(state: Esp05StepState | undefined) {
  const getStateLabel = (currentState: Esp05StepState | undefined): string => {
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
    return labels[currentState || 'PHASE3_DRAFT'] || currentState || 'Desconocido';
  };

  const getStateColor = (currentState: Esp05StepState | undefined): string => {
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
    return colors[currentState || 'PHASE3_DRAFT'] || 'bg-gray-100 text-gray-800';
  };

  return {
    label: getStateLabel(state),
    color: getStateColor(state),
    getStateLabel,
    getStateColor,
  };
}
