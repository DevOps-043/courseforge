import { readStandaloneHtmlLibrary, hasCanonicalHtmlSource } from "../standalone/standalone-timeline-library.service";
import { isRelatedAudioProcessingReplacement, type AudioReplacementRecord } from "../audio-processing/audio-replacement-policy";
import { preservesCompositionHtmlRevisionReferences } from "./composition-html-editing-reference-policy";
import { randomUUID } from "node:crypto";
import { hashCompositionDocument } from "./composition-document-hash";
export { hashCompositionDocument } from "./composition-document-hash";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "./editor-patch.service";
import type { CompositionEditorPatchRequest } from "./editor-patch.types";
import { normalizeCompositionTrackTopology } from "./composition-track-registry";
import { COMPOSITION_MOTION_ENABLED, isCompositionMotionOperation } from "./composition-motion.config";
import { buildCompositionAgentDiff } from "./composition-agent-diff.service";
import { assertCompositionAgentOperationsAllowed, CompositionAgentPolicyError } from "./composition-agent-policy.service";
import { validateCompositionAgentSimulation, CompositionAgentValidationError } from "./composition-agent-validation.service";
import { normalizeCompositionDocumentLayerDepths } from "./composition-layer-depth";
import { readReadyLinkedSoundEffectAssetIds } from "./composition-sound-effect-assets.service";
import { isCompositionDocumentHash } from "./composition-preview-comparison";
import { isUsableCompositionReplacementAsset, replacementAssetStoragePath, type CompositionReplacementAssetRecord } from "./composition-replacement-asset";

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
  return current;
}

