import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import { resolveCompositionCropInsets } from "./composition-visual-crop.service";
import {
  resolveCompositionPreviewAspectAnchor,
  resolveCompositionPreviewClipVolume,
  resolveCompositionPreviewMediaFit,
} from "./composition-preview-visual-state";

const hfIdSchema = z.string().trim().min(1).max(160);
const cropInsetsSchema = z.object({
  bottom: z.number().finite().min(0).max(8_192),
  left: z.number().finite().min(0).max(8_192),
  right: z.number().finite().min(0).max(8_192),
  top: z.number().finite().min(0).max(8_192),
}).strict();
const runtimeLayoutSchema = z.object({
  height: z.number().finite().positive().max(8_192),
  rotation: z.number().finite().min(-360).max(360),
  width: z.number().finite().positive().max(8_192),
  x: z.number().finite().min(-8_192).max(8_192),
  y: z.number().finite().min(-8_192).max(8_192),
  zIndex: z.number().int().min(0).max(10),
}).strict();

export const compositionPreviewVisualChangeSchema = z.object({
  aspectAnchor: z.enum(["BOTTOM_RIGHT", "CENTER"]).nullable().optional(),
  cropInsets: cropInsetsSchema.optional(),
  hfId: hfIdSchema,
  hidden: z.boolean().optional(),
  layout: runtimeLayoutSchema.optional(),
  mediaFit: z.enum(["CONTAIN", "COVER"]).optional(),
  volume: z.number().finite().min(0).max(1).optional(),
}).strict().refine((change) => Object.keys(change).some((key) => key !== "hfId"), "El patch visual está vacío.");

export const compositionPreviewVisualPatchSchema = z.object({
  changes: z.array(compositionPreviewVisualChangeSchema).min(1).max(100),
}).strict();

export type CompositionPreviewVisualChange = z.infer<typeof compositionPreviewVisualChangeSchema>;
export type CompositionPreviewVisualPatch = z.infer<typeof compositionPreviewVisualPatchSchema>;

/** Builds fully resolved runtime state; unsupported or ambiguous batches fail closed. */
export function buildCompositionPreviewVisualPatch(params: {
  document: CompositionEditorDocument;
  operations: CompositionEditorPatchOperation[];
}): CompositionPreviewVisualPatch | null {
  const changesByHfId = new Map<string, CompositionPreviewVisualChange>();
  const tracksById = new Map(params.document.tracks.map((track) => [track.id, track]));

  for (const operation of params.operations) {
    if (!("clipId" in operation)) return null;
    const clip = params.document.clips.find((candidate) => candidate.id === operation.clipId);
    if (!clip) return null;
    const track = tracksById.get(clip.trackId);
    const current = changesByHfId.get(clip.hfId) || { hfId: clip.hfId };

    if (operation.type === "clip.layout") {
      if (clip.kind === "AUDIO" || operation.layout.opacity !== undefined) return null;
      current.layout = {
        height: clip.layout.height,
        rotation: clip.layout.rotation,
        width: clip.layout.width,
        x: clip.layout.x,
        y: clip.layout.y,
        zIndex: clip.layout.zIndex,
      };
      current.cropInsets = resolveCompositionCropInsets(clip.crop, clip.layout);
    } else if (operation.type === "clip.crop") {
      if (clip.kind === "AUDIO") return null;
      current.cropInsets = resolveCompositionCropInsets(clip.crop, clip.layout);
    } else if (operation.type === "clip.media-fit") {
      if (clip.kind !== "IMAGE" && clip.kind !== "VIDEO") return null;
      current.mediaFit = resolveCompositionPreviewMediaFit(clip, track);
      current.aspectAnchor = resolveCompositionPreviewAspectAnchor(current.mediaFit, track);
    } else if (operation.type === "clip.visibility") {
      current.hidden = clip.hidden || Boolean(track?.hidden);
    } else if (operation.type === "clip.volume") {
      current.volume = resolveCompositionPreviewClipVolume(clip, track);
    } else {
      return null;
    }
    changesByHfId.set(clip.hfId, current);
  }

  const parsed = compositionPreviewVisualPatchSchema.safeParse({ changes: [...changesByHfId.values()] });
  return parsed.success ? parsed.data : null;
}
