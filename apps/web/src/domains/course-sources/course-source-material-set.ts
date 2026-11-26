import { z } from "zod";
import type { SourceEvidence, SourceLesson } from "./course-source-coverage";
import type { CourseSourcePolicy } from "./course-source-policy";

export function isUsableMaterialWebSource(text: unknown, reference: unknown) {
  if (typeof text !== "string" || !text.trim() || typeof reference !== "string") return false;
  try { const url = new URL(reference); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}

/** Disponibilidad del conjunto; el respaldo semántico se comprueba al generar, no se inventa una revisión humana. */
export function materialSourceSetAvailability(policy: CourseSourcePolicy | null, planReady: boolean, lessons: SourceLesson[], evidence: SourceEvidence[]) {
  const documents = evidence.filter(item => item.type === "DOCUMENT" && item.text.trim());
  const allowed = evidence.filter(item => item.text.trim() && (item.type === "DOCUMENT" || policy === "DOCUMENTS_AND_WEB"));
  const lessonCounts = lessons.map(lesson => {
    const web = allowed.filter(item => item.type === "WEB" && item.lessonId === lesson.id).length;
    return { lessonId: lesson.id, documents: documents.length, web, requiredWeb: documents.length || policy === "DOCUMENTS_ONLY" ? 0 : Math.max(1, lesson.webRequired) };
  });
  const issues: string[] = [];
  if (!planReady) issues.push("Aprueba el plan vigente antes de continuar a Materiales.");
  if (!lessons.length) issues.push("El plan no contiene lecciones para generar.");
  if (policy !== "DOCUMENTS_ONLY" && policy !== "DOCUMENTS_AND_WEB") issues.push("Configura la política documental del curso.");
  for (const [index, count] of lessonCounts.entries()) {
    if (policy === "DOCUMENTS_ONLY" && !count.documents) issues.push(`${lessons[index].title}: faltan documentos con texto procesado.`);
    else if (!count.documents && count.web < count.requiredWeb) issues.push(`${lessons[index].title}: ${count.web}/${count.requiredWeb} fuentes web válidas; completa la búsqueda.`);
  }
  return { ready: !issues.length, issues, lessonCounts, documentFragments: documents.length, webSources: allowed.filter(item => item.type === "WEB").length };
}

export const allMaterialSnapshotSchema = z.object({
  snapshotId: z.uuid(), artifactId: z.uuid(), stage: z.literal("MATERIALS"),
  policy: z.enum(["DOCUMENTS_ONLY", "DOCUMENTS_AND_WEB"]), revision: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/), lessonId: z.string().nullable(), scope: z.array(z.string()).min(1),
  sources: z.array(z.object({
    id: z.uuid(), kind: z.enum(["DOCUMENT", "WEB"]), title: z.string(), text: z.string().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/), locator: z.record(z.string(), z.unknown()),
    documentId: z.uuid().optional(), url: z.string().optional(), lessonIds: z.array(z.string()).min(1),
  })).min(1).max(1000),
});
