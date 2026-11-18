import type { DeliveryContext } from "../services/delivery-repository";
import { emptyDeliveryDocument, type SessionMaterials, type SessionPlan } from "../types/delivery.schemas";
import { deliveryHash } from "../lib/delivery-hash";
import { planContentHash, sessionPlanInputHash, sessionMaterialInputHash } from "../services/delivery-readiness";

export function documentFixture() {
  const id = "10000000-0000-4000-8000-000000000001";
  const document = emptyDeliveryDocument();
  document.config.mode = "SYNCHRONOUS";
  document.syllabusHash = "syllabus";
  const session = { id, title: "Sesión", minutes: 60, objectives: ["Aplicar"], evidence: "Caso resuelto", coverage: [{ lessonId: "lesson", scope: "Completo", review: false }] };
  const plan: SessionPlan = { blocks: [{ id: "block", purpose: "Aplicar", minutes: 60, explanation: "Explicación", activity: "Caso", criteria: ["Justifica"], resources: ["Plantilla"] }], nexusLinks: [] };
  const material: SessionMaterials = {
    concepts: [{ title: "Tema", explanation: "Concepto", example: "Ejemplo", misconceptions: [], sourceRefs: ["source"] }],
    activities: [{ id: "block", title: "Caso", instructions: "Resuelve", template: "Plantilla", answer: "SOLUCION_RESERVADA", criteria: ["Criterio reservado"], sourceRefs: ["source"] }],
    slides: [{ title: "Tema", points: ["Visible"], notes: "NOTA_RESERVADA", sourceRefs: ["source"] }],
    preparation: { understand: "Comprender", explain: "Explicar", conduct: "Conducir", deepen: "Profundizar", expand: "Ampliar" },
    documents: {
      instruments: [{ activityId: "block", instructions: "Presenta el resultado", participantCriteria: ["Justifica"], expectedAnswer: "RESPUESTA_RESERVADA", feedback: "RETRO_RESERVADA", criticalErrors: ["ERROR_RESERVADO"], retry: "REINTENTO_RESERVADO", sourceRefs: ["source"] }],
      contingencies: [{ blockId: "block", situation: "Falla de red", trigger: "Sin conexión", action: "Usar caso local", timeImpact: "Cinco minutos", evidenceImpact: "Entrega posterior", objectiveLimit: "Sin entrega queda pendiente" }],
      recordTemplate: { sessionFields: ["Sesión"], participantFields: ["Participante", "Evidencia"], instructions: "Completar al impartir" },
      jobAid: { applicable: true, reason: "Tarea operativa", content: "Lista de verificaciones" },
      followUp: { applicable: false, reason: "Se cubre en Academy", content: "" },
      absence: { applicable: true, reason: "Recuperación", content: "Resolver caso y solicitar revisión" },
    },
  };
  document.agenda = [session]; document.plans[id] = plan; document.materials[id] = material;
  const context: DeliveryContext = {
    title: "Curso", modules: [], lessons: [{ id: "lesson", title: "Lección", module: "Módulo", objective: "Aplicar" }],
    syllabusApproved: true, syllabusHash: "syllabus", nexus: null, nexusHash: "nexus", nexusState: undefined, materials: null,
    curation: { id: "curation", state: "PHASE2_APPROVED", qa_decision: null }, allSources: [], sourcesHash: "sources",
    sources: [{ id: "source", lessonId: "lesson", reference: "https://example.test", title: "Fuente", rationale: "", evidence: {}, notes: null }],
  };
  document.planInputHashes[id] = sessionPlanInputHash(document, session, context);
  document.materialInputHashes[id] = sessionMaterialInputHash(document, session, context);
  document.planApproval = { revision: 1, syllabus: "syllabus", nexus: "nexus", sources: "sources", content: planContentHash(document), userId: "reviewer" };
  document.materialsApproval = { ...document.planApproval, content: deliveryHash(document.materials) };
  return { id, session, plan, material, context, workspace: { artifact_id: id, organization_id: id, revision: 2, document } };
}
