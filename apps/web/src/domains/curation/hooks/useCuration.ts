import { useState, useEffect, useCallback } from 'react';
import { curationService } from '../services/curation.service';
import { Curation, CurationRow } from '../types/curation.types';
import { startCurationAction, updateCurationRowAction, deleteCurationRowAction, clearGPTCurationRowsAction } from '@/app/admin/artifacts/actions';
import { toast } from 'sonner';

export function useCuration(artifactId: string) {
  const [curation, setCuration] = useState<Curation | null>(null);
  const [rows, setRows] = useState<CurationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchCurationData = useCallback(async () => {
    try {
      const curData = await curationService.getCurationByArtifactId(artifactId);
      setCuration(curData);

      if (curData) {
        const rowsData = await curationService.getCurationRows(curData.id);
        setRows(rowsData);

        // Si el estado es GENERATING o REQUESTED, asumimos que estamos en proceso
        if (curData.state === 'PHASE2_GENERATING' || curData.state === 'PAUSED_REQUESTED' || curData.state === 'STOPPED_REQUESTED') {
          setIsGenerating(true);
        } else {
          setIsGenerating(false);
        }
      } else {
        setRows([]);
        setIsGenerating(false);
      }
    } catch (error) {
      console.error('Error in useCuration fetch:', error);
      toast.error('Error cargando datos de curaduría');
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  // Polling to check for completion status
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isGenerating && curation?.id) {
      interval = setInterval(async () => {
        const latest = await curationService.getCurationByArtifactId(artifactId);
        if (latest) {
          setCuration(latest);

          // También actualizar filas por si falla el realtime
          const latestRows = await curationService.getCurationRows(latest.id);
          setRows(latestRows);

          const isGen = latest.state === 'PHASE2_GENERATING' || latest.state === 'PAUSED_REQUESTED' || latest.state === 'STOPPED_REQUESTED';
          if (!isGen) {
            setIsGenerating(false);
          }
        }
      }, 3000); // Check every 3 seconds
    }

    return () => clearInterval(interval);
  }, [isGenerating, curation?.id, artifactId]);

  // Initial Load & Realtime Subscription
  useEffect(() => {
    fetchCurationData();

    // Solo suscribirse si ya tenemos un ID de curaduría
    let subscription: { unsubscribe: () => void } | null = null;

    if (curation?.id) {
      subscription = curationService.subscribeToCurationRows(curation.id, () => {
        // Cuando hay cambios, recargamos las filas
        curationService.getCurationRows(curation.id).then(setRows);

        // También intentamos ver si ya terminó
        curationService.getCurationByArtifactId(artifactId).then(c => {
          setCuration(c);
          const isGen = c?.state === 'PHASE2_GENERATING' || c?.state === 'PAUSED_REQUESTED' || c?.state === 'STOPPED_REQUESTED';
          if (!isGen) setIsGenerating(false);
        });
      });
    }

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [artifactId, curation?.id, fetchCurationData]);

  // Actions
  const startCuration = async (attemptNumber: number = 1, gaps: string[] = [], resume: boolean = false) => {
    setIsGenerating(true);
    // Optimistic UI update could happen here, but we rely on actions return
    const result = await startCurationAction(artifactId, attemptNumber, gaps, resume);

    if (result.success) {
      toast.success(resume ? 'Reanudando curaduría...' : 'Curaduría iniciada. Las fuentes comenzarán a aparecer pronto.');
      // Refetch inmediato para obtener el curation_id si era nuevo
      fetchCurationData();
    } else {
      setIsGenerating(false);
      toast.error('Error al iniciar curaduría: ' + result.error);
    }
  };

  const updateRow = async (rowId: string, updates: Partial<CurationRow>) => {
    // Optimistic update
    setRows(current =>
      current.map(r => r.id === rowId ? { ...r, ...updates } : r)
    );

    const result = await updateCurationRowAction(rowId, updates);

    if (!result.success) {
      toast.error('Error al actualizar fila');
      // Revertir (podríamos hacer un refetch aquí para asegurar consistencia)
      fetchCurationData();
    }
  };

  const deleteRow = async (rowId: string) => {
    // Optimistic UI
    setRows(current => current.filter(r => r.id !== rowId));

    const result = await deleteCurationRowAction(rowId);
    if (!result.success) {
      toast.error('Error al eliminar fila');
      fetchCurationData();
    } else {
      toast.success('Fuente eliminada');
    }
  };

  const clearGPTRows = async () => {
    // Optimistic UI
    setRows(current => current.filter(r => r.source_rationale !== 'GPT_GENERATED'));

    const result = await clearGPTCurationRowsAction(artifactId);
    if (!result.success) {
      toast.error('Error al limpiar fuentes GPT');
      fetchCurationData();
    } else {
      toast.success('Fuentes GPT eliminadas');
    }
  };

  return {
    curation,
    rows,
    loading,
    isGenerating,
    startCuration,
    updateRow,
    deleteRow,
    clearGPTRows,
    refresh: fetchCurationData
  };
}
