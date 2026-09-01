import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createInitialCompositionDocument,
  reconcileCompositionDocument,
} from "../composition-editor/composition-document.factory";
import { CompositionDurationResolutionError } from "../composition-editor/composition-duration.service";
import {
  applyAndAppendCompositionDocumentPatches,
  CompositionDocumentConflictError,
  CompositionDocumentError,
  ensureInitialCompositionDocument,
  getCurrentCompositionDocument,
  hashCompositionDocument,
} from "../composition-editor/composition-document.service";
import { buildDeterministicPlan } from "./hyperframes-plan.service";
import {
  extractHyperframesAnimatedDeck,
  isAutomaticTimelineSourceAsset,
  listHyperframesSourceAssets,
} from "./hyperframes-source-asset.service";

const DRAFT_PROJECT_PREFIX = "video-composition-drafts";

export class HyperframesDraftError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type StudioProjectDescriptor = { draftId: string; projectId: string; version: number };

type DraftRow = {
  current_version: number;
  id: string;
  project_storage_bucket: string;
  project_storage_prefix: string;
};

/** Builds one atomic, server-only migration that preserves authored edits. */
export function buildProductionAssetReconciliationOperations(
  document: Parameters<typeof reconcileCompositionDocument>[0]["document"],
  assets: Parameters<typeof reconcileCompositionDocument>[0]["productionAssets"],
  deckDependencyAssetIds: Set<string> = new Set(),
  animatedDeck: Parameters<typeof reconcileCompositionDocument>[0]["animatedDeck"] = null,
) {
  const reconciled = reconcileCompositionDocument({
    animatedDeck,
    deckDependencyAssetIds,
    document,
    productionAssets: assets,
  });
  return reconciled.changed
    ? [{ document: reconciled.document, type: "document.reconcile" as const }]
    : [];
}

/**
 * Resolves the persistent project identity for the full visual editor.
 * The editor can use a temporary workspace, but Courseforge remains the source
 * of truth for this draft and its versioned files.
 */
