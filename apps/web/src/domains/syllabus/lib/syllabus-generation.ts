import {
  SyllabusGenerationMetadata,
  SyllabusModule,
} from "../types/syllabus.types";
import { calculateEstimatedCourseHours } from "./lesson-duration-estimator";

export interface SyllabusGenerationContent {
  modules: SyllabusModule[];
  total_estimated_hours?: number;
  generation_metadata?: SyllabusGenerationMetadata;
}

export function buildSyllabusResearchPrompt(
  ideaCentral: string,
  objetivos: string[],
) {
  return `Investiga en profundidad sobre el tema: "${ideaCentral}".
    Objetivos del curso: ${objetivos.join(", ")}.
    Identifica:
    1. Tendencias actuales del mercado para este tema.
    2. Conceptos clave obligatorios.
    3. Estructura lógica recomendada.
    Dame un resumen denso y técnico.`;
}

export function getSyllabusRouteContext(route?: string | null) {
  return route === "A_WITH_SOURCE"
    ? "El contenido debe ser estructurado y formal, basado en fuentes académicas."
    : "Genera el contenido desde cero basándote en las mejores prácticas del tema.";
}

export function parseSyllabusResponseText(
  responseText: string,
): SyllabusGenerationContent {
  const cleanJson = responseText
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
  const finalJson = jsonMatch ? jsonMatch[0] : cleanJson;
  const parsedContent = JSON.parse(finalJson) as SyllabusGenerationContent;

  if (!Array.isArray(parsedContent.modules)) {
    throw new Error("La respuesta generada no contiene módulos válidos.");
  }

  return parsedContent;
}

export function calculateSyllabusEstimatedHours(
  modules: SyllabusModule[],
  videoPolicyInput?: unknown,
) {
  return calculateEstimatedCourseHours(modules, videoPolicyInput);
}
