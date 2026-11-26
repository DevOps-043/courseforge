import { createHash } from "node:crypto";
import { sessionDeckAccess, SessionDeckError } from "./delivery-deck.server";
import { requireDeliveryAccess } from "./delivery-access";
import { deliveryHash } from "../lib/delivery-hash";
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET as BUCKET } from "../../production/media-storage.config";
import { inspectStandaloneMedia } from "../../production/media-inspection.service";
import { SESSION_BROLL_MAX_BYTES, SESSION_BROLL_MAX_SECONDS, sessionBrollPath, type SessionBroll, type SessionBrollCommand } from "../types/session-broll";

export async function sessionBrollAccess(artifactId: string, sessionId: string) {
  const access = await sessionDeckAccess(artifactId, sessionId);
  const document = access.workspace.document;
  const hash = deliveryHash({ session: access.identity.session, plan: document.plans[sessionId], materials: document.materials[sessionId], approval: document.materialsApproval });
  return { ...access, hash, sessionId, artifactId, organizationId: access.tenant.organizationId };
}
type Access = Awaited<ReturnType<typeof sessionBrollAccess>>;
interface BrollRow {
  id: string; qa_status: string; storage_bucket: string; storage_path: string; file_size_bytes: number; mime_type: string;
  duration_seconds: number | null; checksum: string | null;
  metadata: { session_broll: boolean; session_id: string; source_hash: string; name: string; extension: "mp4" | "webm" };
}
const SELECT = "id,qa_status,storage_bucket,storage_path,file_size_bytes,mime_type,duration_seconds,checksum,metadata";
function query(access: Access) {
  return access.admin.from("production_assets").select(SELECT).eq("artifact_id", access.artifactId)
    .eq("organization_id", access.organizationId).eq("asset_type", "SOURCE_MEDIA")
    .eq("metadata->>session_id", access.sessionId).eq("metadata->>session_broll", "true");
}
async function read(access: Access, assetId: string, includeArchived = false) {
  const { data, error } = await query(access).eq("id", assetId).maybeSingle();
  if (error) throw new SessionDeckError("No se pudo consultar el clip.", 503);
  if (!data || (!includeArchived && data.qa_status === "ARCHIVED")) throw new SessionDeckError("Clip no encontrado en esta sesión.", 404);
  const row = data as BrollRow;
  if (!["mp4", "webm"].includes(row.metadata?.extension) || row.storage_bucket !== BUCKET
    || row.storage_path !== sessionBrollPath(access.organizationId, access.artifactId, access.sessionId, row.id, row.metadata.extension))
    throw new SessionDeckError("La referencia del clip no supera la verificación de integridad.");
  return row;
}
function summary(row: BrollRow, access: Access): SessionBroll {
  return { id: row.id, name: row.metadata.name, status: row.qa_status as SessionBroll["status"],
    current: row.metadata.source_hash === access.hash, duration: row.duration_seconds };
}
export async function listSessionBrolls(access: Access, after?: string) {
  let request = query(access).in("qa_status", ["PENDING", "GENERATED", "APPROVED"]).order("id").limit(21);
  if (after) request = request.gt("id", after);
  const { data, error } = await request;
  if (error) throw new SessionDeckError("No se pudieron consultar los apoyos de la sesión.", 503);
  const rows = (data || []) as BrollRow[];
  return { clips: rows.slice(0, 20).map(row => summary(row, access)), next: rows.length > 20 ? rows[19].id : null };
}
export async function commandSessionBroll(access: Access, input: SessionBrollCommand) {
  if (access.workspace.revision !== input.revision) throw new SessionDeckError("El curso cambió. Actualiza antes de modificar los apoyos.");
  if (input.action === "INIT") {
    const bucket = await access.admin.storage.getBucket(BUCKET);
    if (bucket.error || !bucket.data || bucket.data.public) throw new SessionDeckError("El almacenamiento privado de apoyos no está disponible. Revisa su configuración.", 503);
    const path = sessionBrollPath(access.organizationId, access.artifactId, access.sessionId, input.assetId, input.extension);
    const { error } = await access.admin.from("production_assets").upsert({ id: input.assetId, organization_id: access.organizationId,
      artifact_id: access.artifactId, asset_type: "SOURCE_MEDIA", provider: "manual", qa_status: "PENDING",
      storage_bucket: BUCKET, storage_path: path, file_size_bytes: input.size, mime_type: `video/${input.extension}`,
      created_by: access.tenant.userId, metadata: { session_broll: true, session_id: access.sessionId, source_hash: access.hash, name: input.name, extension: input.extension },
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new SessionDeckError("No se pudo reservar la carga.", 503);
    const row = await read(access, input.assetId);
    if (row.metadata.source_hash !== access.hash || row.metadata.name !== input.name || row.file_size_bytes !== input.size || row.storage_path !== path)
      throw new SessionDeckError("El identificador de carga ya está asociado a otro archivo o revisión.");
    if (row.qa_status !== "PENDING") return { clip: summary(row, access) };
    const signed = await access.admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (signed.error || !signed.data) throw new SessionDeckError("No se pudo preparar la carga privada. Reintenta con el mismo archivo.", 503);
    return { clip: summary(row, access), upload: { signedUrl: signed.data.signedUrl } };
  }
  const row = await read(access, input.assetId, input.action === "ARCHIVE");
  if (input.action === "ARCHIVE") {
    if (row.qa_status === "ARCHIVED") return { archived: true };
    const result = await access.admin.from("production_assets").update({ qa_status: "ARCHIVED" })
      .eq("id", row.id).eq("organization_id", access.organizationId).eq("qa_status", row.qa_status).select("id").maybeSingle();
    if (result.error || !result.data) throw new SessionDeckError("El clip cambió. Actualiza para comprobar si se retiró.");
    return { archived: true };
  }
  if (input.action === "APPROVE") {
    await requireDeliveryAccess(access.artifactId, true);
    if (row.metadata.source_hash === access.hash && row.qa_status === "APPROVED") return { clip: summary(row, access) };
    if (row.metadata.source_hash !== access.hash || row.qa_status !== "GENERATED") throw new SessionDeckError("Valida el clip de esta revisión antes de aprobarlo.");
    const result = await access.admin.from("production_assets").update({ qa_status: "APPROVED", approved_by: access.tenant.userId, approved_at: new Date().toISOString() })
      .eq("id", row.id).eq("organization_id", access.organizationId).eq("qa_status", "GENERATED")
      .eq("metadata->>source_hash", access.hash).select("id").maybeSingle();
    if (result.error || !result.data) throw new SessionDeckError("El clip cambió mientras se aprobaba. Actualiza.");
    return { clip: { ...summary(row, access), status: "APPROVED" as const } };
  }
  if (row.metadata.source_hash === access.hash && ["GENERATED", "APPROVED"].includes(row.qa_status)) return { clip: summary(row, access) };
  const bucket = access.admin.storage.from(BUCKET);
  const info = await bucket.info(row.storage_path);
  if (info.error || !info.data) throw new SessionDeckError("El archivo aún no está disponible. Completa la carga o reintenta su verificación.", 409);
  if (info.data.size !== row.file_size_bytes || info.data.size <= 0 || info.data.size > SESSION_BROLL_MAX_BYTES)
    throw new SessionDeckError("El tamaño real del clip no coincide con la carga permitida.", 422);
  const file = await bucket.download(row.storage_path);
  if (file.error || !file.data) throw new SessionDeckError("No se pudo verificar el archivo subido.", 503);
  if (file.data.size !== row.file_size_bytes) throw new SessionDeckError("El archivo cambió durante su validación.", 422);
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  let media: Awaited<ReturnType<typeof inspectStandaloneMedia>>;
  try { media = await inspectStandaloneMedia(bytes, `video/${row.metadata.extension}`); }
  catch { throw new SessionDeckError("El archivo no es un video válido del formato indicado.", 422); }
  if (!media.width || !media.height || !Number.isFinite(media.width) || !Number.isFinite(media.height)
    || media.width <= 0 || media.height <= 0 || Math.max(media.width, media.height) > 1920
    || !media.duration || !Number.isFinite(media.duration) || media.duration <= 0 || media.duration > SESSION_BROLL_MAX_SECONDS)
    throw new SessionDeckError("El apoyo debe durar hasta 10 minutos y medir hasta 1920 px en su lado mayor.", 422);
  const current = await sessionBrollAccess(access.artifactId, access.sessionId);
  if (current.hash !== access.hash) throw new SessionDeckError("Los materiales cambiaron durante la validación. Actualiza.");
  const result = await access.admin.from("production_assets").update({ qa_status: "GENERATED", checksum: createHash("sha256").update(bytes).digest("hex"),
    duration_seconds: Math.ceil(media.duration), approved_by: null, approved_at: null,
    metadata: { ...row.metadata, source_hash: access.hash, width: media.width, height: media.height, has_audio: media.hasAudio },
  }).eq("id", row.id).eq("organization_id", access.organizationId).eq("qa_status", row.qa_status)
    .eq("metadata->>source_hash", row.metadata.source_hash).select("id").maybeSingle();
  if (result.error || !result.data) throw new SessionDeckError("El clip cambió durante la verificación. Actualiza.");
  return { clip: { ...summary(row, access), current: true, status: "GENERATED" as const, duration: Math.ceil(media.duration) } };
}
export async function sessionBrollMedia(access: Access, assetId: string) {
  const row = await read(access, assetId);
  if (row.metadata.source_hash !== access.hash || !["GENERATED", "APPROVED"].includes(row.qa_status))
    throw new SessionDeckError("Valida el clip para la revisión vigente antes de reproducirlo.");
  const bucket = await access.admin.storage.getBucket(BUCKET);
  if (bucket.error || !bucket.data || bucket.data.public) throw new SessionDeckError("El almacenamiento privado de apoyos no está disponible.", 503);
  const signed = await access.admin.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
  if (signed.error || !signed.data) throw new SessionDeckError("No se pudo preparar el acceso privado al clip.", 503);
  return signed.data.signedUrl;
}
