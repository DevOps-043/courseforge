import type { DeliveryDocument, AgendaSession } from "../types/delivery.schemas";
import type { DeliveryContext } from "./delivery-repository";
import { deliveryHash } from "../lib/delivery-hash";
import { completeSessionPlan, deliveryRequirements, materialIssues, sessionSources } from "../lib/delivery-policy";

export function planContentHash(document: DeliveryDocument) {
  return deliveryHash({ config: document.config, agenda: document.agenda, plans: document.plans });
}
export function sessionPlanInputHash(document: DeliveryDocument, session: AgendaSession, context: DeliveryContext) {
  return deliveryHash({ config: document.config, session, syllabus: context.syllabusHash });
}
export function sessionMaterialInputHash(document: DeliveryDocument, session: AgendaSession, context: DeliveryContext) {
  return deliveryHash({ plan: document.plans[session.id], sources: sessionSources(session, context.sources) });
}
export function deliveryReadiness(document: DeliveryDocument, context: DeliveryContext) {
  const requirements = deliveryRequirements(document.config.mode);
  const plan = document.planApproval;
  const planReady = !requirements.sessions || Boolean(plan && context.syllabusApproved &&
    !document.agenda.some(session => document.stalePlans.includes(session.id)) &&
    document.agenda.every(session => document.planInputHashes[session.id] === sessionPlanInputHash(document, session, context)) &&
    document.syllabusHash === context.syllabusHash && plan.syllabus === context.syllabusHash &&
    plan.content === planContentHash(document) &&
    (!requirements.nexus || (plan.nexus === context.nexusHash && context.nexusState === "STEP_APPROVED")) &&
    completeSessionPlan(document, context.lessons).length === 0);
  const materialApproval = document.materialsApproval;
  const materialsReady = !requirements.sessions || Boolean(planReady && materialApproval &&
    !document.agenda.some(session => document.staleMaterials.includes(session.id)) &&
    document.agenda.every(session => document.materialInputHashes[session.id] === sessionMaterialInputHash(document, session, context)) &&
    materialApproval.content === deliveryHash(document.materials) && materialApproval.sources === context.sourcesHash &&
    context.curation?.state === "PHASE2_APPROVED" &&
    (!requirements.nexus || context.materials?.state === "PHASE3_APPROVED") &&
    document.agenda.every(session => document.materials[session.id] && document.plans[session.id] &&
      materialIssues(document.plans[session.id], document.materials[session.id], sessionSources(session, context.sources).map(source => source.id)).length === 0));
  return { planReady, materialsReady, ...requirements };
}
