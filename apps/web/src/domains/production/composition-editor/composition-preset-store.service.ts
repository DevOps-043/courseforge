import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCurrentCompositionDocument } from "./composition-document.service";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { applyCompositionPresetDefinition } from "./composition-preset-application.service";
import { BUILT_IN_COMPOSITION_PRESETS, findBuiltInCompositionPreset } from "./composition-preset-builtins";
import {
  COMPOSITION_PRESET_SCHEMA_VERSION,
  compositionDynamicPresetDefinitionSchema,
  type CompositionDynamicPresetDefinition,
  type CompositionPresetCatalogEntry,
  type CompositionPresetSourceKind,
} from "./composition-preset.types";
import type { CompositionPresetExtractionDiagnostic } from "./composition-preset-extraction.service";

const PRESET_APPLICATION_STATUSES = ["APPLIED", "DISMISSED", "EXPIRED", "PENDING", "UNDONE"] as const;
type PresetApplicationStatus = typeof PRESET_APPLICATION_STATUSES[number];

export class CompositionPresetStoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
  ) { super(message); }
}

type StoreParams = {
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
};

export type RecoverableCompositionPresetApplication = {
  applicationId: string;
  name: string;
};

const recoverableCompositionPresetApplicationRowSchema = z.object({
  id: z.string().uuid(),
  proposed_document_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  status: z.literal("APPLIED"),
  summary: z.object({ presetName: z.string().trim().min(1).max(120) }).passthrough(),
});

export async function listCompositionPresetCatalog(params: StoreParams): Promise<CompositionPresetCatalogEntry[]> {
  const { data, error } = await params.supabase
    .from("video_composition_presets")
    .select("id, name, description, source_kind, current_version, created_at")
    .eq("organization_id", params.organizationId)
    .eq("status", "ACTIVE")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw normalizePresetStorageError(error);
  const custom = (data || []).map((row: Record<string, unknown>): CompositionPresetCatalogEntry => ({
    createdAt: String(row.created_at),
    description: String(row.description || ""),
    id: String(row.id),
    name: String(row.name),
    sourceKind: parseSourceKind(row.source_kind),
    version: Number(row.current_version),
  }));
  return [
    ...BUILT_IN_COMPOSITION_PRESETS.map(({ definition: _definition, ...entry }) => entry),
    ...custom,
  ];
}

export async function createStoredCompositionPreset(params: StoreParams & {
  definition: CompositionDynamicPresetDefinition;
  description: string;
  diagnostics: CompositionPresetExtractionDiagnostic[];
  instruction?: string;
  name: string;
  sourceDocumentHash: string;
  sourceKind: Exclude<CompositionPresetSourceKind, "SYSTEM">;
  userId: string;
}) {
  const definition = compositionDynamicPresetDefinitionSchema.parse(params.definition);
  const definitionHash = hashPresetDefinition(definition);
  const { data, error } = await params.supabase.rpc("create_video_composition_preset", {
    p_actor_id: params.userId,
    p_definition: definition,
    p_definition_hash: definitionHash,
    p_description: params.description,
    p_extraction_diagnostics: params.diagnostics,
    p_instruction: params.instruction || null,
    p_name: params.name,
    p_organization_id: params.organizationId,
    p_schema_version: COMPOSITION_PRESET_SCHEMA_VERSION,
    p_source_document_hash: params.sourceDocumentHash,
    p_source_kind: params.sourceKind,
  });
  if (error) throw normalizePresetStorageError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.preset_id || !row?.preset_version_id) throw storageUnavailable();
  return {
    createdAt: new Date().toISOString(),
    description: params.description,
    diagnostics: params.diagnostics,
    id: String(row.preset_id),
    name: params.name,
    sourceKind: params.sourceKind,
    version: Number(row.version),
    versionId: String(row.preset_version_id),
  };
}

export async function createCompositionPresetPreview(params: StoreParams & {
  draftId: string;
  presetId: string;
  userId: string;
}) {
  await expirePendingCompositionPresetApplications(params);
  const [current, preset] = await Promise.all([
    getCurrentCompositionDocument(params),
    resolveCompositionPreset(params),
  ]);
  const application = applyCompositionPresetDefinition({ definition: preset.definition, document: current.document });
  const proposedDocumentHash = hashCompositionDocument(application.document);
  if (proposedDocumentHash === current.documentHash) {
    throw new CompositionPresetStoreError("El preset no produciría cambios en esta edición.", "COMPOSITION_PRESET_NO_EFFECT", 409);
  }
  const expiresAt = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
  const summary = {
    affectedClipCount: application.affectedClipCount,
    affectedTrackCount: application.affectedTrackCount,
    generatedAnimationCount: application.generatedAnimationCount,
    presetName: preset.name,
    warnings: application.warnings,
  };
  const { data, error } = await params.supabase
    .from("video_composition_preset_applications")
    .insert({
      base_document: current.document,
      base_document_hash: current.documentHash,
      created_by: params.userId,
      draft_id: params.draftId,
      expires_at: expiresAt,
      organization_id: params.organizationId,
      preset_ref: preset.id,
      preset_version_id: preset.versionId,
      proposed_document: application.document,
      proposed_document_hash: proposedDocumentHash,
      summary,
    })
    .select("id, expires_at")
    .single();
  if (error) throw normalizePresetStorageError(error);
  return {
    applicationId: String(data.id),
    baseDocumentHash: current.documentHash,
    expiresAt: String(data.expires_at),
    preset: { id: preset.id, name: preset.name, version: preset.version },
    proposedDocumentHash,
    summary,
  };
}