/** Returns one immutable saved document version for side-by-side preview. */
export async function getCompositionDocumentByHash(params: {
  documentHash: string;
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  if (!isCompositionDocumentHash(params.documentHash)) {
    throw new CompositionDocumentError("La versión de comparación no es válida.", 400);
  }

  const { data, error } = await params.supabase
    .from("video_composition_draft_documents")
    .select("document, document_hash, version")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("document_hash", params.documentHash.toLowerCase())
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CompositionDocumentError("La versión de comparación ya no está disponible.", 404);

  return resolveCompositionDocumentRow({
    assetLinks: await getDraftAssetLinks(params),
    document: data.document,
    documentHash: data.document_hash,
    version: data.version,
  });
}

/** Returns immutable prior states for explicit user-directed restoration. */
export async function listCompositionDocumentHistory(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_composition_draft_documents")
    .select("created_at, document, document_hash, version")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .order("version", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []).map((row: {
    created_at: string;
    document: unknown;
    document_hash: string;
    version: number;
  }) => ({
    createdAt: row.created_at,
    document: parsePersistedCompositionDocument(row.document),
    documentHash: row.document_hash,
    version: row.version,
  }));
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
  await assertReferencedAssetsBelongToDraft({ ...params, currentDocument: current.document });
  if (current.document.sourceInsertionMode === "MANUAL") {
    const addedHtml = params.patch.operations.flatMap((operation) => operation.type === "clip.add" && operation.clip.source.type === "DECK_SLIDE" ? [operation.clip] : []);
    if (addedHtml.length) {
      const { data: draft, error: draftError } = await params.supabase.from("video_composition_drafts")
        .select("composition_id").eq("id", params.draftId).eq("organization_id", params.organizationId).single();
      if (draftError) throw draftError;
      const { data: composition, error: compositionError } = await params.supabase.from("video_compositions")
        .select("material_component_id").eq("id", draft.composition_id).eq("organization_id", params.organizationId).single();
      if (compositionError) throw compositionError;
      const library = await readStandaloneHtmlLibrary({ componentId: composition.material_component_id, organizationId: params.organizationId, supabase: params.supabase });
      if (addedHtml.some((clip) => !hasCanonicalHtmlSource(clip, library))) {
        throw new CompositionDocumentError("La diapositiva no corresponde a un HTML preparado de este proyecto.", 422);
      }
    }
  }

  let nextDocument: CompositionEditorDocument;
  try {
    const enforceAgentPolicy = params.patch.source === "AGENT" && params.auditSource !== "SYSTEM";
    if (enforceAgentPolicy) {
      assertCompositionAgentOperationsAllowed(params.patch.operations);
    }
    nextDocument = applyCompositionEditorPatches(current.document, params.patch.operations, params.auditSource || params.patch.source);
    if (enforceAgentPolicy) {
      validateCompositionAgentSimulation({
        after: nextDocument,
        before: current.document,
        diff: buildCompositionAgentDiff(current.document, nextDocument),
      });
    }
  } catch (error) {
    if (
      error instanceof CompositionEditorPatchError
      || error instanceof CompositionAgentPolicyError
      || error instanceof CompositionAgentValidationError
    ) throw new CompositionDocumentError(error.message);
    throw error;
  }
  const nextHash = hashCompositionDocument(nextDocument);
  // Generic timeline/history commands cannot publish or retarget HTML revision
  // references. Only the dedicated atomic HTML repository may do that.
  if (!preservesCompositionHtmlRevisionReferences(current.document, nextDocument)) {
    throw new CompositionDocumentError("Las revisiones HTML deben cambiarse mediante su guardado versionado específico.", 422);
  }
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
      groupCount: nextDocument.groups?.length || 0,
      motionAnimationCount: nextDocument.motion.animations.length,
      motionKeyframeCount: nextDocument.motion.animations.reduce((total, animation) => total + animation.keyframes.length, 0),
      operations: params.patch.operations.map((operation) => operation.type),
      transitionCount: nextDocument.transitions?.items.length || 0,
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

/** Prevents add, replace and restore from referencing assets outside this draft. */
async function assertReferencedAssetsBelongToDraft(params: {
  currentDocument: CompositionEditorDocument;
  draftId: string;
  organizationId: string;
  patch: CompositionEditorPatchRequest;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const assetIds = [...new Set(params.patch.operations.flatMap((operation) => {
    if (operation.type === "clip.add" && operation.clip.source.type === "PRODUCTION_ASSET") {
      return [operation.clip.source.productionAssetId];
    }
    if (operation.type === "clip.replace-source") return [operation.productionAssetId];
    if (operation.type === "document.restore" || operation.type === "document.reconcile") {
      return operation.document.clips.flatMap((clip) => (
        clip.source.type === "PRODUCTION_ASSET" ? [clip.source.productionAssetId] : []
      ));
    }
    return [];
  }))];
  const soundEffectAssetIds = [...new Set(params.patch.operations.flatMap((operation) => {
    if (operation.type === "clip.add" && operation.clip.source.type === "SOUND_EFFECT_ASSET") {
      return [operation.clip.source.soundEffectAssetId];
    }
    if (operation.type === "document.restore" || operation.type === "document.reconcile") {
      return operation.document.clips.flatMap((clip) => (
        clip.source.type === "SOUND_EFFECT_ASSET" ? [clip.source.soundEffectAssetId] : []
      ));
    }
    return [];
  }))];
  const brandingAssetIds = [...new Set(params.patch.operations.flatMap((operation) => {
    if (operation.type === "clip.add" && operation.clip.source.type === "ASSEMBLY_BRAND_ASSET") {
      return [operation.clip.source.assemblyBrandAssetId];
    }
    if (operation.type === "document.restore" || operation.type === "document.reconcile") {
      return operation.document.clips.flatMap((clip) => (
        clip.source.type === "ASSEMBLY_BRAND_ASSET" ? [clip.source.assemblyBrandAssetId] : []
      ));
    }
    return [];
  }))];
  if (assetIds.length === 0 && brandingAssetIds.length === 0 && soundEffectAssetIds.length === 0) return;
  const sourceIds = params.patch.operations.flatMap((operation) => {
    if (operation.type !== "clip.replace-source") return [];
    const source = params.currentDocument.clips.find((clip) => clip.id === operation.clipId)?.source;
    return source?.type === "PRODUCTION_ASSET" ? [source.productionAssetId] : [];
  });
  const linkLookupIds = [...new Set([...assetIds, ...sourceIds])];

  const [{ data, error }, { data: branding, error: brandingError }, linkedSoundEffectIds] = await Promise.all([
    assetIds.length > 0
      ? params.supabase.from("video_composition_draft_assets").select("production_asset_id").eq("draft_id", params.draftId).eq("organization_id", params.organizationId).in("production_asset_id", linkLookupIds)
      : Promise.resolve({ data: [], error: null }),
    brandingAssetIds.length > 0
      ? params.supabase.from("video_composition_draft_branding").select("intro_asset_id, outro_asset_id").eq("draft_id", params.draftId).eq("organization_id", params.organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    readReadyLinkedSoundEffectAssetIds({
      draftId: params.draftId,
      organizationId: params.organizationId,
      soundEffectAssetIds,
      supabase: params.supabase,
    }),
  ]);
  if (error) throw error;
  if (brandingError) throw brandingError;
  const linkedIds = new Set((data || []).map((row: { production_asset_id: string }) => row.production_asset_id));
  const replacements = params.patch.operations.filter((operation) => operation.type === "clip.replace-source");
  if (replacements.length > 0) {
    const replacementIds = [...new Set(replacements.flatMap((operation) => {
      const source = params.currentDocument.clips.find((clip) => clip.id === operation.clipId)?.source;
      return [operation.productionAssetId, ...(source?.type === "PRODUCTION_ASSET" ? [source.productionAssetId] : [])];
    }))];
    const { data: registry, error: registryError } = await params.supabase.from("production_assets")
      .select("id, asset_type, provider, material_component_id, checksum, file_size_bytes, mime_type, duration_milliseconds, duration_seconds, metadata, qa_status, storage_bucket, storage_path")
      .eq("organization_id", params.organizationId)
      .in("id", replacementIds);
    if (registryError) throw registryError;
    const byId = new Map((registry || []).map((row: { id: string }) => [row.id, row]));
    const validatedAssets = new Map<string, CompositionReplacementAssetRecord>();
    for (const operation of replacements) {
      delete operation.audioProcessingPreviousAssetId;
      const asset = byId.get(operation.productionAssetId) as (CompositionReplacementAssetRecord & {
        duration_milliseconds: number | null;
        duration_seconds: number | null;
      }) | undefined;
      if (!asset || !isUsableCompositionReplacementAsset(asset)) {
        throw new CompositionDocumentError("El medio de reemplazo no está disponible.", 422);
      }
      const currentSource = params.currentDocument.clips.find((clip) => clip.id === operation.clipId)?.source;
      const currentAsset = currentSource?.type === "PRODUCTION_ASSET" ? byId.get(currentSource.productionAssetId) : null;
      if (currentSource?.type === "PRODUCTION_ASSET" && linkedIds.has(currentSource.productionAssetId) && currentAsset
        && isRelatedAudioProcessingReplacement(currentAsset as AudioReplacementRecord, asset as unknown as AudioReplacementRecord)) {
        operation.audioProcessingPreviousAssetId = currentSource.productionAssetId;
      }
      validatedAssets.set(operation.productionAssetId, asset);
      // Never trust media metadata submitted by the browser: normalize from
      // the tenant-scoped registry before applying and persisting the patch.
      operation.mimeType = asset.mime_type!;
      const duration = typeof asset.duration_milliseconds === "number" && asset.duration_milliseconds > 0
        ? asset.duration_milliseconds / 1000 : asset.duration_seconds;
      if (typeof duration === "number" && duration > 0) operation.sourceDurationSeconds = duration;
      else delete operation.sourceDurationSeconds;
      const metadata = asset.metadata || {};
      operation.hasAudio = typeof metadata.has_audio === "boolean" ? metadata.has_audio : undefined;
      operation.sourceWidth = typeof metadata.source_width === "number" ? metadata.source_width : undefined;
      operation.sourceHeight = typeof metadata.source_height === "number" ? metadata.source_height : undefined;
      if (!linkedIds.has(operation.productionAssetId) && operation.audioProcessingPreviousAssetId) {
        const { error: linkError } = await params.supabase.from("video_composition_draft_assets").upsert({
          draft_id: params.draftId, organization_id: params.organizationId, production_asset_id: operation.productionAssetId,
          role: "VOICE", source_reference: "PRODUCTION_MEDIA",
        }, { onConflict: "draft_id,production_asset_id" });
        if (linkError) throw linkError;
        linkedIds.add(operation.productionAssetId);
      }
    }
    if (assetIds.some((assetId) => !linkedIds.has(assetId))) {
      throw new CompositionDocumentError("El asset seleccionado no está vinculado a este borrador.");
    }
    // Check only replacement candidates, not every existing clip. This also
    // permits relinking a clip whose previous object has disappeared.
    for (const asset of validatedAssets.values()) {
      const storageResult = await params.supabase.storage.from(asset.storage_bucket!).info(replacementAssetStoragePath(asset))
        .catch(() => {
          throw new CompositionDocumentPersistenceError("No se pudo verificar el archivo de reemplazo. Inténtalo de nuevo.", "COMPOSITION_REPLACEMENT_STORAGE_UNAVAILABLE", 503, true);
        });
      const { data: storedObject, error: storageError } = storageResult;
      if (storageError) {
        if (storageError.status === 404) throw new CompositionDocumentError("El archivo de reemplazo ya no existe en Storage.", 422);
        throw new CompositionDocumentPersistenceError("No se pudo verificar el archivo de reemplazo. Inténtalo de nuevo.", "COMPOSITION_REPLACEMENT_STORAGE_UNAVAILABLE", 503, true);
      }
      if (!storedObject || (typeof storedObject.size === "number" && storedObject.size !== asset.file_size_bytes)) {
        throw new CompositionDocumentError("El archivo de reemplazo no coincide con el registro de medios.", 422);
      }
    }
  }
  if (assetIds.some((assetId) => !linkedIds.has(assetId))) {
    throw new CompositionDocumentError("El asset seleccionado no está vinculado a este borrador.");
  }
  const linkedBrandingIds = new Set([branding?.intro_asset_id, branding?.outro_asset_id].filter((id): id is string => typeof id === "string"));
  if (brandingAssetIds.some((assetId) => !linkedBrandingIds.has(assetId))) {
    throw new CompositionDocumentError("El intro u outro seleccionado no está vinculado a este borrador.");
  }
  if (soundEffectAssetIds.some((assetId) => !linkedSoundEffectIds.has(assetId))) {
    throw new CompositionDocumentError("El efecto de sonido seleccionado no está listo o no está vinculado a este borrador.", 409);
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
  return resolveCompositionDocumentRow({
    assetLinks: await getDraftAssetLinks(params),
    document: data.document,
    documentHash: data.document_hash,
    version: data.version,
  });
}

async function getDraftAssetLinks(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_composition_draft_assets")
    .select("production_asset_id, role")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId);
  if (error) throw error;
  return (data || []) as Array<{ production_asset_id: string; role: string }>;
}

function resolveCompositionDocumentRow(params: {
  assetLinks: Array<{ production_asset_id: string; role: string }>;
  document: unknown;
  documentHash: unknown;
  version: unknown;
}) {
  const documentHash = String(params.documentHash || "");
  if (!isCompositionDocumentHash(documentHash)) {
    throw new CompositionDocumentPersistenceError(
      "La versión almacenada de la composición no tiene un identificador válido.",
      "COMPOSITION_DOCUMENT_HASH_INVALID",
      500,
      false,
    );
  }
  const parsedDocument = parsePersistedCompositionDocument(params.document);
  const assetRoles = new Map(params.assetLinks.map((link) => [link.production_asset_id, link.role]));
  return {
    document: compositionEditorDocumentSchema.parse(normalizeCompositionTrackTopology(parsedDocument, assetRoles)),
    documentHash: documentHash.toLowerCase(),
    version: Number(params.version),
  };
}

function parsePersistedCompositionDocument(input: unknown): CompositionEditorDocument {
  return compositionEditorDocumentSchema.parse(
    normalizeCompositionDocumentLayerDepths(input),
  );
}
