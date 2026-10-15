import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { COMPOSITION_TRANSITION_ALIGNMENTS } from "../composition-transition.types";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { VIDEO_CORPUS_FRAME_FILE_PATTERN, VIDEO_CORPUS_SOURCE_DURATION_SECONDS } from "./composition-video-corpus-frames";

export const VIDEO_CONFORMANCE_CORPUS_VERSION = 1;
export { VIDEO_CORPUS_SOURCE_DURATION_SECONDS } from "./composition-video-corpus-frames";
const sourceSchema = z.object({id: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024), durationSeconds: z.literal(VIDEO_CORPUS_SOURCE_DURATION_SECONDS),
  fps: z.union(NATIVE_CONFORMANCE_CORPUS_FPS.map((fps) => z.literal(fps))), width: z.literal(1920), height: z.literal(1080),
  hasAudio: z.literal(true), mimeType: z.literal("video/mp4")}).strict();
export type VideoCorpusSource = z.infer<typeof sourceSchema>;

/** Executable argv preparation only; the caller must hash/probe the real output. */
export function buildVideoCorpusEncodingArguments(input: {fps: number; frameDirectory: string; audioPath: string; outputPath: string}) {
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.some((fps) => fps === input.fps)) throw new Error("CONFORMANCE_CORPUS_FPS_INVALID");
  for (const path of [input.frameDirectory, input.audioPath, input.outputPath]) {
    if (!isAbsolute(path) || path.includes("\0") || /^(?:https?|file|data):/i.test(path)) throw new Error("CONFORMANCE_CORPUS_PATH_INVALID");
  }
  if (input.audioPath === input.outputPath || !/\.mp4$/i.test(input.outputPath)) throw new Error("CONFORMANCE_CORPUS_OUTPUT_INVALID");
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-n",
    "-framerate", String(input.fps), "-start_number", "0", "-i", join(input.frameDirectory, VIDEO_CORPUS_FRAME_FILE_PATTERN),
    "-protocol_whitelist", "file,pipe", "-i", input.audioPath,
    "-map", "0:v:0", "-map", "1:a:0", "-t", String(VIDEO_CORPUS_SOURCE_DURATION_SECONDS),
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", input.outputPath];
}

export function listVideoConformanceCorpusRecipes() {
  return ["video-split", "video-trim", "video-crop-contain", "video-crop-cover",
    ...COMPOSITION_TRANSITION_ALIGNMENTS.map((alignment) => `video-crossfade-${alignment.toLowerCase().replace(/_/g, "-")}`)];
}

/** Source metadata is a fixture input, not authentication or proof of its decoder. */
export function buildVideoConformanceCorpusCase(recipeId: string, sourceInput: VideoCorpusSource) {
  if (!listVideoConformanceCorpusRecipes().includes(recipeId)) throw new Error("CONFORMANCE_CORPUS_RECIPE_UNKNOWN");
  const source = sourceSchema.parse(sourceInput);
  let document = createInitialCompositionDocument({animatedDeck: null, assets: [{productionAssetId: source.id,
    checksum: source.checksum, fileSizeBytes: source.sizeBytes, durationSeconds: source.durationSeconds,
    sourceWidth: source.width, sourceHeight: source.height, hasAudio: source.hasAudio, mimeType: source.mimeType,
    publicUrl: null, storageBucket: "production-assets", storagePath: `corpus/${source.checksum}.mp4`, timelineRole: "BROLL"}],
    plan: {title: "CAP-027 video corpus", subtitle: recipeId, accentColor: "#38BDF8", durationSeconds: 8}});
  document.canvas.durationSeconds = 8; document.canvas.durationMode = "USER_EDITED"; document.canvas.fps = source.fps;
  document.audioMix.ducking.enabled = false;
  const clip = document.clips[0]!;
  clip.startSeconds = 0; clip.durationSeconds = 8; clip.sourceOffsetSeconds = 1; clip.volume = 0.8;
  if (recipeId === "video-trim") document = applyCompositionEditorPatches(document,
    [{type: "clip.trim", clipId: clip.id, startSeconds: 1, durationSeconds: 4, sourceOffsetSeconds: 2}]);
  if (recipeId === "video-split") document = applyCompositionEditorPatches(document,
    [{type: "clip.split", clipId: clip.id, atSeconds: 3, newClipId: "corpus-video-derived", newHfId: "corpus-video-derived"}]);
  if (recipeId.startsWith("video-crop-")) {
    clip.crop = {top: 70, right: 160, bottom: 90, left: 120};
    clip.mediaFit = recipeId.endsWith("contain") ? "CONTAIN" : "COVER";
    clip.layout = {...clip.layout, x: 200, y: 150, width: 1200, height: 650};
  }
  if (recipeId.startsWith("video-crossfade-")) {
    const alignment = COMPOSITION_TRANSITION_ALIGNMENTS.find((candidate) => recipeId.endsWith(candidate.toLowerCase().replace(/_/g, "-")))!;
    clip.durationSeconds = 4;
    document.clips.push({...structuredClone(clip), id: "corpus-video-incoming", hfId: "corpus-video-incoming", startSeconds: 4,
      sourceOffsetSeconds: 5, volume: 0.6});
    document.transitions = {schemaVersion: 1, items: [{id: "corpus-video-crossfade", type: "CROSS_DISSOLVE", fromClipId: clip.id,
      toClipId: "corpus-video-incoming", durationSeconds: 1, alignment, audioMode: "CROSSFADE", easing: "sine.inOut", origin: "USER"}]};
  }
  document = compositionEditorDocumentSchema.parse(document);
  const identity = {corpusVersion: VIDEO_CONFORMANCE_CORPUS_VERSION, recipeId, source, documentHash: hashCompositionDocument(document)};
  return {...identity, caseSha256: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), document,
    scope: "VIDEO_RECIPE_BOUND_TO_SUPPLIED_SOURCE_NOT_DECODE_OR_RENDER_EVIDENCE" as const};
}
