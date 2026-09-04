import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema, type CompositionClip, type CompositionEditorDocument, type CompositionTrack } from "./composition-document.types";

export type AssemblyBrandingAsset = {
  checksum: string;
  durationMilliseconds: number;
  id: string;
  hasAudio: boolean;
  kind: "INTRO" | "OUTRO";
  mimeType: string;
  name: string;
  storageBucket: string;
  storagePath: string;
  sourceHeight: number | null;
  sourceWidth: number | null;
};

export type ResolvedAssemblyBranding = {
  intro: AssemblyBrandingAsset | null;
  introSource: "ASSEMBLY_OVERRIDE" | "GENERATED" | "ORG_DEFAULT";
  outro: AssemblyBrandingAsset | null;
};

/** Resolves only approved, tenant-owned branding. No client-provided asset id is trusted. */
export async function resolveAssemblyBranding(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}): Promise<ResolvedAssemblyBranding> {
  const { data: draftBranding, error: draftError } = await params.supabase
    .from("video_composition_draft_branding")
    .select("intro_asset_id, intro_source, outro_asset_id")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (draftError) throw draftError;
  // Intros now belong to each video's Production assets. Preserve an explicit
  // historical draft intro, but never inject a global organization default.
  const usesDraftOverride = draftBranding?.intro_source === "ASSEMBLY_OVERRIDE" || draftBranding?.intro_source === "GENERATED";
  const introId = usesDraftOverride ? draftBranding?.intro_asset_id : null;
  // Outros are reusable corporate assets, selected explicitly per video.
  const outroId = draftBranding?.outro_asset_id || null;
  const ids = [introId, outroId].filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return { intro: null, introSource: "ORG_DEFAULT", outro: null };
  const { data, error } = await params.supabase
    .from("organization_assembly_assets")
    .select("id, kind, name, storage_bucket, storage_path, mime_type, duration_milliseconds, checksum, metadata")
    .eq("organization_id", params.organizationId)
    .eq("status", "APPROVED")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data || []).map((row) => [row.id as string, mapAsset(row)]));
  const intro = introId ? byId.get(introId) || null : null;
  const outro = outroId ? byId.get(outroId) || null : null;
  if (intro && intro.kind !== "INTRO") throw new Error("El asset configurado como intro tiene un tipo inválido.");
  if (outro && outro.kind !== "OUTRO") throw new Error("El asset configurado como outro tiene un tipo inválido.");
  return {
    intro,
    introSource: draftBranding?.intro_source === "ASSEMBLY_OVERRIDE" || draftBranding?.intro_source === "GENERATED"
      ? draftBranding.intro_source
      : "ORG_DEFAULT",
    outro,
  };
}

export function buildAssemblyBrandingSnapshot(asset: AssemblyBrandingAsset) {
  return {
    checksum: asset.checksum,
    duration_milliseconds: asset.durationMilliseconds,
    mime_type: asset.mimeType,
    name: asset.name,
    has_audio: asset.hasAudio,
    source_height: asset.sourceHeight,
    source_width: asset.sourceWidth,
    storage_bucket: asset.storageBucket,
    storage_path: asset.storagePath,
  };
}

