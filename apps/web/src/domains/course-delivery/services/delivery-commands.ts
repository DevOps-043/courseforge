import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DELIVERY_LIMITS } from "../config/delivery.config";
import { agendaSchema, deliveryConfigSchema, sessionPlanSchema, sessionMaterialsSchema, type DeliveryWorkspace, type DeliveryOperation } from "../types/delivery.schemas";
import { agendaIssues, completeSessionPlan, materialIssues, sessionSources } from "../lib/delivery-policy";
import { deliveryHash } from "../lib/delivery-hash";
import { readDeliveryContext, saveDeliveryWorkspace, type DeliveryContext } from "./delivery-repository";
import { resolveDeliverySettings } from "./delivery-settings";
import { deliveryReadiness, planContentHash, sessionPlanInputHash, sessionMaterialInputHash } from "./delivery-readiness";
import { getInstructionalPlanCompletenessIssues } from "../../plan/lib/plan-completeness";
import { updateInstructionalPlanStatusAction } from "../../plan/actions/plan.actions";
import { applyMaterialsQaDecisionAction, submitMaterialsToQaAction } from "../../materials/actions/materials.actions";

function requireValid(issues: string[]) { if (issues.length) throw new Error(issues.join(" ")); }
export async function editDelivery(admin: SupabaseClient, workspace: DeliveryWorkspace, kind: "CONFIG" | "AGENDA" | "PLAN" | "MATERIALS", value: unknown, sessionId?: string) {
  const document = structuredClone(workspace.document);
  const context = await readDeliveryContext(admin, workspace.artifact_id, workspace.organization_id);
  if (kind === "CONFIG") {
    document.config = deliveryConfigSchema.parse(value);
    if (deliveryHash(document.config) === deliveryHash(workspace.document.config)) return workspace.revision;
    document.stalePlans = document.agenda.map(session => session.id);
    document.staleMaterials = document.agenda.map(session => session.id);
  } else {
    if (!context.syllabusApproved || (document.syllabusHash && document.syllabusHash !== context.syllabusHash)) throw new Error("El temario cambió. Regenera la agenda antes de editar sus dependencias.");
    if (kind === "AGENDA") {
      document.agenda = agendaSchema.parse(value);
      requireValid(agendaIssues(document.agenda, context.lessons, document.config.sessionCount));
      document.syllabusHash = context.syllabusHash;
      for (const session of document.agenda) {
        const previous = workspace.document.agenda.find(item => item.id === session.id);
        if (!previous || deliveryHash(previous) !== deliveryHash(session)) {
          document.stalePlans = [...new Set([...document.stalePlans, session.id])];
          document.staleMaterials = [...new Set([...document.staleMaterials, session.id])];
        }
      }
    } else {
      const session = document.agenda.find(item => item.id === sessionId);
      if (!session) throw new Error("Sesión ajena al curso.");
      if (kind === "PLAN") {
        document.plans[session.id] = sessionPlanSchema.parse(value);
        document.planInputHashes[session.id] = sessionPlanInputHash(document, session, context);
        document.stalePlans = document.stalePlans.filter(id => id !== session.id);
        document.staleMaterials = [...new Set([...document.staleMaterials, session.id])];
      }
      else {
        const material = sessionMaterialsSchema.parse(value);
        if (!document.plans[session.id]) throw new Error("Falta el plan de sesión.");
        requireValid(materialIssues(document.plans[session.id], material, sessionSources(session, context.sources).map(source => source.id)));
        document.materials[session.id] = material;
        document.materialInputHashes[session.id] = sessionMaterialInputHash(document, session, context);
        document.staleMaterials = document.staleMaterials.filter(id => id !== session.id);
      }
    }
  }
  // Las revisiones anteriores se conservan en snapshots de ejecución; editar no dispara IA.
  if (kind !== "MATERIALS") document.planApproval = null;
  document.materialsApproval = null;
  return saveDeliveryWorkspace(admin, workspace, document);
}
export async function approveDelivery(admin: SupabaseClient, workspace: DeliveryWorkspace, operation: "PLAN" | "MATERIALS", userId: string) {
  const document = structuredClone(workspace.document);
  let context = await readDeliveryContext(admin, workspace.artifact_id, workspace.organization_id);
  requireValid(completeSessionPlan(document, context.lessons));
  if (document.agenda.some(session => document.stalePlans.includes(session.id))) throw new Error("Hay planes de sesión pendientes de actualizar.");
  if (document.agenda.some(session => document.planInputHashes[session.id] !== sessionPlanInputHash(document, session, context))) throw new Error("Las entradas del plan cambiaron. Actualiza las sesiones afectadas.");
  if (!context.syllabusApproved || document.syllabusHash !== context.syllabusHash) throw new Error("El plan no corresponde al temario aprobado actual.");
  if (document.config.mode === "HYBRID") requireValid(getInstructionalPlanCompletenessIssues(context.modules, context.nexus));
  if (operation === "MATERIALS") {
    if (!deliveryReadiness(document, context).planReady || context.curation?.state !== "PHASE2_APPROVED") throw new Error("Aprueba el plan y la curación vigentes antes de aprobar materiales.");
    for (const session of document.agenda) {
      if (document.staleMaterials.includes(session.id)) throw new Error("Hay materiales de sesión pendientes de actualizar.");
      if (document.materialInputHashes[session.id] !== sessionMaterialInputHash(document, session, context)) throw new Error("Las fuentes o el plan de una sesión cambiaron. Actualiza sus materiales.");
      if (!document.materials[session.id]) throw new Error(`Faltan materiales de ${session.title}.`);
      requireValid(materialIssues(document.plans[session.id], document.materials[session.id], sessionSources(session, context.sources).map(source => source.id)));
    }
  }
  // Una intención de aprobación coordina las acciones QA existentes, sin reemplazar
  // sus permisos ni sus validadores por escrituras SQL de estado.
  if (document.config.mode === "HYBRID") {
    if (operation === "PLAN" && context.nexusState !== "STEP_APPROVED") {
      const result = await updateInstructionalPlanStatusAction(workspace.artifact_id, "STEP_APPROVED");
      if (!result.success) throw new Error(result.error || "El plan Nexus no cumple sus controles.");
    }
    if (operation === "MATERIALS" && context.materials?.state !== "PHASE3_APPROVED") {
      if (!context.materials?.id) throw new Error("Faltan materiales Nexus.");
      if (context.materials.state !== "PHASE3_READY_FOR_QA") {
        const submitted = await submitMaterialsToQaAction(context.materials.id);
        if (!submitted.success) throw new Error(submitted.error || "Nexus no está listo para QA.");
      }
      const result = await applyMaterialsQaDecisionAction(context.materials.id, "APPROVED");
      if (!result.success) throw new Error(result.error || "Los materiales Nexus no cumplen sus controles.");
    }
    context = await readDeliveryContext(admin, workspace.artifact_id, workspace.organization_id);
  }
  requireValid(completeSessionPlan(document, context.lessons));
  if (!context.syllabusApproved || document.syllabusHash !== context.syllabusHash) throw new Error("El temario cambió durante la aprobación.");
  const approval = {
    revision: workspace.revision, userId, syllabus: context.syllabusHash, nexus: context.nexusHash,
    sources: context.sourcesHash, content: operation === "PLAN" ? planContentHash(document) : deliveryHash(document.materials),
  };
  if (operation === "PLAN") { document.planApproval = approval; document.materialsApproval = null; }
  else document.materialsApproval = approval;
  const { data, error } = await admin.rpc("approve_course_delivery", {
    p_artifact_id: workspace.artifact_id, p_organization_id: workspace.organization_id, p_revision: workspace.revision,
    p_document: document, p_syllabus: context.modules, p_nexus: context.nexus, p_materials: context.materials,
    p_sources: context.allSources, p_phase: operation,
  });
  if (error) throw new Error("El curso cambió durante la revisión. Actualiza y vuelve a comprobarlo.");
  return data;
}
export interface DeliveryRunUnit { id: string; ready: boolean; model?: string }
export interface DeliveryRunSnapshot {
  document: DeliveryWorkspace["document"];
  context: Pick<DeliveryContext, "title" | "modules" | "lessons" | "syllabusHash" | "nexusHash" | "sourcesHash" | "sources">;
  settings: Awaited<ReturnType<typeof resolveDeliverySettings>>;
}
export async function reserveDeliveryRun(admin: SupabaseClient, workspace: DeliveryWorkspace, operation: DeliveryOperation) {
  const context = await readDeliveryContext(admin, workspace.artifact_id, workspace.organization_id);
  const document = workspace.document;
  if (document.config.mode === "NEXUS") throw new Error("Selecciona modalidad sincrónica o híbrida antes de generar sesiones.");
  if (!context.syllabusApproved) throw new Error("Aprueba el temario antes de generar sesiones.");
  if (!context.lessons.length || context.lessons.length > DELIVERY_LIMITS.lessons) throw new Error("El temario supera los límites de lecciones admitidos o está vacío.");
  if (operation === "AGENDA" && (document.config.sessionCount || context.modules.length) > DELIVERY_LIMITS.sessions) throw new Error("Configura una cantidad de sesiones dentro del límite antes de generar la agenda.");
  if (operation !== "AGENDA" && document.syllabusHash !== context.syllabusHash) throw new Error("Regenera la agenda: el temario cambió.");
  if (operation === "PLAN") requireValid(agendaIssues(document.agenda, context.lessons, document.config.sessionCount));
  if (operation === "MATERIALS") {
    if (!deliveryReadiness(document, context).planReady || context.curation?.state !== "PHASE2_APPROVED") throw new Error("Se requieren plan y fuentes aprobados y vigentes.");
    for (const session of document.agenda) {
      if (!context.sources.some(source => session.coverage.some(coverage => coverage.lessonId === source.lessonId))) throw new Error(`Faltan fuentes aprobadas para ${session.title}.`);
    }
  }
  const snapshot: DeliveryRunSnapshot = {
    document: structuredClone(document),
    context: { title: context.title, modules: context.modules, lessons: context.lessons, syllabusHash: context.syllabusHash, nexusHash: context.nexusHash, sourcesHash: context.sourcesHash, sources: context.sources },
    settings: await resolveDeliverySettings(admin, workspace.organization_id, operation),
  };
  const units: DeliveryRunUnit[] = operation === "AGENDA" ? [{ id: randomUUID(), ready: false }] :
    document.agenda.map(session => ({ id: session.id, ready: operation === "PLAN"
      ? Boolean(document.plans[session.id]) && !document.stalePlans.includes(session.id) && document.planInputHashes[session.id] === sessionPlanInputHash(document, session, context)
      : Boolean(document.materials[session.id]) && !document.staleMaterials.includes(session.id) && document.materialInputHashes[session.id] === sessionMaterialInputHash(document, session, context) }));
  if (units.every(unit => unit.ready)) throw new Error("Las sesiones ya tienen contenido. Edita la unidad que requiere cambios o modifica su agenda antes de generar pendientes.");
  const { data, error } = await admin.rpc("reserve_course_delivery_run", {
    p_artifact_id: workspace.artifact_id, p_organization_id: workspace.organization_id, p_revision: workspace.revision,
    p_operation: operation, p_snapshot: snapshot, p_units: units,
  });
  if (error) throw new Error("Ya existe una generación activa o el curso cambió. Actualiza para reanudar o cancelar.");
  return data as string;
}
