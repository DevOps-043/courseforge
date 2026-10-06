import { createHash } from "node:crypto";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema, NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT, type CompositionEditorDocument } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { COMPOSITION_MOTION_PRESETS, createCompositionPresetAnimation } from "../composition-motion-preset.service";
import { COMPOSITION_TRANSITION_TYPES, COMPOSITION_TRANSITION_ALIGNMENTS, COMPOSITION_TRANSITION_DIRECTIONS,
  type CompositionTransition } from "../composition-transition.types";
import { parseCompositionCaptionImport } from "../composition-caption-import.service";
import { COMPOSITION_COLOR_GRADING_LIMITS } from "../composition-color-grading.types";
import { createCorpusColorChart } from "./composition-conformance-corpus-assets";
import { buildColorChartAuditPlan, hashColorChartAuditPlan } from "./composition-color-chart-audit";

export const NATIVE_CONFORMANCE_CORPUS_VERSION = 1;
export const NATIVE_CONFORMANCE_CORPUS_FPS = [24, 25, 30, 60] as const;
const DURATION_SECONDS = 8;
type NativeCorpusRecipe =
  | {id: string; category: "MOTION"; presetId: typeof COMPOSITION_MOTION_PRESETS[number]["id"]; variant: "DEFAULT" | "EXTREME"}
  | {id: string; category: "TRANSITION"; transitionType: CompositionTransition["type"]; alignment: CompositionTransition["alignment"]; direction?: typeof COMPOSITION_TRANSITION_DIRECTIONS[number]}
  | {id: string; category: "CAPTIONS"; variant: "SRT" | "VTT" | "KARAOKE" | "RTL" | "MULTI_BATCH"}
  | {id: string; category: "GEOMETRY"; variant: "ROTATION" | "OPACITY" | "OFF_CANVAS" | "PARTIAL_CLIP"}
  | {id: string; category: "COLOR"; variant: "NEUTRAL" | "MINIMUM" | "MAXIMUM"};

/** Catalog only: ready document recipes are not evidence of render parity. */
export function listNativeConformanceCorpusRecipes(): NativeCorpusRecipe[] {
  const recipes: NativeCorpusRecipe[] = [];
  for (const preset of COMPOSITION_MOTION_PRESETS) for (const variant of ["DEFAULT", "EXTREME"] as const)
    recipes.push({id: `motion-${preset.id.toLowerCase().replace(/_/g, "-")}-${variant.toLowerCase()}`, category: "MOTION", presetId: preset.id, variant});
  for (const transitionType of COMPOSITION_TRANSITION_TYPES) for (const alignment of COMPOSITION_TRANSITION_ALIGNMENTS) {
    const directions = transitionType === "PUSH" || transitionType === "SOFT_WIPE" ? COMPOSITION_TRANSITION_DIRECTIONS : [undefined];
    for (const direction of directions) recipes.push({id: `transition-${transitionType.toLowerCase().replace(/_/g, "-")}-${alignment.toLowerCase().replace(/_/g, "-")}${direction ? `-${direction.toLowerCase()}` : ""}`,
      category: "TRANSITION", transitionType, alignment, ...(direction ? {direction} : {})});
  }
  for (const variant of ["SRT", "VTT", "KARAOKE", "RTL", "MULTI_BATCH"] as const)
    recipes.push({id: `captions-${variant.toLowerCase().replace(/_/g, "-")}`, category: "CAPTIONS", variant});
  for (const variant of ["ROTATION", "OPACITY", "OFF_CANVAS", "PARTIAL_CLIP"] as const)
    recipes.push({id: `geometry-${variant.toLowerCase().replace(/_/g, "-")}`, category: "GEOMETRY", variant});
  for (const variant of ["NEUTRAL", "MINIMUM", "MAXIMUM"] as const)
    recipes.push({id: `color-${variant.toLowerCase()}`, category: "COLOR", variant});
  return recipes;
}

