import { z } from "zod";
import { COMPOSITION_COMPILATION_TARGETS } from "./composition-compilation.types";
import { renderCompositionClip, renderCompositionTransitionOverlays } from "./composition-clip-renderer.service";
import { compositionEditorDocumentSchema, getCompositionClipMediaAssetId, type CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionTimelineLayout } from "./composition-timeline-layout.service";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";
import { buildCompositionPreviewTimelineState, compositionPreviewTimelineStateSchema } from "./composition-preview-timeline-state";
import { compositionFontReferenceDetails } from "./composition-font-references";

const safeMediaUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
});

export const compositionPreviewScenePatchSchema = z.object({
  assetUrls: z.record(z.string().uuid(), safeMediaUrl),
  canvas: compositionEditorDocumentSchema.shape.canvas,
  nodes: z.array(z.object({
    deckSourceHfId: z.string().min(1).max(160).optional(),
    html: z.string().min(1).max(500_000),
  }).strict()).max(999),
  timeline: compositionPreviewTimelineStateSchema,
}).strict();

export type CompositionPreviewScenePatch = z.infer<typeof compositionPreviewScenePatchSchema>;

/** Browser-safe projection; no signing, persistence or server-only dependencies. */
export function buildCompositionPreviewScenePatch(params: {
  assetUrls: Map<string, string>;
  audioMetersEnabled: boolean;
  beforeDocument: CompositionEditorDocument;
  document: CompositionEditorDocument;
}): CompositionPreviewScenePatch | null {
  const { beforeDocument, document } = params;
  // Controlled HTML owns a compiled layout runtime and must retain its authority checks.
  if (beforeDocument.htmlEditing?.items.length || document.htmlEditing?.items.length) return null;
  // New CSS, deck HTML and organization fonts require the authenticated compiler.
  if (JSON.stringify(document.deckStyles) !== JSON.stringify(beforeDocument.deckStyles)) return null;
  try {
    const previousFonts = compositionFontReferenceDetails(beforeDocument);
    for (const [id, reference] of compositionFontReferenceDetails(document)) {
      if (JSON.stringify(previousFonts.get(id)) !== JSON.stringify(reference)) return null;
    }
  } catch {
    return null;
  }
  const deckSources = new Map(beforeDocument.clips.flatMap((clip) => (
    clip.source.type === "DECK_SLIDE" ? [[JSON.stringify(clip.source), clip.hfId] as const] : []
  )));

  try {
    const runtime = buildCompositionTransitionRuntime(document);
    const timeline = buildCompositionPreviewTimelineState(document, runtime);
    const automatedIds = new Set(timeline.volumeAutomations.map((automation) => automation.targetClipId));
    const layout = buildCompositionTimelineLayout(document);
    const tracks = new Map(document.tracks.map((track) => [track.id, track]));
    const placeholders = new Map(document.clips.flatMap((clip) => {
      const assetId = getCompositionClipMediaAssetId(clip);
      return assetId ? [[assetId, `courseforge-asset:${assetId}`] as const] : [];
    }));
    const nodes: CompositionPreviewScenePatch["nodes"] = [];
    for (const clip of [...document.clips].sort((a, b) => a.layout.zIndex - b.layout.zIndex || a.startSeconds - b.startSeconds)) {
      const deckSourceHfId = clip.source.type === "DECK_SLIDE" ? deckSources.get(JSON.stringify(clip.source)) : undefined;
      if (clip.source.type === "DECK_SLIDE" && !deckSourceHfId) return null;
      const renderClip = clip.source.type === "DECK_SLIDE"
        ? { ...clip, source: { ...clip.source, html: " " } }
        : clip;
      nodes.push({
        ...(deckSourceHfId ? { deckSourceHfId } : {}),
        html: renderCompositionClip(
          renderClip,
          clip.source.type === "DECK_SLIDE" ? {
            width: clip.source.sourceWidth || document.deckStyles?.sourceWidth || document.canvas.width,
            height: clip.source.sourceHeight || document.deckStyles?.sourceHeight || document.canvas.height,
          } : document.canvas,
          tracks.get(clip.trackId), undefined, placeholders, undefined,
          document.deckStyles?.appearance || "dark", COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW,
          layout.trackIndexByClipId.get(clip.id)!, layout.audioTrackIndexByClipId.get(clip.id),
          automatedIds.has(clip.id), runtime.clipWindowsById.get(clip.id), runtime.audioWindowsByClipId.get(clip.id),
          JSON.stringify, params.audioMetersEnabled,
        ),
      });
    }
    const overlays = renderCompositionTransitionOverlays(runtime.items);
    if (overlays) nodes.push({ html: overlays });
    const assetUrls = Object.fromEntries([...params.assetUrls].filter(([id, url]) => placeholders.has(id) && safeMediaUrl.safeParse(url).success));
    const result = compositionPreviewScenePatchSchema.safeParse({ assetUrls, canvas: document.canvas, nodes, timeline });
    return result.success ? result.data : null;
  } catch {
    // Unsupported projections retain the existing canonical rebuild fallback.
    return null;
  }
}
