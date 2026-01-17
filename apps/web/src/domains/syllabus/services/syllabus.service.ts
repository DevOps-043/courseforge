import { createClient } from "@/utils/supabase/client";
import { Esp02Route, TemarioEsp02, Esp02StepState, SyllabusRow } from "../types/syllabus.types";
import { runAllValidations } from "../validators/syllabus.validators";

class SyllabusService {
  private supabase = createClient();

  /**
   * Inicia la generación del temario.
   * Llama a la API Route. Si es local, guarda el resultado directamente.
   * Si es Async (Netlify), el background job se encargará de guardar.
   */
  async startGeneration(params: {
    artifactId: string;
    route: Esp02Route;
    objetivos: string[];
    ideaCentral: string;
    accessToken?: string;
  }): Promise<{ status: string; message: string; data?: TemarioEsp02 }> {
    
    console.log(`[SyllabusService] Iniciando generación para ${params.artifactId} vía ruta ${params.route}`);

    // 1. Actualizar estado a GENERATING (optimista)
    await this.updateStatus(params.artifactId, 'STEP_GENERATING');

    try {
      const response = await fetch('/api/syllabus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId: params.artifactId,
          route: params.route,
          objetivos: params.objetivos,
          ideaCentral: params.ideaCentral,
          accessToken: params.accessToken
        })
      });

      if (!response.ok) {
        throw new Error('Error al iniciar la generación en el servidor');
      }

      const result = await response.json();

      // Si la API devuelve contenido generado inmediatamente (Modo Local/Síncrono)
      if (result.modules && Array.isArray(result.modules)) {
        console.log('[SyllabusService] Generación síncrona completada. Guardando...');
        
        const temario: TemarioEsp02 = this.sanitizeSyllabus(result);
        
        // Ejecutar validaciones locales antes de guardar
        const validation = runAllValidations(temario.modules);
        
        await this.saveSyllabus(params.artifactId, temario, params.route, validation);
        
        // Cambiar estado a READY_FOR_REVIEW
        await this.updateStatus(params.artifactId, 'STEP_REVIEW'); // Asumiendo que REVIEW es el estado post-generación

        return { status: 'completed', message: 'Temario generado y guardado', data: temario };
      }

      // Si es asíncrono (processing), el estado ya está en GENERATING.
      return result;

    } catch (error) {
      console.error('[SyllabusService] Error:', error);
      // Revertir a DRAFT o error
      await this.updateStatus(params.artifactId, 'STEP_DRAFT'); // O un estado de error
      throw error;
    }
  }

  /**
   * Obtiene el temario y metadatos de la base de datos.
   */
  async getSyllabus(artifactId: string): Promise<SyllabusRow | null> {
    const { data, error } = await this.supabase
      .from('syllabus')
      .select('*')
      .eq('artifact_id', artifactId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No encontrado
      console.error('[SyllabusService] Error fetching syllabus:', error);
      throw error;
    }

    return this.sanitizeSyllabus(data as SyllabusRow);
  }

  /**
   * Asegura que el temario tenga datos mínimos para no romper la UI/Validaciones.
   */
  private sanitizeSyllabus(data: any): any {
    if (!data || !data.modules) return data;
    
    // Deep clone para no mutar ref directa si fuera necesario, aunque aquí retornamos nuevo obj
    const sanitized = { ...data };
    
    sanitized.modules = sanitized.modules.map((m: any) => ({
      ...m,
      lessons: m.lessons.map((l: any) => ({
        ...l,
        // Si falta estimación, asignar 30 min por defecto (config average)
        estimated_minutes: l.estimated_minutes || 30
      }))
    }));

    return sanitized;
  }

  /**
   * Guarda o actualiza el temario en la base de datos.
   */
  async saveSyllabus(
    artifactId: string, 
    temario: TemarioEsp02, 
    route: Esp02Route = 'B_NO_SOURCE',
    validation?: any
  ): Promise<void> {
    
    // Preparar payload para tabla syllabus
    // Nota: modules es jsonb, igual que validation
    // Iteration count se debería manejar en DB o incrementarlo aquí si tuviéramos lectura previa.
    // Por simplicidad en MVP, hacemos upsert básico.

    // Primero verificamos si existe para incrementar iteración
    const current = await this.getSyllabus(artifactId);
    const nextIteration = (current?.iteration_count || 0) + 1;

    const payload = {
      artifact_id: artifactId,
      route: route,
      modules: temario.modules,
      // Si generation_metadata viene en temario, lo guardamos si la tabla tiene columna, 
      // pero segun schema syllabus.sql no tiene columna 'generation_metadata', solo 'modules'.
      // Si queremos guardar el research_summary, deberiamos tener donde.
      // El schema tiene 'source_summary', podemos usarlo ahí si viene de Route A, o genérico.
      source_summary: temario.generation_metadata || null, 
      validation: validation || { checks: [], automatic_pass: false },
      updated_at: new Date().toISOString(),
      iteration_count: nextIteration
      // state se mantiene o actualiza via updateStatus, pero si es nuevo upsert lo pondrá default DRAFT.
    };

    const { error } = await this.supabase
      .from('syllabus')
      .upsert(payload, { onConflict: 'artifact_id' });

    if (error) {
      console.error('[SyllabusService] Error saving syllabus:', error);
      throw error;
    }
  }




  /**
   * Borra el contenido actual del temario y resetea a DRAFT.
   */
  async deleteSyllabusContent(artifactId: string): Promise<void> {
    const { error } = await this.supabase
      .from('syllabus')
      .update({
        modules: [],
        validation: { checks: [], automatic_pass: false },
        state: 'STEP_DRAFT',
        qa: { status: 'PENDING' },
        updated_at: new Date().toISOString()
      })
      .eq('artifact_id', artifactId);

    if (error) {
      console.error('[SyllabusService] Error deleting content:', error);
      throw error;
    }
  }

  /**
   * Actualiza el estado del paso Syllabus.
   */
  async updateStatus(artifactId: string, newState: Esp02StepState, notes?: string): Promise<void> {
    const payload: any = { state: newState, updated_at: new Date().toISOString() };
    
    // Si viene notes, asumimos que es review de QA
    if (notes !== undefined) {
         payload.qa = {
             status: newState === 'STEP_APPROVED' ? 'APPROVED' : newState === 'STEP_REJECTED' ? 'REJECTED' : 'PENDING',
             notes: notes,
             reviewed_at: new Date().toISOString()
         };
    }

    const { error } = await this.supabase
      .from('syllabus')
      .update(payload)
      .eq('artifact_id', artifactId);

    // Stub creation fallbak (como en implementacion previa)
    if (error || (await this.getSyllabus(artifactId)) === null) {
        await this.supabase.from('syllabus').upsert({
             artifact_id: artifactId,
             state: newState
        }, { onConflict: 'artifact_id' });
    }
  }

  /**
   * Ejecuta validaciones sobre un temario (lógica local pura).
   */
  validateTemario(temario: TemarioEsp02, objetivos: string[] = []) {
    return runAllValidations(temario.modules, objetivos);
  }
}

export const syllabusService = new SyllabusService();
