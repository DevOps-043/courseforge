import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { applyCompositionEditorPatches, CompositionEditorPatchError } from "./editor-patch.service";
import type { CompositionEditorPatchRequest } from "./editor-patch.types";

export class CompositionDocumentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export class CompositionDocumentConflictError extends CompositionDocumentError {
  constructor(readonly current: Awaited<ReturnType<typeof getCurrentCompositionDocument>>) {
    super("La composiciÃ³n cambiÃ³ en otra sesiÃ³n. Recarga el preview antes de volver a editar.", 409);
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
    documentHash: hashCompositionDocument(current.document),
    version: current.version,
  };
}

export function hashCompositionDocument(document: CompositionEditorDocument) {
  return createHash("sha256").update(stableStringify(document)).digest("hex");
}

export async function applyAndAppendCompositionDocumentPatches(params: {
  draftId: string;
  expectedDocumentHash: string;
  organizationId: string;
  patch: CompositionEditorPatchRequest;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  const current = await getCurrentCompositionDocument(params);
  if (current.documentHash !== params.expectedDocumentHash) throw new CompositionDocumentConflictError(current);

  let nextDocument: CompositionEditorDocument;
  try {
    nextDocument = applyCompositionEditorPatches(current.document, params.patch.operations);
  } catch (error) {
    if (error instanceof CompositionEditorPatchError) throw new CompositionDocumentError(error.message);
    throw error;
  }
  const nextHash = hashCompositionDocument(nextDocument);
  const { data, error } = await params.supabase.rpc("append_video_composition_draft_document", {
    p_actor_id: params.userId,
    p_document: nextDocument,
    p_document_hash: nextHash,
    p_draft_id: params.draftId,
    p_expected_document_hash: params.expectedDocumentHash,
    p_format: nextDocument.format,
    p_metadata: { operations: params.patch.operations.map((operation) => operation.type) },
    p_organization_id: params.organizationId,
    p_source: params.patch.source,
    p_summary: params.patch.summary,
  });

  if (error?.code === "40001" || error?.code === "23505") {
    throw new CompositionDocumentConflictError(await getCurrentCompositionDocument(params));
  }
  if (error) throw normalizeCompositionPersistenceError(error);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new CompositionDocumentError("No se pudo guardar la nueva versiÃ³n de la composiciÃ³n.", 500);
  return {
    document: nextDocument,
    documentHash: result.document_hash as string,
    version: result.version as number,
  };
}

function normalizeCompositionPersistenceError(error: unknown) {
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
    );
  }
  if (code === "42501") {
    return new CompositionDocumentPersistenceError(
      "No tienes permisos para guardar cambios en esta composici\u00f3n.",
      "COMPOSITION_SAVE_FORBIDDEN",
      403,
    );
  }
  if (code === "P0002") {
    return new CompositionDocumentPersistenceError(
      "El borrador ya no est\u00e1 disponible para edici\u00f3n.",
      "COMPOSITION_DRAFT_NOT_EDITABLE",
      409,
    );
  }
  if (code === "22023") {
    return new CompositionDocumentPersistenceError(
      "La versi\u00f3n o los datos de auditor\u00eda de la edici\u00f3n no son v\u00e1lidos.",
      "COMPOSITION_AUDIT_INVALID",
      400,
    );
  }
  if (code === "42702") {
    return new CompositionDocumentPersistenceError(
      "El almacenamiento versionado requiere una actualizaci\u00f3n de base de datos antes de poder guardar.",
      "COMPOSITION_STORAGE_MIGRATION_REQUIRED",
      503,
      true,
    );
  }
  return new CompositionDocumentPersistenceError(
    "No se pudo guardar la nueva versi\u00f3n de la composici\u00f3n.",
    "COMPOSITION_PERSISTENCE_FAILED",
    500,
    true,
  );
}

async function getLatestCompositionDocument(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_composition_draft_documents")
    .select("document, version")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { document: compositionEditorDocumentSchema.parse(data.document), version: data.version as number } : null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