export function buildNativeConformanceCorpusCase(recipeId: string, fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]) {
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.includes(fps)) throw new Error("CONFORMANCE_CORPUS_FPS_INVALID");
  const recipe = listNativeConformanceCorpusRecipes().find((candidate) => candidate.id === recipeId);
  if (!recipe) throw new Error("CONFORMANCE_CORPUS_RECIPE_UNKNOWN");
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "CAP-027 native corpus", subtitle: recipe.id, accentColor: "#38BDF8", durationSeconds: DURATION_SECONDS}});
  document.canvas.durationSeconds = DURATION_SECONDS; document.canvas.fps = fps;
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const clip = addNativeClip(document, "corpus-primary", recipe.category === "CAPTIONS" ? "CAPTION" : "TEXT", 0, DURATION_SECONDS);
  const assets: Array<{id: string; checksum: string; mimeType: "image/svg+xml"; content: string}> = [];
  if (recipe.category === "MOTION") {
    document.motion.animations = [createCompositionPresetAnimation({animationId: "corpus-motion", clipId: clip.id, clipDurationSeconds: DURATION_SECONDS,
      presetId: recipe.presetId, origin: "PRESET", durationSeconds: recipe.variant === "EXTREME" ? 3.7 : 0.8,
      intensity: recipe.variant === "EXTREME" ? 2 : 1, cycleDurationSeconds: 1})];
  } else if (recipe.category === "TRANSITION") {
    clip.durationSeconds = 4;
    const incoming = addNativeClip(document, "corpus-incoming", "TEXT", 4, 4);
    if (incoming.source.type === "NATIVE_TEXT") incoming.source.text = "Incoming: B";
    document.transitions = {schemaVersion: 1, items: [{id: "corpus-transition", type: recipe.transitionType,
      fromClipId: clip.id, toClipId: incoming.id, durationSeconds: 1, alignment: recipe.alignment, audioMode: "CUT", easing: "sine.inOut", origin: "USER",
      parameters: recipe.transitionType === "DIP_TO_COLOR" ? {color: "#000000"} : recipe.direction ? {direction: recipe.direction}
        : recipe.transitionType === "BLUR_DISSOLVE" ? {blurPixels: 16} : undefined}]};
  } else if (recipe.category === "CAPTIONS") {
    if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("CONFORMANCE_CORPUS_CAPTION_SOURCE_INVALID");
    const source = clip.source;
    if (recipe.variant === "SRT" || recipe.variant === "VTT") {
      const srt = "1\n00:00:00,200 --> 00:00:01,200\nFirst cue\n\n2\n00:00:01,240 --> 00:00:03,020\nSecond cue";
      const content = recipe.variant === "SRT" ? srt : `WEBVTT\n\n${srt.replace(/,/g, ".")}`;
      source.cues = parseCompositionCaptionImport({content, fileName: `corpus.${recipe.variant.toLowerCase()}`, maxDurationSeconds: DURATION_SECONDS}).cues;
      source.origin = recipe.variant;
    } else if (recipe.variant === "MULTI_BATCH") {
      source.cues = Array.from({length: 30}, (_, index) => ({id: `cue-${index}`, startSeconds: index / 4, endSeconds: index / 4 + 0.2, text: `Cue ${index}`}));
    } else if (recipe.variant === "RTL") {
      source.language = "ar"; source.style.horizontalAlign = "RIGHT";
      source.cues = [{id: "rtl", startSeconds: 0.2, endSeconds: 3.02, text: "مرحبا بالعالم — 123"}];
    } else {
      source.cues = [{id: "karaoke", startSeconds: 0.2, endSeconds: 2.2, text: "First second", words: [
        {id: "first", text: "First", startSeconds: 0.2, endSeconds: 1.2}, {id: "second", text: "second", startSeconds: 1.2, endSeconds: 2.2}]}];
    }
  } else if (recipe.category === "GEOMETRY") {
    if (recipe.variant === "ROTATION") clip.layout.rotation = 37;
    if (recipe.variant === "OPACITY") clip.layout.opacity = 0.25;
    if (recipe.variant === "OFF_CANVAS") clip.layout.x = document.canvas.width + 50;
    if (recipe.variant === "PARTIAL_CLIP") clip.layout.x = -clip.layout.width / 2;
  } else {
    // Color grading is a media-only feature. Use actual bounded local SVG bytes,
    // never a pretend hash or an invalid grading field on a native text clip.
    const chart = createCorpusColorChart(), id = chart.id;
    assets.push({id, checksum: chart.checksum, mimeType: "image/svg+xml", content: chart.bytes.toString("utf8")});
    clip.kind = "IMAGE";
    clip.source = {type: "PRODUCTION_ASSET", productionAssetId: id, sourceWidth: 1920, sourceHeight: 1080};
    clip.layout = {...clip.layout, x: 0, y: 0, width: document.canvas.width, height: document.canvas.height};
    const limit = recipe.variant === "MINIMUM" ? "min" : "max";
    clip.colorGrading = {adjust: recipe.variant === "NEUTRAL" ? {contrast: 0, exposure: 0, saturation: 0}
      : {contrast: COMPOSITION_COLOR_GRADING_LIMITS.contrast[limit], exposure: COMPOSITION_COLOR_GRADING_LIMITS.exposure[limit], saturation: COMPOSITION_COLOR_GRADING_LIMITS.saturation[limit]}};
  }
  const validated = compositionEditorDocumentSchema.parse(document);
  const documentHash = hashCompositionDocument(validated);
  const colorAuditPlan = recipe.category === "COLOR" && recipe.variant === "NEUTRAL"
    ? buildColorChartAuditPlan(documentHash, assets[0]!.checksum) : undefined;
  const identity = {corpusVersion: NATIVE_CONFORMANCE_CORPUS_VERSION, recipe, fps, documentHash,
    assetHashes: assets.map(({id, checksum}) => ({id, checksum})),
    ...(colorAuditPlan ? {colorAuditPlanSha256: hashColorChartAuditPlan(colorAuditPlan)} : {})};
  return {...identity, caseSha256: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), document: validated, assets,
    ...(colorAuditPlan ? {colorAuditPlan} : {}),
    scope: "DETERMINISTIC_NATIVE_DOCUMENT_RECIPE_NOT_RENDER_EVIDENCE" as const};
}

function addNativeClip(document: CompositionEditorDocument, id: string, kind: "TEXT" | "CAPTION", startSeconds: number, durationSeconds: number) {
  const {clip, track} = createCompositionNativeOverlay({document, id, kind, playheadSeconds: startSeconds});
  if (track) document.tracks.push(track);
  clip.durationSeconds = durationSeconds;
  if (clip.source.type === "NATIVE_TEXT") clip.source.text = "Outgoing: A — Áé 123";
  if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") throw new Error("CONFORMANCE_CORPUS_NATIVE_SOURCE_INVALID");
  clip.source.style.shadowBlur = 0;
  document.clips.push(clip);
  return clip;
}

export const NATIVE_CORPUS_REMAINING_REQUIREMENTS = ["MEDIA_TIMING_SPLIT_TRIM", "MEDIA_CROP_FIT", "AUDIO_EDITORIAL",
  "CUSTOM_AND_SYSTEM_FONT_PROVENANCE", "SDR_COLOR_CONVERSION", "DECK_HTML_TEXT", "RENDERER_ENVIRONMENT_PROVENANCE"] as const;
