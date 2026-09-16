import {
  Esp02Route,
  Esp02StepState,
  SyllabusGenerationMetadata,
  SyllabusModule,
  SyllabusRow,
  SyllabusValidationReport,
  TemarioEsp02,
} from "../types/syllabus.types";
import { runAllValidations } from "../validators/syllabus.validators";
import { fillMissingLessonDurationEstimates } from "../lib/lesson-duration-estimator";
import type { SyllabusSourceDocument } from "../syllabus-source-documents";

class SyllabusService {
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
    return fillMissingLessonDurationEstimates(modules);
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
   * La API del servidor valida acceso, reserva la iteración y guarda el resultado.
   */
  async startGeneration(params: {
    artifactId: string;
    route: Esp02Route;
    objetivos: string[];
    ideaCentral: string;
    iterationInstructions?: string;
    promptOverride?: string;
    sourceDocuments?: SyllabusSourceDocument[];
  }): Promise<
    TemarioEsp02 | { status: string; message: string; data?: TemarioEsp02 }
  > {
    console.log(
      `[SyllabusService] Iniciando generacion para ${params.artifactId} via ruta ${params.route}`,
    );

    try {
      const response = await fetch("/api/syllabus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactId: params.artifactId,
          route: params.route,
          objetivos: params.objetivos,
          ideaCentral: params.ideaCentral,
          iterationInstructions: params.iterationInstructions,
          promptOverride: params.promptOverride,
          sourceDocuments: params.sourceDocuments,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as {
          error?: string;
        } | null;
        throw new Error(
          errorPayload?.error || "Error al iniciar la generacion en el servidor",
        );
      }

      const result = (await response.json()) as unknown;

      if (this.hasModules(result)) {
        const temario = this.sanitizeSyllabus(result as TemarioEsp02);
        return temario;
      }

      return result as { status: string; message: string; data?: TemarioEsp02 };
    } catch (error) {
      throw normalizeSyllabusError(
        error,
        "No se pudo iniciar la generación del temario.",
      );
    }
  }

  async getGenerationPrompt(artifactId: string): Promise<{
    content: string;
    source: "organization" | "global" | "default";
    version: string;
  }> {
    const response = await fetch(
      `/api/syllabus/prompt?artifactId=${encodeURIComponent(artifactId)}`,
      { cache: "no-store" },
    );
    const payload = await parseSyllabusApiPayload<{
      prompt?: {
        content: string;
        source: "organization" | "global" | "default";
        version: string;
      };
    }>(response);
    if (!response.ok || !payload?.prompt) {
      throw new Error(
        getSyllabusApiError(payload, "No se pudo cargar el prompt configurado."),
      );
    }
    return payload.prompt;
  }

  /**
   * Obtiene el temario y metadatos de la base de datos.
   */
  async getSyllabus(artifactId: string): Promise<SyllabusRow | null> {
    const response = await fetch(
      `/api/syllabus?artifactId=${encodeURIComponent(artifactId)}`,
      { cache: "no-store" },
    );
    const payload = await parseSyllabusApiPayload<{
      syllabus?: SyllabusRow | null;
    }>(response);
    if (!response.ok) {
      throw new Error(
        getSyllabusApiError(payload, "No se pudo consultar el temario."),
      );
    }
    return payload?.syllabus ? this.sanitizeSyllabus(payload.syllabus) : null;
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
   * Borra el contenido actual del temario y resetea a DRAFT.
   */
  async deleteSyllabusContent(artifactId: string): Promise<void> {
    const response = await fetch(
      `/api/syllabus?artifactId=${encodeURIComponent(artifactId)}`,
      { method: "DELETE" },
    );
    const payload = await parseSyllabusApiPayload(response);
    if (!response.ok) {
      throw new Error(
        getSyllabusApiError(payload, "No se pudo reiniciar el temario."),
      );
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
    const response = await fetch("/api/syllabus", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "status",
        artifactId,
        state: newState,
        notes,
      }),
    });
    const payload = await parseSyllabusApiPayload(response);
    if (!response.ok) {
      throw new Error(
        getSyllabusApiError(payload, "No se pudo actualizar el estado del temario."),
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
    const response = await fetch("/api/syllabus", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "modules", artifactId, modules }),
    });
    const payload = await parseSyllabusApiPayload(response);
    if (!response.ok) {
      throw new Error(
        getSyllabusApiError(payload, "No se pudieron actualizar los módulos."),
      );
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

interface SyllabusApiErrorPayload {
  error?: string;
  message?: string;
}

async function parseSyllabusApiPayload<T extends object = Record<string, never>>(
  response: Response,
) {
  return await response.json().catch(() => null) as (T & SyllabusApiErrorPayload) | null;
}

function getSyllabusApiError(
  payload: SyllabusApiErrorPayload | null,
  fallback: string,
) {
  return payload?.message || payload?.error || fallback;
}

function normalizeSyllabusError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error;
  return new Error(fallback);
}
