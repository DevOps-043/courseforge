import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "./editor-patch.service";
import type { CompositionEditorPatchRequest } from "./editor-patch.types";
import { normalizeCompositionTrackTopology } from "./composition-track-registry";
import { COMPOSITION_MOTION_ENABLED, isCompositionMotionOperation } from "./composition-motion.config";

export class CompositionDocumentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class CompositionDocumentConflictError extends CompositionDocumentError {
  constructor(readonly current: Awaited<ReturnType<typeof getCurrentCompositionDocument>>) {
    super("La composición cambió en otra sesión. Recarga el preview antes de volver a editar.", 409);
  }
}

/**
 * Normalizes PostgREST/Postgres failures before they cross the API boundary.
 * Supabase errors are plain objects (not Error instances), which used to turn
 * every database failure into an unhelpful "Unknown error" in route logs.
 */
export class CompositionDocumentPersistenceError extends CompositionDocumentError {
  constructor(
    message: string,
    readonly code: string,
    status = 500,
    readonly retryable = false,
    readonly diagnosticId?: string,
  ) {
    super(message, status);
  }
}

/** Stores only the first version. Future edits append a new version atomically. */
export async function ensureInitialCompositionDocument(params: {
  document: CompositionEditorDocument;
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  const parsed = compositionEditorDocumentSchema.parse(params.document);
  const existing = await getLatestCompositionDocument(params);
  if (existing) return { created: false, document: existing.document, version: existing.version };

  const documentHash = hashCompositionDocument(parsed);
  const { data: inserted, error } = await params.supabase
    .from("video_composition_draft_documents")
    .insert({
      created_by: params.userId,
      document: parsed,
      document_hash: documentHash,
      draft_id: params.draftId,
      format: parsed.format,
      organization_id: params.organizationId,
      version: 1,
    })
    .select("document, version")
    .single();
  if (!error) return { created: true, document: inserted.document as CompositionEditorDocument, version: inserted.version as number };
  if (error.code === "23505") {
    const concurrent = await getLatestCompositionDocument(params);
    if (concurrent) return { created: false, document: concurrent.document, version: concurrent.version };
  }
  throw error;
}

export async function getCurrentCompositionDocument(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const current = await getLatestCompositionDocument(params);
  if (!current) throw new CompositionDocumentError("El documento de composición aún no está disponible.", 404);
  return {
    document: current.document,
    documentHash: current.documentHash,
    version: current.version,
  };
}

export function hashCompositionDocument(document: CompositionEditorDocument) {
  return createHash("sha256").update(stableStringify(document)).digest("hex");
}

export async function applyAndAppendCompositionDocumentPatches(params: {
  auditSource?: "SYSTEM";
  draftId: string;
  expectedDocumentHash: string;
  organizationId: string;
  patch: CompositionEditorPatchRequest;
  signal?: AbortSignal;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  if (!COMPOSITION_MOTION_ENABLED && params.patch.operations.some((operation) => isCompositionMotionOperation(operation.type))) {
    throw new CompositionDocumentError("La edición de animaciones está deshabilitada temporalmente para este despliegue.", 409);
  }
  const current = await getCurrentCompositionDocument(params);
  if (current.documentHash !== params.expectedDocumentHash) throw new CompositionDocumentConflictError(current);
  await assertAddedAssetsBelongToDraft(params);

  let nextDocument: CompositionEditorDocument;
  try {
    nextDocument = applyCompositionEditorPatches(current.document, params.patch.operations, params.auditSource || params.patch.source);
  } catch (error) {
    if (error instanceof CompositionEditorPatchError) throw new CompositionDocumentError(error.message);
    throw error;
  }
  const nextHash = hashCompositionDocument(nextDocument);
  const documentBytes = Buffer.byteLength(JSON.stringify(nextDocument), "utf8");
  const rpcStartedAt = Date.now();
  let appendRequest = params.supabase.rpc("append_video_composition_draft_document_v2", {
    p_actor_id: params.userId,
    p_document: nextDocument,
    p_document_hash: nextHash,
    p_draft_id: params.draftId,
    p_expected_document_hash: params.expectedDocumentHash,
    p_format: nextDocument.format,
    p_metadata: {
      motionAnimationCount: nextDocument.motion.animations.length,
      motionKeyframeCount: nextDocument.motion.animations.reduce((total, animation) => total + animation.keyframes.length, 0),
      operations: params.patch.operations.map((operation) => operation.type),
    },
    p_organization_id: params.organizationId,
    p_source: params.auditSource || params.patch.source,
    p_summary: params.patch.summary,
  }).retry(false);
  if (params.signal) appendRequest = appendRequest.abortSignal(params.signal);
  const { data, error } = await appendRequest;

  if (error) {
    const diagnosticId = randomUUID();
    logCompositionPersistenceFailure({
      diagnosticId,
      documentBytes,
      elapsedMs: Date.now() - rpcStartedAt,
      error,
      clipCount: nextDocument.clips.length,
      operationTypes: [...new Set(params.patch.operations.map((operation) => operation.type))],
    });
    throw normalizeCompositionPersistenceError(error, diagnosticId);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new CompositionDocumentError("No se pudo guardar la nueva versión de la composición.", 500);
  const outcome = result.outcome as string;
  if (outcome === "CONFLICT") {
    throw new CompositionDocumentConflictError(await getCurrentCompositionDocument(params));
  }
  if (outcome === "BUSY") {
    throw new CompositionDocumentPersistenceError(
      "Ya hay otro cambio guardándose en esta composición. Espera un momento y vuelve a intentarlo.",
      "COMPOSITION_SAVE_BUSY",
      409,
      true,
    );
  }
  if (outcome === "NOT_EDITABLE") {
    throw new CompositionDocumentPersistenceError(
      "El borrador ya no está disponible para edición.",
      "COMPOSITION_DRAFT_NOT_EDITABLE",
      409,
      false,
    );
  }
  if (outcome !== "APPENDED" && outcome !== "UNCHANGED") {
    throw new CompositionDocumentPersistenceError(
      "El almacenamiento devolvió un resultado de guardado desconocido.",
      "COMPOSITION_APPEND_OUTCOME_INVALID",
      500,
      false,
    );
  }
  return {
    document: nextDocument,
    documentHash: result.document_hash as string,
    version: result.version as number,
  };
}

/** Prevents a client from inserting an arbitrary asset id into a draft document. */
async function assertAddedAssetsBelongToDraft(params: {
  draftId: string;
  organizationId: string;
  patch: CompositionEditorPatchRequest;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const assetIds = [...new Set(params.patch.operations.flatMap((operation) => (
    operation.type === "clip.add" && operation.clip.source.type === "PRODUCTION_ASSET"
      ? [operation.clip.source.productionAssetId]
      : []
  )))];
  if (assetIds.length === 0) return;

  const { data, error } = await params.supabase
    .from("video_composition_draft_assets")
    .select("production_asset_id")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .in("production_asset_id", assetIds);
  if (error) throw error;
  const linkedIds = new Set((data || []).map((row: { production_asset_id: string }) => row.production_asset_id));
  if (assetIds.some((assetId) => !linkedIds.has(assetId))) {
    throw new CompositionDocumentError("El asset seleccionado no está vinculado a este borrador.");
  }
}

export function normalizeCompositionPersistenceError(error: unknown, diagnosticId?: string) {
  const candidate = error && typeof error === "object" ? error as {
    code?: unknown;
    message?: unknown;
  } : {};
  const code = typeof candidate.code === "string" ? candidate.code : "COMPOSITION_PERSISTENCE_FAILED";
  const message = typeof candidate.message === "string" ? candidate.message : "";

  if (code === "PGRST202" || /Could not find the function/i.test(message)) {
    return new CompositionDocumentPersistenceError(
      "El almacenamiento versionado del editor no est\u00e1 disponible. Aplica la migraci\u00f3n de composiciones y vuelve a intentar.",
      "COMPOSITION_STORAGE_NOT_READY",
      503,
      true,
      diagnosticId,
    );
  }
  if (
    code === "PGRST003"
    || /timed out acquiring connection|connection pool|pool timeout|fetch failed|upstream request timeout|gateway timeout/i.test(message)
  ) {
    return new CompositionDocumentPersistenceError(
      "El almacenamiento está ocupado y no pudo guardar a tiempo. Tus cambios siguen en el editor; reintenta en unos segundos.",
      "COMPOSITION_STORAGE_UNAVAILABLE",
      503,
      true,
      diagnosticId,
    );
  }
  if (code === "57014") {
    return new CompositionDocumentPersistenceError(
      "El guardado excedió el tiempo permitido. Tus cambios siguen en el editor; vuelve a intentar una vez.",
      "COMPOSITION_SAVE_TIMEOUT",
      503,
      true,
      diagnosticId,
    );
  }
  if (code === "42501") {
    return new CompositionDocumentPersistenceError(
      "No tienes permisos para guardar cambios en esta composici\u00f3n.",
      "COMPOSITION_SAVE_FORBIDDEN",
      403,
      false,
      diagnosticId,
    );
  }
  if (code === "P0002") {
    return new CompositionDocumentPersistenceError(
      "El borrador ya no est\u00e1 disponible para edici\u00f3n.",
      "COMPOSITION_DRAFT_NOT_EDITABLE",
      409,
      false,
      diagnosticId,
    );
  }
  if (code === "55P03") {
    return new CompositionDocumentPersistenceError(
      "Ya hay otro cambio guardándose en esta composición. Espera un momento y vuelve a intentarlo.",
      "COMPOSITION_SAVE_BUSY",
      409,
      true,
      diagnosticId,
    );
  }
  if (code === "22023") {
    return new CompositionDocumentPersistenceError(
      "La versi\u00f3n o los datos de auditor\u00eda de la edici\u00f3n no son v\u00e1lidos.",
      "COMPOSITION_AUDIT_INVALID",
      400,
      false,
      diagnosticId,
    );
  }
  if (code === "42702") {
    return new CompositionDocumentPersistenceError(
      "El almacenamiento versionado requiere una actualizaci\u00f3n de base de datos antes de poder guardar.",
      "COMPOSITION_STORAGE_MIGRATION_REQUIRED",
      503,
      true,
      diagnosticId,
    );
  }
  return new CompositionDocumentPersistenceError(
    "No se pudo guardar la nueva versi\u00f3n de la composici\u00f3n.",
    "COMPOSITION_PERSISTENCE_FAILED",
    500,
    true,
    diagnosticId,
  );
}

function logCompositionPersistenceFailure(params: {
  clipCount: number;
  diagnosticId: string;
  documentBytes: number;
  elapsedMs: number;
  error: unknown;
  operationTypes: string[];
}) {
  const candidate = params.error && typeof params.error === "object"
    ? params.error as Record<string, unknown>
    : {};
  console.error("[CompositionDocumentPersistence] RPC failed", {
    clipCount: params.clipCount,
    diagnosticId: params.diagnosticId,
    documentBytes: params.documentBytes,
    elapsedMs: params.elapsedMs,
    event: "composition_document_append_failed",
    operationTypes: params.operationTypes,
    postgres: {
      code: safeDiagnosticText(candidate.code, 32),
      details: safeDiagnosticText(candidate.details, 500),
      hint: safeDiagnosticText(candidate.hint, 300),
      message: safeDiagnosticText(candidate.message, 500),
    },
  });
}

function safeDiagnosticText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-uuid]")
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .slice(0, maxLength);
}

async function getLatestCompositionDocument(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_composition_draft_documents")
    .select("document, document_hash, version")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: assetLinks, error: assetLinksError } = await params.supabase
    .from("video_composition_draft_assets")
    .select("production_asset_id, role")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId);
  if (assetLinksError) throw assetLinksError;
  const documentHash = String(data.document_hash || "");
  if (!/^[a-f0-9]{64}$/.test(documentHash)) {
    throw new CompositionDocumentPersistenceError(
      "La versión almacenada de la composición no tiene un identificador válido.",
      "COMPOSITION_DOCUMENT_HASH_INVALID",
      500,
      false,
    );
  }
  const parsedDocument = compositionEditorDocumentSchema.parse(data.document);
  const assetRoles = new Map((assetLinks || []).map((link: { production_asset_id: string; role: string }) => [
    link.production_asset_id,
    link.role,
  ]));
  return {
    document: compositionEditorDocumentSchema.parse(normalizeCompositionTrackTopology(parsedDocument, assetRoles)),
    documentHash,
    version: data.version as number,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