export async function getOrCreateHyperframesDraft(params: {
  compositionId: string;
  organizationId: string;
  userId: string;
  supabase: SupabaseClient<any, "public", any>;
}): Promise<StudioProjectDescriptor> {
  const { data: composition, error: compositionError } = await params.supabase
    .from("video_compositions")
    .select("id")
    .eq("id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (compositionError) throw compositionError;
  if (!composition) throw new HyperframesDraftError("Composición de video no encontrada.", 404);

  const existing = await findActiveDraft(params);
  if (existing) return studioProjectDescriptor(existing.id, existing.current_version);

  const { data: created, error: createError } = await params.supabase
    .from("video_composition_drafts")
    .insert({
      composition_id: params.compositionId,
      last_changed_by: params.userId,
      organization_id: params.organizationId,
      project_storage_prefix: `${DRAFT_PROJECT_PREFIX}/${params.organizationId}/${params.compositionId}`,
      // The native document is the source of truth. An HTML file is compiled
      // only for a protected preview response and is never uploaded here.
      source_manifest: { documentFormat: "courseforge-composition-v1", version: 1 },
      state: "ACTIVE",
    })
    .select("id, current_version")
    .single();
  if (createError) {
    // A second editor may have initialized the same draft between our read and
    // insert. The database's unique constraint remains authoritative; recover
    // the winner instead of creating a duplicate workspace.
    if (createError.code === "23505") {
      const concurrentDraft = await findActiveDraft(params);
      if (concurrentDraft) return studioProjectDescriptor(concurrentDraft.id, concurrentDraft.current_version);
    }
    throw createError;
  }
  return studioProjectDescriptor(created.id, created.current_version);
}

/**
 * Initializes the native, versioned document exactly once. The preview compiles
 * it in memory, preserving the HTML deck without uploading a legacy index file.
 */
export async function initializeHyperframesDraft(params: {
  compositionId: string;
  organizationId: string;
  userId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const descriptor = await getOrCreateHyperframesDraft(params);
  const { data: draft, error: draftError } = await params.supabase
    .from("video_composition_drafts")
    .select("id, current_version, project_storage_bucket, project_storage_prefix")
    .eq("id", descriptor.draftId)
    .eq("organization_id", params.organizationId)
    .single();
  if (draftError) throw draftError;
  const typedDraft = draft as DraftRow;

  const { data: composition, error: compositionError } = await params.supabase
    .from("video_compositions")
    .select("name, material_component_id")
    .eq("id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .single();
  if (compositionError) throw compositionError;
  if (!composition.material_component_id) {
    throw new HyperframesDraftError("La composición no está asociada a un componente de material.");
  }

  const [{ data: component, error: componentError }, candidates] = await Promise.all([
    params.supabase
      .from("material_components")
      .select("assets")
      .eq("id", composition.material_component_id)
      .single(),
    listHyperframesSourceAssets({
      componentId: composition.material_component_id,
      organizationId: params.organizationId,
      supabase: params.supabase,
    }),
  ]);
  if (componentError) throw componentError;
  // Images referenced inside the deck remain part of that HTML source. They
  // must not become duplicate, user-editable image clips in the timeline.
  const assets = candidates
    .filter(isAutomaticTimelineSourceAsset)
    .map((asset) => ({
      checksum: asset.checksum,
      durationSeconds: asset.durationSeconds,
      fileSizeBytes: asset.fileSizeBytes,
      hasAudio: asset.hasAudio,
      label: typeof asset.metadata.asset_display_name === "string"
        ? `${asset.metadata.asset_display_name}${asset.timelineRole === "VOICE" ? " · Voz" : ""}`
        : asset.sceneOrder
          ? `${asset.timelineRole === "AVATAR" ? "Avatar" : "Voz"} · Escena ${asset.sceneOrder}`
          : typeof asset.metadata.file_name === "string" ? asset.metadata.file_name : undefined,
      mimeType: asset.mimeType,
      productionAssetId: asset.productionAssetId,
      publicUrl: null,
      sceneClipId: asset.sceneClipId,
      sceneOrder: asset.sceneOrder,
      sourceHeight: positiveMetadataDimension(asset.metadata.source_height),
      sourceWidth: positiveMetadataDimension(asset.metadata.source_width),
      storageBucket: "production-assets",
      storagePath: asset.storagePath,
      timelineRole: asset.timelineRole,
      timelineVariant: asset.timelineVariant,
    }));
  const deckDependencyAssetIds = new Set(candidates
    .filter((asset) => asset.sourceType === "DECK_DEPENDENCY")
    .map((asset) => asset.productionAssetId));
  const animatedDeck = extractHyperframesAnimatedDeck(component.assets);
  // A draft can predate a re-sync. Link assets on every initialization so an
  // older draft never hides assets that are already available in Production.
  if (candidates.length > 0) {
    const { error: assetLinkError } = await params.supabase
      .from("video_composition_draft_assets")
      .upsert(candidates.map((asset) => ({
        draft_id: typedDraft.id,
        organization_id: params.organizationId,
        production_asset_id: asset.productionAssetId,
        role: asset.timelineRole || inferAssetRole(asset.mimeType),
        source_reference: asset.sourceType,
      })), { onConflict: "draft_id,production_asset_id" });
    if (assetLinkError) throw assetLinkError;
  }
  const activeAssetIds = new Set(candidates.map((asset) => asset.productionAssetId));
  const { data: existingAssetLinks, error: existingAssetLinksError } = await params.supabase
    .from("video_composition_draft_assets")
    .select("production_asset_id")
    .eq("draft_id", typedDraft.id)
    .eq("organization_id", params.organizationId);
  if (existingAssetLinksError) throw existingAssetLinksError;
  const staleAssetIds = (existingAssetLinks || [])
    .map((link) => link.production_asset_id as string)
    .filter((assetId) => !activeAssetIds.has(assetId));
  if (staleAssetIds.length > 0) {
    const { error: staleAssetLinkError } = await params.supabase
      .from("video_composition_draft_assets")
      .delete()
      .eq("draft_id", typedDraft.id)
      .eq("organization_id", params.organizationId)
      .in("production_asset_id", staleAssetIds);
    if (staleAssetLinkError) throw staleAssetLinkError;
  }

  const persistedDocument = await loadOrCreateInitialDocument({
    animatedDeck,
    assets,
    compositionName: composition.name,
    deckDependencyAssetIds,
    draftId: typedDraft.id,
    organizationId: params.organizationId,
    supabase: params.supabase,
    userId: params.userId,
  });

  if (persistedDocument.created) {
    const { error: changeError } = await params.supabase
      .from("video_composition_draft_changes")
      .upsert({
        actor_id: params.userId,
        draft_id: typedDraft.id,
        metadata: { assetCount: assets.length, documentHash: hashCompositionDocument(persistedDocument.document), hasAnimatedDeck: Boolean(animatedDeck) },
        organization_id: params.organizationId,
        source: "SYSTEM",
        summary: "Documento inicial de la composición creado desde Producción.",
        version: persistedDocument.version,
      }, { onConflict: "draft_id,version" });
    if (changeError) throw changeError;
  }

  return { ...descriptor, initialized: persistedDocument.created, documentVersion: persistedDocument.version };
}

function positiveMetadataDimension(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16_384
    ? value
    : undefined;
}

async function loadOrCreateInitialDocument(params: {
  animatedDeck: ReturnType<typeof extractHyperframesAnimatedDeck>;
  assets: Parameters<typeof createInitialCompositionDocument>[0]["assets"];
  compositionName: string;
  deckDependencyAssetIds: Set<string>;
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
}) {
  try {
    const current = await getCurrentCompositionDocument(params);
    const operations = buildProductionAssetReconciliationOperations(
      current.document,
      params.assets,
      params.deckDependencyAssetIds,
      params.animatedDeck,
    );
    if (operations.length === 0) {
      return { created: false, document: current.document, version: current.version };
    }

    try {
      const updated = await applyAndAppendCompositionDocumentPatches({
        auditSource: "SYSTEM",
        draftId: params.draftId,
        expectedDocumentHash: current.documentHash,
        organizationId: params.organizationId,
        patch: {
          operations,
          source: "AGENT",
          summary: `Sincronizó ${operations.length} cambio(s) de assets desde Producción.`,
        },
        supabase: params.supabase,
        userId: params.userId,
      });
      return { created: false, document: updated.document, version: updated.version };
    } catch (error) {
      if (error instanceof CompositionDocumentConflictError) {
        const latest = await getCurrentCompositionDocument(params);
        return { created: false, document: latest.document, version: latest.version };
      }
      throw error;
    }
  } catch (error) {
    if (!(error instanceof CompositionDocumentError) || error.status !== 404) throw error;
  }

  const plan = buildDeterministicPlan({ assetCount: params.assets.length, title: params.compositionName });
  let document;
  try {
    document = createInitialCompositionDocument({
      animatedDeck: params.animatedDeck,
      assets: params.assets,
      plan,
    });
  } catch (error) {
    if (error instanceof CompositionDurationResolutionError) {
      throw new HyperframesDraftError(error.message, 422);
    }
    throw error;
  }
  return ensureInitialCompositionDocument({
    document,
    draftId: params.draftId,
    organizationId: params.organizationId,
    supabase: params.supabase,
    userId: params.userId,
  });
}

async function findActiveDraft(params: {
  compositionId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_composition_drafts")
    .select("id, current_version")
    .eq("composition_id", params.compositionId)
    .eq("organization_id", params.organizationId)
    .neq("state", "ARCHIVED")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Safe identifier exposed to the editor; it never contains a storage path. */
export function studioProjectDescriptor(draftId: string, version: number): StudioProjectDescriptor {
  if (!isUuid(draftId) || !Number.isInteger(version) || version < 1) {
    throw new HyperframesDraftError("Identidad de proyecto de edición inválida.");
  }
  return { draftId, projectId: draftId, version };
}

/** Shared guard for every future editor file route. */
export function assertSafeDraftRelativePath(relativePath: string) {
  const normalized = relativePath.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || normalized.includes("\0")) {
    throw new HyperframesDraftError("La ruta del proyecto de edición no es segura.");
  }
  return normalized;
}

/** Strong content version for optimistic file writes and conflict detection. */
export function contentVersion(content: Uint8Array | string) {
  return createHash("sha256").update(content).digest("hex");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function inferAssetRole(mimeType: string) {
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.startsWith("font/")) return "FONT";
  return "IMAGE";
}
