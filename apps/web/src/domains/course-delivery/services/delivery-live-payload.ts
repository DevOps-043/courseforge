import { createHash } from "node:crypto";
import { enginePreparationSchema, enginePreparationRevision } from "../types/engine-preparation.contract";
import type { DeliveryWorkspace } from "../types/delivery.schemas";
import { buildSessionDocuments } from "./delivery-documents";
import type { DeliveryContext } from "./delivery-repository";

function stableId(key: string) {
  const value = createHash("sha256").update(key).digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export function buildEnginePreparation(
  workspace: DeliveryWorkspace,
  sourceSessionId: string,
  target: { organization_slug: string; session_id: string; course_id: string },
  actorId: string,
  context?: Pick<DeliveryContext, "sources">,
) {
  if (workspace.document.config.mode === "NEXUS") throw new Error("El curso utiliza publicación Nexus.");
  const session = workspace.document.agenda.find(item => item.id === sourceSessionId);
  const material = workspace.document.materials[sourceSessionId];
  const plan = workspace.document.plans[sourceSessionId];
  if (!session || !material || !plan) throw new Error("Elige una sesión con plan y materiales completos.");
  if (material.documents && !context) throw new Error("Verifica las fuentes antes de preparar los documentos.");

  const scenes = material.slides.map((slide, index) => ({
    id: stableId(`${sourceSessionId}:slide:${index}`),
    name: `Lámina ${index + 1}`,
    kind: "slide" as const,
    title: slide.title,
    description: slide.points.join("\n"),
  }));
  const practices = material.activities.map(activity => ({
    id: stableId(`${sourceSessionId}:activity:${activity.id}`),
    title: activity.title,
    instructions: activity.instructions + "\n\n" + activity.template,
  }));
  const practiceIds = new Map(material.activities.map((activity, index) => [activity.id, practices[index].id]));
  const result = enginePreparationSchema.safeParse({
    version: 1, actor_id: actorId, artifact_id: workspace.artifact_id,
    source_session_id: sourceSessionId, source_revision: workspace.revision,
    organization_slug: target.organization_slug, session_id: target.session_id,
    manifest: {
      version: 1,
      course_id: target.course_id,
      revision: enginePreparationRevision(workspace.artifact_id, sourceSessionId, workspace.revision),
      scenes, practices, materials: [], quizzes: [],
      preparation: {
        ...(material.documents && context ? { documents: buildSessionDocuments(workspace, session, plan, material, context) } : {}),
        minutes: session.minutes,
        blocks: plan.blocks.map(block => ({
          id: block.id, purpose: block.purpose, minutes: block.minutes,
          explanation: block.explanation, activity: block.activity, criteria: block.criteria,
          practice_ids: practiceIds.has(block.id) ? [practiceIds.get(block.id)!] : [],
        })),
        speaker_notes: material.slides.flatMap((slide, index) => slide.notes.trim()
          ? [{ scene_id: scenes[index].id, content: slide.notes.trim() }] : []),
      },
    },
  });
  if (!result.success) {
    throw new Error("Adapta la preparación al aula: hasta 12 láminas (título 160 y contenido 500 caracteres) y 20 prácticas (título 160 e instrucciones 2000). Revisa los tiempos e identificadores del plan. No se envió contenido parcial.");
  }
  return result.data;
}