/** Materializes the resolved branding as timeline clips without embedding media bytes. */
export function reconcileAssemblyBrandingDocument(
  document: CompositionEditorDocument,
  branding: ResolvedAssemblyBranding,
) {
  const previousBrandingIds = new Set(document.clips.flatMap((clip) => (
    clip.source.type === "ASSEMBLY_BRAND_ASSET" ? [clip.id] : []
  )));
  const content = document.clips.filter((clip) => !previousBrandingIds.has(clip.id));
  if (content.length === 0) throw new Error("La composición debe conservar contenido además del intro y outro.");
  const introDuration = branding.intro ? branding.intro.durationMilliseconds / 1_000 : 0;
  const outroDuration = branding.outro ? branding.outro.durationMilliseconds / 1_000 : 0;
  const currentContentStart = Math.min(...content.map((clip) => clip.startSeconds));
  const shift = roundSeconds(introDuration - currentContentStart);
  const shiftedContent = content.map((clip) => ({ ...clip, startSeconds: roundSeconds(clip.startSeconds + shift) }));
  const contentEnd = Math.max(...shiftedContent.map((clip) => clip.startSeconds + clip.durationSeconds));
  const track = resolveBrandingTrack(document);
  const occupiedIds = new Set(shiftedContent.flatMap((clip) => [clip.id, clip.hfId]));
  const clips: CompositionClip[] = [...shiftedContent];
  if (branding.intro) clips.push(buildBrandingClip({ asset: branding.intro, document, id: uniqueEditorId("assembly-intro", occupiedIds), placement: "INTRO", startSeconds: 0, trackId: track.id }));
  if (branding.outro) clips.push(buildBrandingClip({ asset: branding.outro, document, id: uniqueEditorId("assembly-outro", occupiedIds), placement: "OUTRO", startSeconds: roundSeconds(contentEnd), trackId: track.id }));
  const tracks = document.tracks.some((candidate) => candidate.id === track.id)
    ? document.tracks
    : [...document.tracks, track];
  return compositionEditorDocumentSchema.parse({
    ...document,
    canvas: { ...document.canvas, durationMode: "AUTO", durationSeconds: roundSeconds(contentEnd + outroDuration) },
    clips,
    motion: {
      ...document.motion,
      animations: document.motion.animations.filter((animation) => !previousBrandingIds.has(animation.target.clipId)),
    },
    tracks,
  });
}

function buildBrandingClip(params: { asset: AssemblyBrandingAsset; document: CompositionEditorDocument; id: string; placement: "INTRO" | "OUTRO"; startSeconds: number; trackId: string }): CompositionClip {
  const durationSeconds = roundSeconds(params.asset.durationMilliseconds / 1_000);
  return {
    durationSeconds,
    hidden: false,
    hfId: `${params.id}-media`,
    id: params.id,
    kind: "VIDEO",
    label: params.placement === "INTRO" ? `Intro · ${params.asset.name}` : `Outro · ${params.asset.name}`,
    layout: { height: params.document.canvas.height, opacity: 1, rotation: 0, width: params.document.canvas.width, x: 0, y: 0, zIndex: 10 },
    mediaFit: "COVER",
    source: {
      assemblyBrandAssetId: params.asset.id,
      hasAudio: params.asset.hasAudio,
      placement: params.placement,
      ...(params.asset.sourceHeight ? { sourceHeight: params.asset.sourceHeight } : {}),
      ...(params.asset.sourceWidth ? { sourceWidth: params.asset.sourceWidth } : {}),
      type: "ASSEMBLY_BRAND_ASSET",
    },
    sourceDurationSeconds: durationSeconds,
    sourceOffsetSeconds: 0,
    startSeconds: params.startSeconds,
    timingSource: "ESTIMATED",
    trackId: params.trackId,
    volume: params.asset.hasAudio ? 1 : 0,
  };
}

function resolveBrandingTrack(document: CompositionEditorDocument): CompositionTrack {
  const existing = document.tracks.find((track) => track.id === "assembly-branding");
  if (existing) return existing;
  if (document.tracks.length >= 32) {
    const visual = document.tracks.find((track) => track.kind === "VISUAL");
    if (!visual) throw new Error("La composición no tiene espacio para el track de intro y outro.");
    return visual;
  }
  return { id: "assembly-branding", kind: "VISUAL", label: "Intro / Outro", locked: false, order: Math.min(99, Math.max(...document.tracks.map((track) => track.order)) + 1), semanticRole: "VISUAL", volume: 1 };
}

function uniqueEditorId(base: string, occupied: Set<string>) {
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate) || occupied.has(`${candidate}-media`)) candidate = `${base}-${suffix++}`;
  occupied.add(candidate);
  occupied.add(`${candidate}-media`);
  return candidate;
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function mapAsset(row: Record<string, unknown>): AssemblyBrandingAsset {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  return {
    checksum: String(row.checksum),
    durationMilliseconds: Number(row.duration_milliseconds),
    id: String(row.id),
    hasAudio: metadata.has_audio === true,
    kind: row.kind === "OUTRO" ? "OUTRO" : "INTRO",
    mimeType: String(row.mime_type),
    name: String(row.name),
    storageBucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
    sourceHeight: readPositiveInteger(metadata.source_height),
    sourceWidth: readPositiveInteger(metadata.source_width),
  };
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
