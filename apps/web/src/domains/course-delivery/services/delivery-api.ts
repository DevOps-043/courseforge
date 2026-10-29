import { z } from "zod";
import { requireDeliveryAccess } from "./delivery-access";
import { readDeliveryContext, readDeliveryWorkspace } from "./delivery-repository";
import { saveDeliveryWorkspace } from "./delivery-repository";
import { deliveryReadiness } from "./delivery-readiness";
import { editDelivery, approveDelivery, reserveDeliveryRun } from "./delivery-commands";
import { resolveDeliverySettings } from "./delivery-settings";
import { dispatchBackgroundFunctionJson } from "../../../lib/server/background-function-client";
import { generateInstructionalPlanAction } from "../../plan/actions/plan.actions";
import { startMaterialsGenerationAction } from "../../materials/actions/materials.actions";
import { nexusGenerationRequired } from "../lib/delivery-nexus-policy";
import type { DeliveryOperation, DeliveryWorkspace } from "../types/delivery.schemas";
import { deliveryEnabled } from "../config/delivery-enabled";

export const deliveryCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE"), revision: z.number().int().nonnegative(), kind: z.enum(["CONFIG", "AGENDA", "PLAN", "MATERIALS"]), sessionId: z.uuid().optional(), value: z.unknown() }).strict(),
  z.object({ action: z.literal("GENERATE"), revision: z.number().int().nonnegative(), operation: z.enum(["AGENDA", "PLAN", "MATERIALS"]) }).strict(),
  z.object({ action: z.literal("APPROVE"), revision: z.number().int().nonnegative(), operation: z.enum(["PLAN", "MATERIALS"]) }).strict(),
  z.object({ action: z.enum(["RESUME", "CANCEL"]), revision: z.number().int().nonnegative(), runId: z.uuid() }).strict(),
  z.object({ action: z.literal("REGENERATE"), revision: z.number().int().nonnegative(), sessionId: z.uuid(), operation: z.enum(["PLAN", "MATERIALS"]) }).strict(),
]);
export async function deliverySnapshot(artifactId: string, includeSettings = true) {
  const { tenant, admin } = await requireDeliveryAccess(artifactId);
  const workspace = await readDeliveryWorkspace(admin, artifactId, tenant.organizationId);
  const canReview = ["ADMIN", "ARQUITECTO", "SUPERADMIN"].includes(tenant.platformRole || "");
  if (workspace.document.config.mode === "NEXUS") return {
    enabled: deliveryEnabled(), workspace,
    readiness: { planReady: true, materialsReady: true, nexus: true, sessions: false, assembly: true },
    lessons: [] as Awaited<ReturnType<typeof readDeliveryContext>>["lessons"],
    syllabusApproved: false, nexusPlanState: null, nexusMaterialsState: null,
    sourceCount: 0, run: null, settings: [], canReview,
  };
  const context = await readDeliveryContext(admin, artifactId, tenant.organizationId);
  const { data: run, error } = workspace.revision ? await admin.from("course_delivery_runs")
    .select("id,operation,status,units,last_error,lease_expires_at").eq("artifact_id", artifactId).eq("organization_id", tenant.organizationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null };
  if (error) throw new Error("No se pudo leer el progreso de impartición.");
  const settings = includeSettings ? await Promise.all(
    (["AGENDA", "PLAN", "MATERIALS"] as const).map(async operation => {
      try { const effective = await resolveDeliverySettings(admin, tenant.organizationId, operation); return { operation, model: effective.model.model_name, inherited: effective.inherited, source: effective.modelSource, version: effective.prompt.version }; }
      catch { return { operation, model: "Configuración requerida", inherited: false, source: "organization", version: "" }; }
    }),
  ) : [];
  return { enabled: deliveryEnabled(), workspace, readiness: deliveryReadiness(workspace.document, context), lessons: context.lessons,
    syllabusApproved: context.syllabusApproved, nexusPlanState: context.nexusState || null, nexusMaterialsState: context.materials?.state || null, sourceCount: context.sources.length, run, settings,
    canReview };
}
async function dispatch(runId: string) {
  await dispatchBackgroundFunctionJson("course-delivery-background", { runId }, {
    fallbackError: "La ejecución quedó reservada. Reanuda si no comienza.",
    localHandlerLoader: () => import("../../../../netlify/functions/course-delivery-background"),
  });
}
async function coordinateNexus(admin: Parameters<typeof readDeliveryContext>[0], workspace: DeliveryWorkspace, operation: DeliveryOperation) {
  if (workspace.document.config.mode !== "HYBRID" || operation === "AGENDA") return;
  const context = await readDeliveryContext(admin, workspace.artifact_id, workspace.organization_id);
  const state = operation === "PLAN" ? context.nexusState : context.materials?.state;
  if (!nexusGenerationRequired(workspace.document.config.mode, operation, state)) return;
  const result = operation === "PLAN"
    ? await generateInstructionalPlanAction(workspace.artifact_id)
    : await startMaterialsGenerationAction(workspace.artifact_id);
  if (!result.success) throw new Error("No se pudo iniciar la rama Nexus. Revisa su panel antes de reanudar.");
}
export async function executeDeliveryCommand(artifactId: string, input: z.infer<typeof deliveryCommandSchema>) {
  const { tenant, admin } = await requireDeliveryAccess(artifactId, input.action === "APPROVE");
  if (!deliveryEnabled()) throw new Error("La autoría sincrónica no está habilitada.");
  const workspace = await readDeliveryWorkspace(admin, artifactId, tenant.organizationId);
  if (workspace.revision !== input.revision) throw new Error("Otra edición cambió el curso. Actualiza antes de continuar.");
  if (input.action === "SAVE") return { revision: await editDelivery(admin, workspace, input.kind, input.value, input.sessionId) };
  if (input.action === "APPROVE") return { revision: await approveDelivery(admin, workspace, input.operation, tenant.userId) };
  if (input.action === "REGENERATE") {
    if (!workspace.document.agenda.some(session => session.id === input.sessionId)) throw new Error("Sesión ajena al curso.");
    const document = structuredClone(workspace.document);
    if (input.operation === "PLAN") {
      document.stalePlans = [...new Set([...document.stalePlans, input.sessionId])]; document.planApproval = null;
    }
    document.staleMaterials = [...new Set([...document.staleMaterials, input.sessionId])]; document.materialsApproval = null;
    return { revision: await saveDeliveryWorkspace(admin, workspace, document) };
  }
  if (input.action === "GENERATE") {
    if (!workspace.revision) throw new Error("Guarda la modalidad antes de generar.");
    const runId = await reserveDeliveryRun(admin, workspace, input.operation);
    try {
      // Coordinación autorizada por el usuario: validar y reservar antes de gastar.
      await coordinateNexus(admin, workspace, input.operation);
      await dispatch(runId);
    } catch {
      await admin.from("course_delivery_runs").update({ status: "FAILED", last_error: "No se pudo despachar la ejecución; puedes reanudarla." }).eq("id", runId).eq("status", "QUEUED");
    }
    return { runId };
  }
  const { data: run, error } = await admin.from("course_delivery_runs").select("id,status,operation,expected_revision,lease_expires_at")
    .eq("id", input.runId).eq("artifact_id", artifactId).eq("organization_id", tenant.organizationId).single();
  if (error || !run) throw new Error("Ejecución ajena o no disponible.");
  if (input.action === "CANCEL") {
    const { error: cancelError } = await admin.from("course_delivery_runs").update({ status: "CANCELLED", lease_token: null, lease_expires_at: null })
      .eq("id", run.id).eq("status", run.status);
    if (cancelError) throw new Error("No se pudo cancelar la ejecución.");
    return { success: true };
  }
  if (run.expected_revision !== workspace.revision) throw new Error("Las entradas cambiaron. Cancela esta ejecución e inicia una nueva.");
  const stale = run.status === "RUNNING" && run.lease_expires_at && Date.parse(run.lease_expires_at) < Date.now();
  if (!["PAUSED", "FAILED", "QUEUED"].includes(run.status) && !stale) throw new Error("La ejecución sigue activa o ya terminó.");
  const { data: queued, error: queueError } = await admin.from("course_delivery_runs").update({ status: "QUEUED", lease_token: null, lease_expires_at: null, last_error: null })
    .eq("id", run.id).eq("status", run.status).eq("expected_revision", workspace.revision)
    .select("id").maybeSingle();
  if (queueError || !queued) throw new Error("Otra solicitud modificó la ejecución.");
  try {
    await coordinateNexus(admin, workspace, run.operation);
    await dispatch(run.id);
  } catch {
    await admin.from("course_delivery_runs").update({ status: "FAILED", last_error: "Revisa la rama Nexus o el despacho y vuelve a reanudar." }).eq("id", run.id).eq("status", "QUEUED");
  }
  return { runId: run.id };
}
export type DeliverySnapshot = Awaited<ReturnType<typeof deliverySnapshot>>;
