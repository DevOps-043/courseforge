import { ENGINE_DOCUMENT_LABELS, engineSessionDocumentSchema, type EngineSessionDocument } from "../types/engine-session-documents.contract";
import type { AgendaSession, DeliveryWorkspace, SessionMaterials, SessionPlan } from "../types/delivery.schemas";
import type { DeliveryContext } from "./delivery-repository";

type Section = { heading: string; body: string };
const section = (heading: string, body: string): Section => ({ heading, body });
const preparationLabels: Record<string, string> = {
  understand: "Qué comprender", explain: "Qué explicar", conduct: "Qué conducir",
  deepen: "Dónde profundizar", expand: "Cómo ampliar",
};

/** Deriva las salidas comunes del contenido aprobado y conserva las secciones reservadas. */
export function buildSessionDocuments(
  workspace: DeliveryWorkspace,
  session: AgendaSession,
  plan: SessionPlan,
  material: SessionMaterials,
  context: Pick<DeliveryContext, "sources">,
): EngineSessionDocument[] {
  const supplemental = material.documents;
  if (!supplemental) return [];
  const sourceRefs = [...new Set([
    ...material.concepts.flatMap(item => item.sourceRefs),
    ...material.activities.flatMap(item => item.sourceRefs),
    ...material.slides.flatMap(item => item.sourceRefs),
    ...supplemental.instruments.flatMap(item => item.sourceRefs),
  ])];
  const blocks = plan.blocks.map(block => block.id);
  function document(
    kind: EngineSessionDocument["kind"],
    participantSections: Section[],
    facilitatorSections: Section[],
    applicable = true,
    reason = "",
  ): EngineSessionDocument {
    return engineSessionDocumentSchema.parse({
      id: `${session.id}:${kind}`, kind, title: ENGINE_DOCUMENT_LABELS[kind],
      applicable, reason, block_ids: blocks, source_refs: sourceRefs,
      participant_sections: applicable ? participantSections : [],
      facilitator_sections: applicable ? facilitatorSections : [],
    });
  }
  const agenda = workspace.document.agenda.map(item => section(item.title,
    `${item.minutes} min\n${item.objectives.join("\n")}\nEvidencia prevista: ${item.evidence}`));
  const instruments = supplemental.instruments;
  const conditional = (kind: "job_aid" | "follow_up" | "absence_activity", value: typeof supplemental.jobAid) =>
    document(kind, value.applicable ? [section(ENGINE_DOCUMENT_LABELS[kind], value.content)] : [], [], value.applicable, value.reason);
  return [
    document("course_plan", [], workspace.document.agenda.map(item => {
      const courseSessionPlan = workspace.document.plans[item.id];
      return section(item.title, [
        ...item.objectives, item.evidence,
        ...(courseSessionPlan?.blocks.flatMap(block => block.criteria) || []),
        ...(courseSessionPlan?.nexusLinks.map(link => `${link.lessonId} · ${link.timing === "BEFORE" ? "Antes" : "Después"} · ${link.purpose}`) || []),
      ].join("\n"));
    })),
    document("agenda", agenda, []),
    document("session_plan", [], plan.blocks.map((block, index) => section(`Bloque ${index + 1} · ${block.minutes} min`,
      [block.purpose, block.explanation, block.activity, ...block.criteria, ...block.resources].join("\n")))),
    document("assessment",
      instruments.map((item, index) => section(`Consigna ${index + 1}`, [item.instructions, ...item.participantCriteria].join("\n"))),
      instruments.map((item, index) => section(`Revisión reservada ${index + 1}`,
        [item.expectedAnswer, item.feedback, ...item.criticalErrors, item.retry].join("\n")))),
    document("participant_material", [
      ...material.concepts.map(item => section(item.title, [item.explanation, item.example].join("\n"))),
      ...material.activities.map(item => section(item.title, [item.instructions, item.template].join("\n"))),
    ], []),
    document("presentation", material.slides.map(item => section(item.title, item.points.join("\n"))),
      material.slides.filter(item => item.notes.trim()).map(item => section(item.title, item.notes))),
    document("facilitator_guide", [], [
      ...Object.entries(material.preparation).map(([key, value]) => section(preparationLabels[key] || "Preparación", value)),
      ...plan.blocks.map((block, index) => section(`Conducción del bloque ${index + 1}`, [block.purpose, block.explanation, block.activity].join("\n"))),
      ...material.slides.filter(item => item.notes.trim()).map(item => section(item.title, item.notes)),
      ...material.concepts.filter(item => item.misconceptions.length).map(item => section(item.title, item.misconceptions.join("\n"))),
      ...material.activities.map(item => section(item.title, [item.answer, ...item.criteria].join("\n"))),
    ]),
    document("contingencies", [], supplemental.contingencies.map(item => section(item.situation,
      [item.trigger, item.action, item.timeImpact, item.evidenceImpact, item.objectiveLimit].join("\n")))),
    document("record_template", [], [
      section("Campos de sesión", supplemental.recordTemplate.sessionFields.join("\n")),
      section("Campos por participante", supplemental.recordTemplate.participantFields.join("\n")),
      section("Instrucciones", supplemental.recordTemplate.instructions),
    ]),
    document("sources", context.sources.filter(item => sourceRefs.includes(item.id))
      .map((item, index) => {
        let reference = `Referencia ${item.id}`;
        try {
          const url = new URL(item.reference);
          if (url.protocol === "https:" && !url.username && !url.password && !url.search) reference += `\n${url.href}`;
        } catch { /* La fuente interna conserva su identificador, sin exponer rutas. */ }
        return section(`Fuente ${index + 1}`, [
        item.title || "Fuente aprobada",
        reference,
        ...material.concepts.filter(concept => concept.sourceRefs.includes(item.id)).map(concept => `Concepto: ${concept.title}`),
        ...material.activities.filter(activity => activity.sourceRefs.includes(item.id)).map(activity => `Actividad: ${activity.title}`),
        ...material.slides.filter(slide => slide.sourceRefs.includes(item.id)).map(slide => `Lámina: ${slide.title}`),
        ].join("\n"));
      }), []),
    document("quick_guide", [], [
      section("Resultado esperado", session.evidence),
      ...plan.blocks.map((block, index) => section(`Bloque ${index + 1} · ${block.minutes} min`, [block.purpose, block.activity, ...block.resources].join("\n"))),
      section("Contingencias", supplemental.contingencies.map(item => [item.situation, item.trigger, item.action].join("\n")).join("\n\n")),
    ]),
    conditional("job_aid", supplemental.jobAid),
    conditional("follow_up", supplemental.followUp),
    conditional("absence_activity", supplemental.absence),
  ];
}