export async function getCompositionPresetPreviewDocument(params: StoreParams & {
  applicationId: string;
  draftId: string;
}) {
  const stored = await getStoredApplication(params);
  if (stored.status !== "PENDING" || Date.parse(stored.expiresAt) <= Date.now()) {
    if (stored.status === "PENDING") await expireCompositionPresetApplication(params);
    throw new CompositionPresetStoreError("El preview del preset ya no está disponible.", "COMPOSITION_PRESET_PREVIEW_EXPIRED", 410);
  }
  return compositionEditorDocumentSchema.parse(stored.proposedDocument);
}

/**
 * Returns the only preset application that can still be undone safely. Matching
 * the current document hash prevents an old application from overwriting edits
 * made after the preset was applied.
 */
export async function getRecoverableCompositionPresetApplication(params: StoreParams & {
  draftId: string;
}): Promise<RecoverableCompositionPresetApplication | null> {
  const current = await getCurrentCompositionDocument(params);
  const { data, error } = await params.supabase
    .from("video_composition_preset_applications")
    .select("id, proposed_document_hash, status, summary")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("status", "APPLIED")
    .eq("proposed_document_hash", current.documentHash)
    .order("applied_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw normalizePresetStorageError(error);
  return parseRecoverableCompositionPresetApplication(data, current.documentHash);
}

export function parseRecoverableCompositionPresetApplication(
  row: unknown,
  currentDocumentHash: string,
): RecoverableCompositionPresetApplication | null {
  const parsed = recoverableCompositionPresetApplicationRowSchema.safeParse(row);
  if (!parsed.success || parsed.data.proposed_document_hash !== currentDocumentHash) return null;
  return {
    applicationId: parsed.data.id,
    name: parsed.data.summary.presetName,
  };
}

export async function applyStoredCompositionPreset(params: StoreParams & {
  applicationId: string;
  draftId: string;
  expectedDocumentHash: string;
  signal?: AbortSignal;
  userId: string;
}) {
  let request = params.supabase.rpc("apply_video_composition_preset_application", {
    p_actor_id: params.userId,
    p_application_id: params.applicationId,
    p_draft_id: params.draftId,
    p_expected_document_hash: params.expectedDocumentHash,
    p_organization_id: params.organizationId,
  }).retry(false);
  if (params.signal) request = request.abortSignal(params.signal);
  const { data, error } = await request;
  if (error) throw normalizePresetStorageError(error);
  assertMutationOutcome(parseOutcome(data), "APPLY");
  return getCurrentCompositionDocument(params);
}

export async function undoStoredCompositionPreset(params: StoreParams & {
  applicationId: string;
  draftId: string;
  expectedDocumentHash: string;
  signal?: AbortSignal;
  userId: string;
}) {
  let request = params.supabase.rpc("undo_video_composition_preset_application", {
    p_actor_id: params.userId,
    p_application_id: params.applicationId,
    p_draft_id: params.draftId,
    p_expected_document_hash: params.expectedDocumentHash,
    p_organization_id: params.organizationId,
  }).retry(false);
  if (params.signal) request = request.abortSignal(params.signal);
  const { data, error } = await request;
  if (error) throw normalizePresetStorageError(error);
  assertMutationOutcome(parseOutcome(data), "UNDO");
  return getCurrentCompositionDocument(params);
}

export async function dismissStoredCompositionPresetPreview(params: StoreParams & {
  applicationId: string;
  draftId: string;
}) {
  const { error } = await params.supabase
    .from("video_composition_preset_applications")
    .update({ status: "DISMISSED", updated_at: new Date().toISOString() })
    .eq("id", params.applicationId)
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("status", "PENDING");
  if (error) throw normalizePresetStorageError(error);
}

async function resolveCompositionPreset(params: StoreParams & { presetId: string }) {
  const builtIn = findBuiltInCompositionPreset(params.presetId);
  if (builtIn) return { ...builtIn, versionId: null };
  if (!z.string().uuid().safeParse(params.presetId).success) throw presetNotFound();
  const { data: preset, error: presetError } = await params.supabase
    .from("video_composition_presets")
    .select("id, name, description, current_version, source_kind")
    .eq("id", params.presetId)
    .eq("organization_id", params.organizationId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (presetError) throw normalizePresetStorageError(presetError);
  if (!preset) throw presetNotFound();
  const { data: version, error: versionError } = await params.supabase
    .from("video_composition_preset_versions")
    .select("id, version, definition")
    .eq("preset_id", preset.id)
    .eq("organization_id", params.organizationId)
    .eq("version", preset.current_version)
    .maybeSingle();
  if (versionError) throw normalizePresetStorageError(versionError);
  if (!version) throw presetNotFound();
  return {
    definition: compositionDynamicPresetDefinitionSchema.parse(version.definition),
    description: String(preset.description || ""),
    id: String(preset.id),
    name: String(preset.name),
    sourceKind: parseSourceKind(preset.source_kind),
    version: Number(version.version),
    versionId: String(version.id),
  };
}

async function getStoredApplication(params: StoreParams & { applicationId: string; draftId: string }) {
  const { data, error } = await params.supabase
    .from("video_composition_preset_applications")
    .select("expires_at, proposed_document, status")
    .eq("id", params.applicationId)
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (error) throw normalizePresetStorageError(error);
  if (!data || !PRESET_APPLICATION_STATUSES.includes(data.status as PresetApplicationStatus)) {
    throw new CompositionPresetStoreError("La aplicación del preset no existe.", "COMPOSITION_PRESET_APPLICATION_NOT_FOUND", 404);
  }
  return {
    expiresAt: String(data.expires_at),
    proposedDocument: data.proposed_document,
    status: data.status as PresetApplicationStatus,
  };
}

async function expirePendingCompositionPresetApplications(params: StoreParams & { draftId: string }) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("video_composition_preset_applications")
    .update({ status: "EXPIRED", updated_at: now })
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("status", "PENDING")
    .lt("expires_at", now);
  if (error) throw normalizePresetStorageError(error);
}

async function expireCompositionPresetApplication(params: StoreParams & { applicationId: string; draftId: string }) {
  const { error } = await params.supabase
    .from("video_composition_preset_applications")
    .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
    .eq("id", params.applicationId)
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("status", "PENDING");
  if (error) throw normalizePresetStorageError(error);
}

function parseOutcome(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof (row as { outcome?: unknown }).outcome !== "string") throw storageUnavailable();
  return (row as { outcome: string }).outcome;
}

