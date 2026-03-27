import { createClient } from "@/utils/supabase/client";
import { SYLLABUS_STATES } from "@/lib/pipeline-constants";
import {
  Esp02Route,
  Esp02StepState,
  SyllabusGenerationMetadata,
  SyllabusModule,
  SyllabusRow,
  SyllabusValidationReport,
  TemarioEsp02,
} from "../types/syllabus.types";
import {
  ValidationResult,
  runAllValidations,
} from "../validators/syllabus.validators";

class SyllabusService {
  private supabase = createClient();
  private emptyValidation: SyllabusValidationReport = {
    automatic_pass: false,
    checks: [],
  };

  private hasModules(
    value: unknown,
  ): value is { modules: SyllabusModule[] } {
    return (
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { modules?: unknown }).modules)
    );
  }

  private sanitizeModules(modules: SyllabusModule[]): SyllabusModule[] {
    return modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        estimated_minutes: lesson.estimated_minutes || 30,
      })),
    }));
  }

  private sanitizeMetadata(
    metadata?: SyllabusGenerationMetadata | null,
  ): SyllabusGenerationMetadata | undefined {
    if (!metadata) {
      return undefined;
    }

    return {
      ...metadata,
      search_queries: metadata.search_queries || [],
      final_validation_errors: metadata.final_validation_errors || [],
    };
  }

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

      const result = (await response.json()) as unknown;

      // Si la API devuelve contenido generado inmediatamente (modo local/sincrono)
      if (this.hasModules(result)) {
        console.log(
          "[SyllabusService] Generacion sincrona completada. Guardando...",
        );

        const temario = this.sanitizeSyllabus(result as TemarioEsp02);

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
      return result as { status: string; message: string; data?: TemarioEsp02 };
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
  private sanitizeSyllabus<T extends TemarioEsp02 | SyllabusRow>(
    data: T,
  ): T {
    return {
      ...data,
      modules: this.sanitizeModules(data.modules),
      generation_metadata: this.sanitizeMetadata(data.generation_metadata),
      source_summary: this.sanitizeMetadata(data.source_summary),
      validation: data.validation || this.emptyValidation,
      qa: data.qa || { status: "PENDING" },
    };
  }

  /**
   * Guarda o actualiza el temario en la base de datos.
   */
  async saveSyllabus(
    artifactId: string,
    temario: TemarioEsp02,
    route: Esp02Route = "B_NO_SOURCE",
    validation: ValidationResult | SyllabusValidationReport = this.emptyValidation,
  ): Promise<void> {
    const current = await this.getSyllabus(artifactId);
    const nextIteration = (current?.iteration_count || 0) + 1;

    const payload = {
      artifact_id: artifactId,
      route,
      modules: temario.modules,
      source_summary: temario.source_summary || temario.generation_metadata || null,
      validation,
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
    const payload: {
      state: Esp02StepState;
      updated_at: string;
      qa?: {
        status: "PENDING" | "APPROVED" | "REJECTED";
        notes?: string;
        reviewed_at?: string;
      };
    } = {
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
  async updateModules(
    artifactId: string,
    modules: SyllabusModule[],
  ): Promise<void> {
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
  validateTemario(
    temario: Pick<TemarioEsp02, "modules">,
    objetivos: string[] = [],
  ) {
    return runAllValidations(temario.modules, objetivos);
  }
}

export const syllabusService = new SyllabusService();
