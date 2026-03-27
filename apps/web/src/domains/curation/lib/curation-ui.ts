import type { CurationRow } from "../types/curation.types";

interface SyllabusLesson {
  id?: string;
  title: string;
  objective_specific: string;
}

interface SyllabusModule {
  id?: string;
  title: string;
  objective_general_ref: string;
  lessons: SyllabusLesson[];
}

export const DEFAULT_PROMPT_PREVIEW = `Prompt optimizado con reglas de curaduria, enfoque en accesibilidad (sin descargas), validacion de URLs y estructura JSON estricta. Utiliza busquedas en tiempo real para verificar la disponibilidad.`;

export const GPT_URL =
  "https://chatgpt.com/g/g-69a9a074e8dc8191a8cf38f3b54fbf55-soflia-generating-sources-assistant";

export function rowNeedsValidation(row: CurationRow) {
  const hasGoogleRedirect =
    row.source_ref &&
    (row.source_ref.includes("vertexaisearch.cloud.google.com") ||
      row.source_ref.includes("grounding-api-redirect"));

  return !row.auto_evaluated || hasGoogleRedirect;
}

export function getPendingValidationCount(rows: CurationRow[]) {
  return rows.filter(rowNeedsValidation).length;
}

export function buildGPTContext(params: {
  artifactId: string;
  courseId?: string;
  ideaCentral?: string;
  temario?: SyllabusModule[];
}) {
  const { artifactId, courseId, ideaCentral, temario } = params;

  if (!temario || !ideaCentral) {
    return `COURSE_ID: ${courseId || artifactId}\n\nNo hay temario disponible. Por favor genera el temario primero.`;
  }

  let context = `COURSE_ID: ${courseId || artifactId}\n\n`;
  context += `IDEA CENTRAL: ${ideaCentral}\n\n`;
  context += "TEMARIO:\n";

  temario.forEach((module, moduleIndex) => {
    context += `- Modulo ${moduleIndex + 1}: ${module.title}\n`;
    module.lessons.forEach((lesson, lessonIndex) => {
      const lessonId = lesson.id || `M${moduleIndex + 1}L${lessonIndex + 1}`;
      context += `  - Leccion ${moduleIndex + 1}.${lessonIndex + 1} (${lessonId}): ${lesson.title}\n`;
      if (lesson.objective_specific) {
        context += `    Objetivo: ${lesson.objective_specific}\n`;
      }
    });
  });

  return context;
}

export function parseCurationJsonPreview(value: string) {
  if (!value.trim()) {
    return { error: null, preview: null };
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed.sources || !Array.isArray(parsed.sources)) {
      return {
        error: 'El JSON debe contener un array "sources".',
        preview: null,
      };
    }

    if (parsed.sources.length === 0) {
      return {
        error: 'El array "sources" esta vacio.',
        preview: null,
      };
    }

    const lessonTitles = [
      ...new Set(
        parsed.sources.map(
          (source: any) =>
            source.lesson_title || source.lesson_id || "Sin titulo",
        ),
      ),
    ] as string[];

    return {
      error: null,
      preview: {
        count: parsed.sources.length,
        lessons: lessonTitles,
      },
    };
  } catch {
    return {
      error: "JSON invalido. Verifica que este bien formateado.",
      preview: null,
    };
  }
}
