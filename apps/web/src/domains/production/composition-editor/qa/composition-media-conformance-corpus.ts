import { createHash } from "node:crypto";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { createCorpusColorChart, createCorpusStereoAudio, CORPUS_AUDIO_DURATION_SECONDS } from "./composition-conformance-corpus-assets";
import { applyNarrativeConformanceRecipe } from "./composition-narrative-conformance-recipe";

export const MEDIA_CONFORMANCE_CORPUS_VERSION = 1;
export function listMediaConformanceCorpusRecipes() {
  return ["image-crop-contain", "image-crop-cover", "image-fit-contain", "image-fit-cover", "audio-split", "audio-trim",
    "audio-gain", "audio-fades", "audio-ducking", "audio-crossfade", "narrative-voice-extraction", "narrative-audiovisual-captions"] as const;
}

/** Source-native corpus: no fake video container and no implicit decoder approval. */
export function buildMediaConformanceCorpusCase(recipeId: string, fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]) {
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.includes(fps)) throw new Error("CONFORMANCE_CORPUS_FPS_INVALID");
  if (!listMediaConformanceCorpusRecipes().some((id) => id === recipeId)) throw new Error("CONFORMANCE_CORPUS_RECIPE_UNKNOWN");
  const narrative = recipeId.startsWith("narrative-");
  const audio = recipeId.startsWith("audio-") || narrative;
  const assets = audio ? [createCorpusStereoAudio("VOICE"), ...(["audio-ducking", "audio-crossfade"].includes(recipeId)
    ? [createCorpusStereoAudio("MUSIC")] : [])] : [createCorpusColorChart()];
  let document = createInitialCompositionDocument({animatedDeck: null,
    assets: assets.map((asset, index) => ({productionAssetId: asset.id, checksum: asset.checksum, fileSizeBytes: asset.bytes.length,
      mimeType: asset.mimeType, durationSeconds: CORPUS_AUDIO_DURATION_SECONDS, hasAudio: audio, publicUrl: null,
      storageBucket: "production-assets", storagePath: `corpus/${asset.id}`, timelineRole: audio ? (index === 0 ? "VOICE" : "AUDIO") : "BROLL",
      ...(!audio ? {sourceWidth: 1920, sourceHeight: 1080} : {})})),
    plan: {title: "CAP-027 media corpus", subtitle: recipeId, accentColor: "#38BDF8", durationSeconds: 8}});
  document.canvas.fps = fps; document.canvas.durationSeconds = 8; document.canvas.durationMode = "USER_EDITED";
  for (const clip of document.clips) {clip.startSeconds = 0; clip.durationSeconds = 8; clip.sourceOffsetSeconds = 0;}
  const primary = document.clips[0]!;
  if (!audio) {
    primary.layout = {...primary.layout, x: 300, y: 200, width: 1000, height: 500};
    if (recipeId.includes("crop")) primary.crop = {top: 70, right: 160, bottom: 90, left: 120};
    primary.mediaFit = recipeId.endsWith("contain") ? "CONTAIN" : "COVER";
  } else {
    document.audioMix.ducking.enabled = recipeId === "audio-ducking";
    const voiceTrack = document.tracks.find((track) => track.id === primary.trackId)!;
    voiceTrack.semanticRole = "VOICE";
    if (recipeId === "audio-gain") {primary.volume = 0.4; voiceTrack.volume = 0.6;}
    if (recipeId === "audio-fades") {primary.fadeInSeconds = 0.8; primary.fadeOutSeconds = 1.2;}
    if (recipeId === "audio-ducking") {
      primary.startSeconds = 2; primary.durationSeconds = 3; primary.sourceOffsetSeconds = 1;
      const music = document.clips[1]!;
      const musicTrack = document.tracks.find((track) => track.id === music.trackId)!;
      musicTrack.semanticRole = "MUSIC"; music.volume = 0.25;
      music.fadeInSeconds = 0.4; music.fadeOutSeconds = 0.8;
    }
    if (recipeId === "audio-crossfade") {
      primary.durationSeconds = 4.5; primary.fadeOutSeconds = 1;
      const incoming = document.clips[1]!;
      incoming.startSeconds = 3.5; incoming.durationSeconds = 4.5;
      incoming.sourceOffsetSeconds = 1; incoming.fadeInSeconds = 1;
      const incomingTrack = document.tracks.find((track) => track.id === incoming.trackId)!;
      incomingTrack.semanticRole = "MUSIC";
    }
  }
  if (recipeId === "audio-split") document = applyCompositionEditorPatches(document,
    [{type: "clip.split", clipId: primary.id, atSeconds: 3, newClipId: "corpus-derived", newHfId: "corpus-derived"}]);
  if (recipeId === "audio-trim") document = applyCompositionEditorPatches(document,
    [{type: "clip.trim", clipId: primary.id, startSeconds: 1, durationSeconds: 4, sourceOffsetSeconds: 1}]);
  if (narrative) document = applyNarrativeConformanceRecipe(document, assets[0]!, recipeId === "narrative-audiovisual-captions");
  document = compositionEditorDocumentSchema.parse(document);
  const identity = {corpusVersion: MEDIA_CONFORMANCE_CORPUS_VERSION, recipeId, fps, documentHash: hashCompositionDocument(document),
    assetHashes: assets.map(({id, checksum}) => ({id, checksum}))};
  return {...identity, document, assets, caseSha256: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    scope: "DETERMINISTIC_MEDIA_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE" as const};
}

export const MEDIA_CORPUS_REMAINING_REQUIREMENTS = ["VIDEO_DECODE_SPLIT_TRIM_HANDLES", "VIDEO_CROSSFADE_RENDER_MEASUREMENT",
  "BROWSER_AUDIO_CAPTURE_AND_ENCODER_CALIBRATION", "CODEC_COLOR_CONVERSION"] as const;
