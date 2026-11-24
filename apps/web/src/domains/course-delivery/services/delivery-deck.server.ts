import { createHash } from "node:crypto";
import { requireDeliveryAccess } from "./delivery-access";
import { readDeliveryContext, readDeliveryWorkspace } from "./delivery-repository";
import { deliveryReadiness } from "./delivery-readiness";
import { deliveryEnabled } from "../config/delivery-enabled";
import { buildSessionDeck, sessionDeckIdentity, type SessionDeckResult } from "./delivery-deck";

export class SessionDeckError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function sessionDeckAccess(artifactId: string, sessionId: string) {
  const { admin, tenant } = await requireDeliveryAccess(artifactId);
  if (!deliveryEnabled()) throw new SessionDeckError("La impartición síncrona no está habilitada.", 403);
  const [workspace, context] = await Promise.all([
    readDeliveryWorkspace(admin, artifactId, tenant.organizationId),
    readDeliveryContext(admin, artifactId, tenant.organizationId),
  ]);
  if (workspace.document.config.mode === "NEXUS" || !workspace.document.agenda.some(item => item.id === sessionId))
    throw new SessionDeckError("Sesión no encontrada.", 404);
  if (!deliveryReadiness(workspace.document, context).materialsReady)
    throw new SessionDeckError("Aprueba los materiales vigentes antes de producir la presentación.");
  return { admin, tenant, workspace, identity: sessionDeckIdentity(workspace, sessionId) };
}

type Access = Awaited<ReturnType<typeof sessionDeckAccess>>;
export async function readSessionDeck(access: Access): Promise<{ result: SessionDeckResult; html: string } | null> {
  const { data, error } = await access.admin.from("production_assets").select("id,content")
    .eq("id", access.identity.id).eq("artifact_id", access.workspace.artifact_id)
    .eq("organization_id", access.tenant.organizationId).eq("asset_type", "SLIDE_DECK_HTML").maybeSingle();
  if (error) throw new SessionDeckError("No se pudo consultar la presentación guardada.", 503);
  if (!data) return null;
  const content = data.content as ReturnType<typeof buildSessionDeck>;
  if (!content || content.sourceHash !== access.identity.hash || !content.qa || typeof content.html !== "string")
    throw new SessionDeckError("La presentación guardada no corresponde a esta revisión.");
  // La tabla de assets no concede confianza al HTML: vuelve a compilar y auditar
  // el contenido aprobado antes de servirlo, incluso ante una fila manipulada.
  const verified = buildSessionDeck(access.workspace, access.identity.session.id);
  if (content.html !== verified.html) throw new SessionDeckError("La presentación guardada no supera la verificación de integridad.");
  return { result: { id: data.id, sourceHash: verified.sourceHash, status: verified.qa.status === "FAIL" ? "QA_FAILED" : "READY", qa: verified.qa }, html: verified.html };
}

export async function produceSessionDeck(access: Access, revision: number) {
  if (access.workspace.revision !== revision) throw new SessionDeckError("El curso cambió. Actualiza antes de producir la presentación.");
  const existing = await readSessionDeck(access);
  if (existing) return existing.result;
  let content: ReturnType<typeof buildSessionDeck>;
  try { content = buildSessionDeck(access.workspace, access.identity.session.id); }
  catch { throw new SessionDeckError("El contenido excede el contrato visual de diapositivas. Revisa los títulos y puntos en Materiales.", 422); }
  // Una edición concurrente nunca se presenta como producción vigente.
  const current = await sessionDeckAccess(access.workspace.artifact_id, access.identity.session.id);
  if (current.identity.hash !== access.identity.hash) throw new SessionDeckError("Los materiales cambiaron durante la producción. Actualiza para continuar.");
  const { error } = await access.admin.from("production_assets").upsert({
    id: access.identity.id, artifact_id: access.workspace.artifact_id, organization_id: access.tenant.organizationId,
    asset_type: "SLIDE_DECK_HTML", provider: "soflia_engine_slides", mime_type: "text/html",
    checksum: createHash("sha256").update(content.html, "utf8").digest("hex"), file_size_bytes: Buffer.byteLength(content.html, "utf8"), content,
    created_by: access.tenant.userId,
    qa_status: content.qa.status === "FAIL" ? "REJECTED" : "READY_FOR_QA",
    metadata: { session_id: access.identity.session.id, source_revision: revision, source_hash: access.identity.hash, delivery: "SYNCHRONOUS" },
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new SessionDeckError("No se pudo guardar la presentación. Reintenta; se conserva el mismo identificador.", 503);
  const saved = await readSessionDeck(access);
  if (!saved) throw new SessionDeckError("No se pudo confirmar la presentación guardada.", 503);
  return saved.result;
}
