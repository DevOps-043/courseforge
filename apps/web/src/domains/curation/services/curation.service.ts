import { createClient } from '@/utils/supabase/client';
import { Curation, CurationRow } from '../types/curation.types';

export const curationService = {
  /**
   * Obtiene el registro de curaduría para un artefacto
   */
  async getCurationByArtifactId(artifactId: string): Promise<Curation | null> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('curation')
      .select('*')
      .eq('artifact_id', artifactId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching curation:', error);
      return null;
    }
    return data;
  },

  /**
   * Obtiene todas las filas (fuentes) de una curaduría
   */
  async getCurationRows(curationId: string): Promise<CurationRow[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('curation_rows')
      .select('*')
      .eq('curation_id', curationId)
      .order('lesson_title', { ascending: true }); // Orden básico inicial

    if (error) {
      console.error('Error fetching curation rows:', error);
      return [];
    }
    return data;
  },

  /**
   * Suscripción en tiempo real a cambios en curation_rows
   * Útil para ver cómo van apareciendo las fuentes generadas por el background job
   */
  subscribeToCurationRows(curationId: string, callback: () => void) {
    const supabase = createClient();
    const channel = supabase
      .channel(`curation_rows:${curationId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Insert, Update, Delete
          schema: 'public',
          table: 'curation_rows',
          filter: `curation_id=eq.${curationId}`,
        },
        () => {
          callback();
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      },
    };
  }
};