function assertMutationOutcome(outcome: string, operation: "APPLY" | "UNDO") {
  if (operation === "APPLY" && (outcome === "APPLIED" || outcome === "ALREADY_APPLIED")) return;
  if (operation === "UNDO" && (outcome === "UNDONE" || outcome === "ALREADY_UNDONE")) return;
  if (outcome === "CONFLICT" || outcome === "UNDO_CONFLICT") {
    throw new CompositionPresetStoreError(
      operation === "UNDO"
        ? "La edición cambió después de aplicar el preset. Restaura la versión anterior desde el historial para no perder cambios nuevos."
        : "La edición cambió desde que se abrió el preview. Genera un preview nuevo.",
      "COMPOSITION_PRESET_VERSION_CONFLICT",
      409,
    );
  }
  if (outcome === "EXPIRED") throw new CompositionPresetStoreError("El preview expiró. Genera uno nuevo.", "COMPOSITION_PRESET_PREVIEW_EXPIRED", 410);
  if (outcome === "BUSY") throw new CompositionPresetStoreError("Ya hay otro cambio guardándose. Vuelve a intentar.", "COMPOSITION_PRESET_BUSY", 409, true);
  if (outcome === "NOT_EDITABLE") throw new CompositionPresetStoreError("El borrador ya no está disponible para edición.", "COMPOSITION_PRESET_NOT_EDITABLE", 409);
  throw new CompositionPresetStoreError("La aplicación del preset ya no está disponible.", "COMPOSITION_PRESET_APPLICATION_UNAVAILABLE", 409);
}

function hashPresetDefinition(definition: CompositionDynamicPresetDefinition) {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

function parseSourceKind(value: unknown): Exclude<CompositionPresetSourceKind, "SYSTEM"> {
  if (value === "INSTRUCTIONS" || value === "MANUAL") return value;
  throw new CompositionPresetStoreError("El preset almacenado tiene un origen inválido.", "COMPOSITION_PRESET_CORRUPT", 500);
}

function presetNotFound() {
  return new CompositionPresetStoreError("El preset no existe o no pertenece a esta empresa.", "COMPOSITION_PRESET_NOT_FOUND", 404);
}

function storageUnavailable() {
  return new CompositionPresetStoreError("El almacenamiento de presets aún no está disponible.", "COMPOSITION_PRESET_STORAGE_NOT_READY", 503, true);
}

function normalizePresetStorageError(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const code = String(candidate.code || "");
  const message = String(candidate.message || "");
  if (code === "PGRST202" || /Could not find the function|relation .* does not exist/i.test(message)) return storageUnavailable();
  if (code === "42501") return new CompositionPresetStoreError("No tienes permisos para administrar presets.", "COMPOSITION_PRESET_FORBIDDEN", 403);
  if (code === "22023") return new CompositionPresetStoreError("Los datos del preset no son válidos.", "COMPOSITION_PRESET_INVALID", 400);
  return error;
}

