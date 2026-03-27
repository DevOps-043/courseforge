import { createClient } from "@/utils/supabase/client";
import { SYLLABUS_STATES } from "@/lib/pipeline-constants";
import {
  Esp02Route,
  Esp02StepState,
  SyllabusRow,
  TemarioEsp02,
} from "../types/syllabus.types";
import { runAllValidations } from "../validators/syllabus.validators";

class SyllabusService {
  private supabase = createClient();

  /**
   * Inicia la generacion del temario.
   * Llama a la API Route. Si es local, guarda el resultado directamente.
   * Si es async (Netlify), el background job se encargara de guardar.
   */
  async startGeneration(params: {
    artifactId: string;
    route: Esp02Route;
    objetivos: string[];
    ideaCentral: string;
    accessToken?: string;
  }): Promise<
    TemarioEsp02 | { status: string; message: string; data?: TemarioEsp02 }
  > {
    console.log(
      `[SyllabusService] Iniciando generacion para ${params.artifactId} via ruta ${params.route}`,
    );

    // 1. Actualizar estado a GENERATING (optimista)
    await this.updateStatus(params.artifactId, SYLLABUS_STATES.GENERATING);

    try {
      const response = await fetch("/api/syllabus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactId: params.artifactId,
          route: params.route,
          objetivos: params.objetivos,
          ideaCentral: params.ideaCentral,
          accessToken: params.accessToken,
        }),
      });

      if (!response.ok) {
        throw new Error("Error al iniciar la generacion en el servidor");
      }

      const result = await response.json();

      // Si la API devuelve contenido generado inmediatamente (modo local/sincrono)
      if (result.modules && Array.isArray(result.modules)) {
        console.log(
          "[SyllabusService] Generacion sincrona completada. Guardando...",
        );

        const temario: TemarioEsp02 = this.sanitizeSyllabus(result);

        // Ejecutar validaciones locales antes de guardar
        const validation = runAllValidations(temario.modules);

        await this.saveSyllabus(
          params.artifactId,
          temario,
          params.route,
          validation,
        );

        // Usar el estado soportado por el pipeline actual
        await this.updateStatus(params.artifactId, SYLLABUS_STATES.READY_FOR_QA);

        return {
          status: "completed",
          message: "Temario generado y guardado",
          data: temario,
        };
      }

      // Si es asincrono (processing), el estado ya esta en GENERATING.
      return result;
    } catch (error) {
      console.error("[SyllabusService] Error:", error);
      await this.updateStatus(params.artifactId, SYLLABUS_STATES.DRAFT);
      throw error;
    }
  }

  /**
   * Obtiene el temario y metadatos de la base de datos.
   */
  async getSyllabus(artifactId: string): Promise<SyllabusRow | null> {
    const { data, error } = await this.supabase
      .from("syllabus")
      .select("*")
      .eq("artifact_id", artifactId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      console.error("[SyllabusService] Error fetching syllabus:", error);
      throw error;
    }

    return this.sanitizeSyllabus(data as SyllabusRow);
  }

  /**
   * Asegura que el temario tenga datos minimos para no romper la UI/validaciones.
   */
  private sanitizeSyllabus(data: any): any {
    if (!data || !data.modules) return data;

    const sanitized = { ...data };

    sanitized.modules = sanitized.modules.map((module: any) => ({
      ...module,
      lessons: module.lessons.map((lesson: any) => ({
        ...lesson,
        // Si falta estimacion, asignar 30 min por defecto
        estimated_minutes: lesson.estimated_minutes || 30,
      })),
    }));

    return sanitized;
  }

  /**
   * Guarda o actualiza el temario en la base de datos.
   */
  async saveSyllabus(
    artifactId: string,
    temario: TemarioEsp02,
    route: Esp02Route = "B_NO_SOURCE",
    validation?: any,
  ): Promise<void> {
    const current = await this.getSyllabus(artifactId);
    const nextIteration = (current?.iteration_count || 0) + 1;

    const payload = {
      artifact_id: artifactId,
      route,
      modules: temario.modules,
      source_summary: temario.generation_metadata || null,
      validation: validation || { checks: [], automatic_pass: false },
      updated_at: new Date().toISOString(),
      iteration_count: nextIteration,
    };

    const { error } = await this.supabase
      .from("syllabus")
      .upsert(payload, { onConflict: "artifact_id" });

    if (error) {
      console.error("[SyllabusService] Error saving syllabus:", error);
      throw error;
    }
  }

  /**
   * Borra el contenido actual del temario y resetea a DRAFT.
   */
  async deleteSyllabusContent(artifactId: string): Promise<void> {
    const { error } = await this.supabase
      .from("syllabus")
      .update({
        modules: [],
        validation: { checks: [], automatic_pass: false },
        state: SYLLABUS_STATES.DRAFT,
        qa: { status: "PENDING" },
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId);

    if (error) {
      console.error("[SyllabusService] Error deleting content:", error);
      throw error;
    }
  }

  /**
   * Actualiza el estado del paso Syllabus.
   */
  async updateStatus(
    artifactId: string,
    newState: Esp02StepState,
    notes?: string,
  ): Promise<void> {
    const payload: any = {
      state: newState,
      updated_at: new Date().toISOString(),
    };

    if (notes !== undefined) {
      payload.qa = {
        status:
          newState === SYLLABUS_STATES.APPROVED
            ? "APPROVED"
            : newState === SYLLABUS_STATES.REJECTED
              ? "REJECTED"
              : "PENDING",
        notes,
        reviewed_at: new Date().toISOString(),
      };
    }

    const { error } = await this.supabase
      .from("syllabus")
      .update(payload)
      .eq("artifact_id", artifactId);

    if (error || (await this.getSyllabus(artifactId)) === null) {
      await this.supabase.from("syllabus").upsert(
        {
          artifact_id: artifactId,
          state: newState,
        },
        { onConflict: "artifact_id" },
      );
    }
  }

  /**
   * Actualiza los modulos del temario (edicion manual).
   */
  async updateModules(artifactId: string, modules: any[]): Promise<void> {
    const { error } = await this.supabase
      .from("syllabus")
      .update({
        modules,
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId);

    if (error) {
      console.error("[SyllabusService] Error updating modules:", error);
      throw error;
    }
  }

  /**
   * Ejecuta validaciones sobre un temario (logica local pura).
   */
  validateTemario(temario: TemarioEsp02, objetivos: string[] = []) {
    return runAllValidations(temario.modules, objetivos);
  }
}

export const syllabusService = new SyllabusService();
