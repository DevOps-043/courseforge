import { APP_CONFIG } from "../../../config/app";
import { buildCompositionPreviewTimelineState } from "./composition-preview-timeline-state";
import { renderCompositionTimelineInstaller } from "./composition-preview-timeline-runtime";
import { prepareCompositionPreviewScenePatch } from "./composition-preview-scene-runtime";
import { COMPOSITION_COMPILATION_TARGETS, CompositionPreviewCompilerError, CompositionPreviewDependencyError, type CompositionCompilationTarget } from "./composition-compilation.types";
export { COMPOSITION_COMPILATION_TARGETS, CompositionPreviewCompilerError, CompositionPreviewDependencyError, type CompositionCompilationTarget } from "./composition-compilation.types";
import { renderCompositionClip, renderCompositionTransitionOverlays, replaceCompositionAssetUrls } from "./composition-clip-renderer.service";
import { readFile } from "node:fs/promises";
import { compositionFontReferenceDetails } from "./composition-font-references";
import { googleFontFaceBindingSchema } from "../fonts/google-font-native-face.contract";
import { dirname, resolve } from "node:path";
import {
  COMPOSITION_COLOR_GRADING_RUNTIME_ARTIFACT,
  COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT,
  validateCompositionColorGradingRuntimeArtifact,
} from "./composition-color-grading-runtime.service";
import type { CompositionEditorDocument } from "./composition-document.types";
import { normalizeCompositionColorGrading, type CompositionColorGrading } from "./composition-color-grading.types";
import { COMPOSITION_TRANSITION_OVERLAY_Z_INDEX } from "./composition-transition-render-policy";
import { buildCompositionPlaybackVolumeAutomations } from "./composition-playback-audio-envelope";
import { buildCompositionTimelineLayout } from "./composition-timeline-layout.service";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "./composition-preview-protocol";
import { areCompositionAudioMetersEnabled, renderCompositionAudioMeterRuntime } from "./composition-audio-meter-runtime";
import { COMPOSITION_PREVIEW_MAX_GENERATION } from "./composition-preview-comparison";
import {
  normalizeAnimatedDeckAppearance,
  repairLegacyAnimatedDeckAppearanceSelectors,
} from "../animated-deck/animated-deck-appearance.service";
import type { CompositionCompiledFont } from "../fonts/organization-font.types";
import { prepareCompositionHtmlEditingDeckStyles } from "./composition-html-editing-deck-styles.server";
import { renderHtmlComputedLayoutRuntime } from "./composition-html-editing-layout-runtime";
import { renderCompositionCanvasSnapGeometry } from "./composition-canvas-snap-geometry";
import { resolveCompositionPreviewCanvasBounds } from "./composition-preview-viewport-geometry";
import { renderCompositionCanvasVisibleBounds } from "./composition-canvas-visible-bounds";
import { renderCompositionCanvasKeyboardSelection } from "./composition-canvas-keyboard-selection";
import { renderCompositionCanvasFocusContinuity } from "./composition-canvas-focus-continuity";
import { renderCompositionCanvasControlKeyboard } from "./composition-canvas-control-keyboard";
import { renderCompositionEditorShortcutBridge } from "./composition-editor-shortcut";
import { resolveCompositionDeckImageAliases } from "./composition-deck-image-aliases.server";
import {
  assertCompositionHtmlEditingIdsUnique,
  assertCompositionHtmlEditingResourcesLocal,
  compileCompositionHtmlEditingFragments,
  CompositionHtmlEditingCompilationError,
  type CompositionHtmlEditingCompilation,
} from "./composition-html-editing-compilation.server";
import {
  restoreCompositionHtmlEditingSnapshot, HtmlEditingSnapshotBundleError,
  type HtmlEditingFrozenCompilationInput,
} from "./composition-html-editing-snapshot-bundle.server";

export type CompositionPreviewCompilerDiagnostics = {
  colorGradingRuntime: "AVAILABLE" | "FALLBACK" | "NOT_REQUIRED";
};

export const COMPOSITION_PREVIEW_MEDIA_CONFIG = {
  bufferingTimeoutMs: 12_000,
  forcedSeekToleranceSeconds: 0.05,
  lookaheadSeconds: 15,
  maxPrimedMedia: 6,
  minimumReadyState: 2,
  seekToleranceSeconds: 0.35,
} as const;

type HfColorGradingSerializer = (grading: CompositionColorGrading) => string;
let hfColorGradingSerializerPromise: Promise<HfColorGradingSerializer> | null = null;
const importEsmModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<{ serializeHfColorGrading: HfColorGradingSerializer }>;

function loadHfColorGradingSerializer() {
  // The application build preserves the analyzable import below. The focused
  // test build emits CommonJS, while HyperFrames exposes this subpath as ESM
  // only, so its fallback keeps the same real package implementation in tests.
  hfColorGradingSerializerPromise ||= import("@hyperframes/core/color-grading")
    .catch(() => importEsmModule("@hyperframes/core/color-grading"))
    .then(({ serializeHfColorGrading }) => serializeHfColorGrading);
  return hfColorGradingSerializerPromise;
}

/**
 * Compiles the native document into an isolated, seekable review document.
 * The document is not persisted and never becomes the editable source of truth.
 */
export async function compileCompositionPreview(params: {
  assetVariableNames?: Map<string, string>;
  assetUrls: Map<string, string>;
  colorGradingRuntimeOverride?: string | null;
  deckAssetUrls?: Map<string, string>;
  document: CompositionEditorDocument;
  documentHash?: string;
  htmlEditingCompilation?: CompositionHtmlEditingCompilation;
  htmlEditingSnapshot?: HtmlEditingFrozenCompilationInput;
  fontAssets?: Map<string, CompositionCompiledFont>;
  onDiagnostics?: (diagnostics: CompositionPreviewCompilerDiagnostics) => void;
  previewGeneration?: number | null;
  audioMetersEnabled?: boolean;
  target?: CompositionCompilationTarget;
}) {
  let htmlEditingFragments: ReadonlyMap<string, string>;
  let htmlEditingDeckStyles: string | null = null;
  try {
    if (params.htmlEditingCompilation && params.htmlEditingSnapshot) throw new HtmlEditingSnapshotBundleError("INVALID_BUNDLE");
    const context = params.htmlEditingSnapshot ? restoreCompositionHtmlEditingSnapshot({ ...params.htmlEditingSnapshot,
      document: params.document, documentHash: params.documentHash }) : params.htmlEditingCompilation;
    htmlEditingFragments = compileCompositionHtmlEditingFragments({ ...params, context });
    if (htmlEditingFragments.size && context) {
      try {
        htmlEditingDeckStyles = prepareCompositionHtmlEditingDeckStyles({
          document: params.document, documentHash: context.documentHash, context, assetUrls: params.assetUrls});
      } catch {
        throw new CompositionPreviewCompilerError("La revisión HTML requiere recursos locales y CSS contextual estático admitido y aislado en toda la composición.");
      }
    }
  } catch (error) {
    if (error instanceof CompositionHtmlEditingCompilationError || error instanceof HtmlEditingSnapshotBundleError) {
      throw new CompositionPreviewCompilerError(`La compilación de revisiones HTML fue rechazada: ${error.code}. No se exportará el source original.`);
    }
    throw error;
  }
  if (params.previewGeneration !== undefined && params.previewGeneration !== null
    && (!Number.isInteger(params.previewGeneration)
      || params.previewGeneration < 0
      || params.previewGeneration > COMPOSITION_PREVIEW_MAX_GENERATION)) {
    throw new CompositionPreviewCompilerError("La generación del preview no es válida.");
  }
  const target = params.target || COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW;
  const isInteractivePreview = target === COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW;
  const audioMetersEnabled = isInteractivePreview && (params.audioMetersEnabled ?? areCompositionAudioMetersEnabled());
  const viewportBackground = isInteractivePreview ? "transparent" : "#020617";
  const animationRuntime = isInteractivePreview ? await readCompositionAnimationRuntime() : null;
  const { document } = params;
  const requiresColorGradingRuntime = isInteractivePreview
    && document.clips.some((clip) => clip.kind === "VIDEO" || clip.kind === "IMAGE");
  const colorGradingRuntime = requiresColorGradingRuntime
    ? params.colorGradingRuntimeOverride === undefined
      ? await readOptionalCompositionColorGradingRuntime()
      : params.colorGradingRuntimeOverride
    : null;
  const colorGradingRuntimeState = !requiresColorGradingRuntime
    ? "NOT_REQUIRED"
    : colorGradingRuntime
      ? "AVAILABLE"
      : "FALLBACK";
  params.onDiagnostics?.({ colorGradingRuntime: colorGradingRuntimeState });
  const serializeColorGrading = document.clips.some((clip) => normalizeCompositionColorGrading(clip.colorGrading))
    ? await loadHfColorGradingSerializer()
    : null;
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  let transitionRuntime: ReturnType<typeof buildCompositionTransitionRuntime>;
  try {
    transitionRuntime = buildCompositionTransitionRuntime(document);
  } catch (error) {
    throw new CompositionPreviewCompilerError(
      error instanceof Error ? error.message : "No se pudieron compilar las transiciones.",
    );
  }
  const timelineLayout = buildCompositionTimelineLayout(document);
  const volumeAutomations = buildCompositionPlaybackVolumeAutomations(document, transitionRuntime);
  const automatedClipIds = new Set(volumeAutomations.map((automation) => automation.targetClipId));
  const deckStyles = htmlEditingDeckStyles ?? (document.deckStyles
    ? `${document.deckStyles.fontUrls.map((url) => `@import url(${JSON.stringify(replaceCompositionAssetUrls(url, params.deckAssetUrls))});`).join("\n")}\n${replaceCompositionAssetUrls(repairLegacyAnimatedDeckAppearanceSelectors(document.deckStyles.css), params.deckAssetUrls)}`
    : "");
  const deckAppearance = normalizeAnimatedDeckAppearance(document.deckStyles?.appearance);
  const fontStyles = renderCompositionFontFaces(document, params.fontAssets);
  const clips = document.clips
    .slice()
    .sort((left, right) => left.layout.zIndex - right.layout.zIndex || left.startSeconds - right.startSeconds)
    .map((clip) => renderCompositionClip(
      clip,
      clip.source.type === "DECK_SLIDE" ? { width: clip.source.sourceWidth || document.deckStyles?.sourceWidth || document.canvas.width, height: clip.source.sourceHeight || document.deckStyles?.sourceHeight || document.canvas.height } : document.canvas,
      tracksById.get(clip.trackId),
      params.assetVariableNames,
      params.assetUrls,
      params.deckAssetUrls,
      deckAppearance,
      target,
      requireRuntimeTrackIndex(timelineLayout.trackIndexByClipId, clip.id),
      timelineLayout.audioTrackIndexByClipId.get(clip.id),
      automatedClipIds.has(clip.id),
      transitionRuntime.clipWindowsById.get(clip.id),
      transitionRuntime.audioWindowsByClipId.get(clip.id),
      serializeColorGrading,
      audioMetersEnabled,
      clip.source.type === "DECK_SLIDE"
        ? htmlEditingFragments.get(clip.id) ?? replaceCompositionAssetUrls(resolveCompositionDeckImageAliases(clip.source.html, params.assetUrls), params.deckAssetUrls)
        : undefined,
    ))
    .join("\n");
  if (htmlEditingFragments.size) {
    try { assertCompositionHtmlEditingResourcesLocal({ clipsHtml: clips, deckCss: deckStyles, assetUrls: params.assetUrls }); }
    catch {
      throw new CompositionPreviewCompilerError("La revisión HTML requiere recursos locales y contenido estático en toda la composición.");
    }
  }
  const transitionOverlays = renderCompositionTransitionOverlays(transitionRuntime.items);
  const html = `<!doctype html>
<html lang="es" data-color-grading-runtime="${colorGradingRuntimeState.toLowerCase()}"${renderHyperframesCompositionVariables(target, params.assetVariableNames)}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${document.canvas.width}, height=${document.canvas.height}" />
  <title>${escapeHtml(document.variables.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${viewportBackground}; }
    #composition-viewport { position: fixed; inset: 0; overflow: hidden; background: ${viewportBackground}; }
    #composition-root { --preview-scale: 1; --preview-user-scale: 1; --editor-control-scale: 1; --editor-outline-width: 3px; position: absolute; left: 50%; top: 50%; width: ${document.canvas.width}px; height: ${document.canvas.height}px; overflow: hidden; background: #020617; transform: translate(-50%, -50%) scale(calc(var(--preview-scale) * var(--preview-user-scale))); transform-origin: center; }
    .clip { position: absolute; inset: 0;${isInteractivePreview ? " pointer-events: none;" : ""} }
    .clip-content { position: absolute; overflow: hidden; transform-origin: top left;${isInteractivePreview ? " pointer-events: none;" : ""} visibility: hidden; }
    .motion-subject { position: relative; width: 100%; height: 100%; transform-origin: center;${isInteractivePreview ? " pointer-events: auto;" : ""} }
    ${isInteractivePreview ? `.clip-content[data-selected="true"]::after { content: ""; position: absolute; inset: var(--crop-top, 0px) var(--crop-right, 0px) var(--crop-bottom, 0px) var(--crop-left, 0px); border: var(--editor-outline-width) solid rgba(8,145,178,.9); box-shadow: 0 0 0 var(--editor-outline-width) rgba(255,255,255,.75), 0 0 18px rgba(34,211,238,.75); pointer-events: none; }
    .composition-editor-control { position: absolute; z-index: 2147483647; display: grid; width: 22px; height: 22px; padding: 0; place-items: center; border: 2px solid #fff; border-radius: 5px; color: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.65); cursor: pointer; pointer-events: auto; }
    .composition-move-handle { left: 0; top: 0; background: #0e7490; font: 700 15px/1 system-ui, sans-serif; cursor: move; transform: scale(var(--editor-control-scale)); transform-origin: top left; }
    .composition-resize-handle { right: 0; bottom: 0; background: #0891b2; font: 800 14px/1 system-ui, sans-serif; cursor: nwse-resize; transform: scale(var(--editor-control-scale)); transform-origin: bottom right; }
    .composition-selection-marquee { position: absolute; z-index: 2147483646; border: 2px solid rgba(34,211,238,.95); background: rgba(34,211,238,.16); box-shadow: 0 0 0 1px rgba(255,255,255,.5); pointer-events: none; }
    .composition-smart-guide { position: absolute; z-index: 2147483646; background: rgba(244,63,94,.95); box-shadow: 0 0 0 1px rgba(255,255,255,.65); pointer-events: none; }
    ${isInteractivePreview ? '#composition-root:focus-visible, [data-hf-id]:focus-visible { outline: var(--editor-outline-width) solid #22d3ee; outline-offset: -2px; }' : ""}
    .composition-smart-guide[data-axis="x"] { top: 0; bottom: 0; width: 1px; }
    .composition-smart-guide[data-axis="y"] { right: 0; left: 0; height: 1px; }
    .clip-content[data-crop-mode="true"] { cursor: grab; }
    .clip-content[data-crop-mode="true"]:active { cursor: grabbing; }
    .clip-content[data-crop-mode="true"]::before { content: ""; position: absolute; inset: var(--crop-top, 0px) var(--crop-right, 0px) var(--crop-bottom, 0px) var(--crop-left, 0px); z-index: 2147483645; pointer-events: none; background-image: linear-gradient(to right, transparent 33.1%, rgba(255,255,255,.7) 33.2%, rgba(255,255,255,.7) 33.5%, transparent 33.6%, transparent 66.4%, rgba(255,255,255,.7) 66.5%, rgba(255,255,255,.7) 66.8%, transparent 66.9%), linear-gradient(to bottom, transparent 33.1%, rgba(255,255,255,.7) 33.2%, rgba(255,255,255,.7) 33.5%, transparent 33.6%, transparent 66.4%, rgba(255,255,255,.7) 66.5%, rgba(255,255,255,.7) 66.8%, transparent 66.9%); box-shadow: 0 0 0 9999px rgba(2,6,23,.58), inset 0 0 0 var(--editor-outline-width) #f59e0b; }
    .composition-crop-handle { z-index: 2147483647; width: 14px; height: 14px; border-color: #fff; border-radius: 3px; background: #f59e0b; transform: translate(-50%, -50%) scale(var(--editor-control-scale)); transform-origin: center; }
    .composition-crop-handle[data-crop-edge="n"], .composition-crop-handle[data-crop-edge="s"] { width: 34px; height: 10px; cursor: ns-resize; }
    .composition-crop-handle[data-crop-edge="e"], .composition-crop-handle[data-crop-edge="w"] { width: 10px; height: 34px; cursor: ew-resize; }
    .composition-editor-grid { position: absolute; inset: 0; z-index: 2147483646; display: none; pointer-events: none; background-image: linear-gradient(to right, rgba(34,211,238,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,.18) 1px, transparent 1px), linear-gradient(to right, rgba(34,211,238,.38) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,.38) 1px, transparent 1px); background-size: 16px 16px, 16px 16px, 80px 80px, 80px 80px; box-shadow: inset 0 0 0 1px rgba(34,211,238,.5); }
    .composition-editor-grid[data-visible="true"] { display: block; }` : ""}
    .composition-media { width: 100%; height: 100%; object-fit: cover; display: block; filter: var(--courseforge-color-filter, none); }
    .clip-content[data-media-fit="CONTAIN"] .composition-media { object-fit: contain; }
    .composition-audio { display: none; }
    .composition-transition-overlay { position: absolute; inset: 0; z-index: ${COMPOSITION_TRANSITION_OVERLAY_Z_INDEX}; visibility: hidden; opacity: 0; pointer-events: none; }
    ${isInteractivePreview ? `.composition-audio-unlock { position: absolute; left: 50%; bottom: 28px; z-index: 2147483647; display: none; transform: translateX(-50%); border: 1px solid rgba(255,255,255,.55); border-radius: 999px; background: rgba(2,6,23,.92); color: #fff; padding: 12px 18px; font: 700 16px/1 system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.4); cursor: pointer; }
    .composition-audio-unlock[data-visible="true"] { display: block; }` : ""}
    .deck-content { overflow: hidden; }
    .deck-content .deck-shell, .deck-content .deck-stage, .deck-content .deck-stage > .slide { width: 100%; height: 100%; }
    ${fontStyles}
    ${deckStyles}
  </style>
</head>
<body>
  <div id="composition-viewport" data-composition-id="courseforge-composition" data-start="0" data-width="${document.canvas.width}" data-height="${document.canvas.height}" data-duration="${document.canvas.durationSeconds}" data-fps="${document.canvas.fps}">
    <div id="composition-root">
      ${clips}
      ${transitionOverlays}
      ${isInteractivePreview ? '<div id="composition-editor-grid" class="composition-editor-grid" aria-hidden="true"></div>' : ""}
    </div>
    ${isInteractivePreview ? '<button id="composition-audio-unlock" class="composition-audio-unlock" type="button">Activar audio y reproducir</button>' : ""}
  </div>
  ${animationRuntime ? `<script>${animationRuntime}</script>` : '<script src="assets/gsap.min.js"></script>'}
  ${colorGradingRuntime ? `<script>${colorGradingRuntime}</script>` : ""}
  ${renderHtmlComputedLayoutRuntime(htmlEditingFragments)}
  ${renderCompositionTimelineInstaller(buildCompositionPreviewTimelineState(document, transitionRuntime))}
  ${isInteractivePreview ? renderInteractivePreviewController(document, params.documentHash, params.previewGeneration, audioMetersEnabled, htmlEditingFragments.size > 0) : ""}
</body>
</html>`;
  if (htmlEditingFragments.size) {
    try { assertCompositionHtmlEditingIdsUnique(html); }
    catch {
      throw new CompositionPreviewCompilerError("La revisión HTML contiene IDs duplicados en la composición final.");
    }
  }
  return html;
}

function renderHyperframesCompositionVariables(
  target: CompositionCompilationTarget,
  assetVariableNames: Map<string, string> | undefined,
) {
  if (target !== COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER || !assetVariableNames?.size) return "";
  const declarations = [...assetVariableNames.values()].map((name) => ({
    default: "",
    id: name,
    label: `${APP_CONFIG.name} remote asset`,
    type: "string",
  }));
  return ` data-composition-variables='${escapeAttribute(JSON.stringify(declarations))}'`;
}

function renderInteractivePreviewController(document: CompositionEditorDocument, documentHash?: string, previewGeneration?: number | null, audioMetersEnabled = false, htmlLayoutRequired = false) {
  return `<script>
    (() => {
      const root = document.getElementById("composition-root");
      const viewport = document.getElementById("composition-viewport");
      const audioUnlock = document.getElementById("composition-audio-unlock");
      const editorGrid = document.getElementById("composition-editor-grid");
      let timeline = window.__timelines["courseforge-composition"];
      let editingEnabled = true;
      let cropEnabled = false;
      let snapEnabled = true;
      let previewUserScale = 1;
      let selectedHfId = null;
      let selectedHfIds = new Set();
      let activeTransform = null;
      let activeMarquee = null;
      let suppressNextClick = false;
      let aspectCorrectionTimer = null;
      let playbackTimer = null;
      let playbackActive = false;
      let playbackIntent = false;
      let bufferingTargetTime = null;
      let bufferingTimeout = null;
      let bufferingStartedAt = null;
      let bufferingMediaIds = [];
      let playRequestedAt = null;
      let currentTime = 0;
      const deterministicWaapiAnimations = new Set();
      const deterministicWaapiOrigins = new WeakMap();
      const previewStartedAt = performance.now();
      const previewGeneration = ${JSON.stringify(previewGeneration ?? null)};
      const postParentMessage = (message) => window.parent.postMessage({
        ...message,
        previewGeneration,
        protocolVersion: ${COMPOSITION_PREVIEW_PROTOCOL_VERSION},
      }, "*");
      const activeMedia = new Set();
      ${renderCompositionAudioMeterRuntime(audioMetersEnabled)}
      // Remote previews cannot eagerly download the whole composition. Warm a
      // bounded forward window and hold the transport at the last valid frame
      // whenever active media has not decoded its current frame. Browsers may
      // keep paused remote media at HAVE_CURRENT_DATA indefinitely even though
      // it is already safe to start and can report a later waiting event.
      const primedMedia = new WeakSet();
      const measuredMediaWarmup = new WeakSet();
      const mediaWarmupStartedAt = new WeakMap();
      const MEDIA_LOOKAHEAD_SECONDS = ${COMPOSITION_PREVIEW_MEDIA_CONFIG.lookaheadSeconds};
      const MAX_PRIMED_MEDIA = ${COMPOSITION_PREVIEW_MEDIA_CONFIG.maxPrimedMedia};
      const MEDIA_MINIMUM_READY_STATE = ${COMPOSITION_PREVIEW_MEDIA_CONFIG.minimumReadyState};
      const MEDIA_BUFFERING_TIMEOUT_MS = ${COMPOSITION_PREVIEW_MEDIA_CONFIG.bufferingTimeoutMs};
      const MEDIA_FORCED_SEEK_TOLERANCE_SECONDS = ${COMPOSITION_PREVIEW_MEDIA_CONFIG.forcedSeekToleranceSeconds};
      const MEDIA_SEEK_TOLERANCE_SECONDS = ${COMPOSITION_PREVIEW_MEDIA_CONFIG.seekToleranceSeconds};
      let initialMediaReady = false;
      const htmlLayoutRequired = ${htmlLayoutRequired};
      const htmlLayout = htmlLayoutRequired ? window.__courseforgeHtmlLayout : null;
      let htmlLayoutFailureReported = false;
      let lastPrimeTime = Number.NEGATIVE_INFINITY;
      // Browser autoplay policy may reject audible media in the sandboxed iframe.
      // That is an audio-permission issue, not a transport failure: the muted
      // video and the composition clock must keep running.
      const blockedAudioMedia = new Set();
      const pendingMediaPlayback = new WeakMap();
      const reportedMediaErrors = new WeakSet();
      let duration = ${document.canvas.durationSeconds};
      const compiledDocumentHash = ${JSON.stringify(documentHash || null)};
      let canvasWidth = ${document.canvas.width};
      let canvasHeight = ${document.canvas.height};
      const pendingAspectCorrections = new Map();
      const readCrop = (target) => ({
        bottom: Number(target.dataset.cropBottom || 0),
        left: Number(target.dataset.cropLeft || 0),
        right: Number(target.dataset.cropRight || 0),
        top: Number(target.dataset.cropTop || 0),
      });
      const normalizeCrop = (crop, layout) => {
        const left = Math.max(0, Math.min(layout.width - 1, Number(crop.left) || 0));
        const right = Math.max(0, Math.min(layout.width - left - 1, Number(crop.right) || 0));
        const top = Math.max(0, Math.min(layout.height - 1, Number(crop.top) || 0));
        const bottom = Math.max(0, Math.min(layout.height - top - 1, Number(crop.bottom) || 0));
        return { bottom, left, right, top };
      };
      const applyCrop = (target, requestedCrop, lift = target.dataset.cropMode === "true") => {
        const subject = target.querySelector('.motion-subject');
        if (!subject || !(subject instanceof HTMLElement)) return;
        const layout = { height: Number.parseFloat(target.style.height), width: Number.parseFloat(target.style.width) };
        const crop = normalizeCrop(requestedCrop, layout);
        target.dataset.cropTop = String(crop.top);
        target.dataset.cropRight = String(crop.right);
        target.dataset.cropBottom = String(crop.bottom);
        target.dataset.cropLeft = String(crop.left);
        target.style.setProperty("--crop-top", crop.top + "px");
        target.style.setProperty("--crop-right", crop.right + "px");
        target.style.setProperty("--crop-bottom", crop.bottom + "px");
        target.style.setProperty("--crop-left", crop.left + "px");
        subject.style.clipPath = lift ? "none" : "inset(" + crop.top + "px " + crop.right + "px " + crop.bottom + "px " + crop.left + "px)";
        const visibleWidth = layout.width - crop.left - crop.right;
        const visibleHeight = layout.height - crop.top - crop.bottom;
        target.querySelectorAll('.composition-crop-handle').forEach((handle) => {
          if (!(handle instanceof HTMLElement)) return;
          const edge = handle.dataset.cropEdge;
          if (edge === "n" || edge === "s") {
            handle.style.left = crop.left + visibleWidth / 2 + "px";
            handle.style.top = (edge === "n" ? crop.top : layout.height - crop.bottom) + "px";
          } else {
            handle.style.left = (edge === "w" ? crop.left : layout.width - crop.right) + "px";
            handle.style.top = crop.top + visibleHeight / 2 + "px";
          }
        });
        const moveHandle = target.querySelector('.composition-move-handle');
        if (moveHandle instanceof HTMLElement) {
          moveHandle.style.left = crop.left + "px";
          moveHandle.style.top = crop.top + "px";
        }
        const resizeHandle = target.querySelector('.composition-resize-handle');
        if (resizeHandle instanceof HTMLElement) {
          resizeHandle.style.right = crop.right + "px";
          resizeHandle.style.bottom = crop.bottom + "px";
        }
      };
      const commitCrop = (target) => {
        const hfId = target?.dataset?.hfId;
        if (!hfId) return;
        postParentMessage({
          type: "courseforge-composition-crop-commit",
          hfId,
          crop: readCrop(target),
        });
      };
      const adjustCropFromHandle = (crop, layout, edge, dx, dy) => {
        const next = { ...crop };
        if (edge === "w") next.left = crop.left + dx;
        if (edge === "e") next.right = crop.right - dx;
        if (edge === "n") next.top = crop.top + dy;
        if (edge === "s") next.bottom = crop.bottom - dy;
        return normalizeCrop(next, layout);
      };
      const moveCropWindow = (crop, layout, dx, dy) => {
        const horizontalCrop = crop.left + crop.right;
        const verticalCrop = crop.top + crop.bottom;
        const left = Math.max(0, Math.min(horizontalCrop, crop.left + dx));
        const top = Math.max(0, Math.min(verticalCrop, crop.top + dy));
        return normalizeCrop({ left, right: horizontalCrop - left, top, bottom: verticalCrop - top }, layout);
      };
      const scaleCropForLayout = (crop, previousLayout, nextLayout) => normalizeCrop({
        bottom: crop.bottom * nextLayout.height / previousLayout.height,
        left: crop.left * nextLayout.width / previousLayout.width,
        right: crop.right * nextLayout.width / previousLayout.width,
        top: crop.top * nextLayout.height / previousLayout.height,
      }, nextLayout);
      const resolvePreviewCanvasBounds = (${resolveCompositionPreviewCanvasBounds.toString()});
      const fitCompositionToViewport = () => {
        if (!root || !viewport) return;
        const bounds = resolvePreviewCanvasBounds({ canvasWidth: canvasWidth, canvasHeight: canvasHeight, viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight, zoom: previewUserScale });
        if (!bounds) return;
        const renderedScale = bounds.scale;
        const safeScale = renderedScale / previewUserScale;
        root.style.setProperty("--preview-scale", String(safeScale));
        root.style.setProperty("--preview-user-scale", String(previewUserScale));
        root.style.setProperty("--editor-control-scale", String(1 / renderedScale));
        root.style.setProperty("--editor-outline-width", (2 / renderedScale) + "px");
      };
      const mediaIdentity = (media) => media.id || media.closest("[data-hf-id]")?.dataset.hfId || media.tagName.toLowerCase();
      const emitMediaMetric = (name, startedAt, mediaIds = []) => {
        if (!Number.isFinite(startedAt)) return;
        postParentMessage({
          type: "courseforge-composition-media-metric",
          metric: {
            atSeconds: Math.max(0, currentTime),
            durationMs: Math.max(0, Math.min(120000, performance.now() - startedAt)),
            mediaIds: mediaIds.slice(0, 6),
            name,
          },
        });
      };
      const completePlayStartLatency = () => {
        if (playRequestedAt === null) return;
        emitMediaMetric("play_start_latency_ms", playRequestedAt, [...activeMedia].map(mediaIdentity));
        playRequestedAt = null;
      };
      const timedMedia = () => Array.from(document.querySelectorAll("video[data-start], audio[data-start]"));
      const mediaStart = (media) => Number(media.dataset.start || 0);
      const mediaRate = (media) => Number(media.dataset.playbackRate || 1);
      const mediaEnd = (media) => mediaStart(media) + Number(media.dataset.duration || 0);
      const mediaParticipatesInPlayback = (media) => media.tagName !== "AUDIO"
        || media.dataset.volumeAutomated === "true"
        || Number(media.dataset.volume || 0) > 0;
      const mediaIsAvailable = (media) => media.dataset.clipHidden !== "true" && !media.error;
      const mediaIsActiveAt = (media, time) => mediaIsAvailable(media)
        && mediaParticipatesInPlayback(media)
        && time >= mediaStart(media)
        && time < mediaEnd(media);
      const mediaHasPlayableData = (media) => !media.error && media.readyState >= MEDIA_MINIMUM_READY_STATE;
      const pendingMediaAt = (time) => timedMedia().filter((media) => mediaIsActiveAt(media, time) && !mediaHasPlayableData(media));
      const seekPrimedMediaToEntryPoint = (media, time) => {
        if (media.readyState < 1 || (playbackActive && mediaIsActiveAt(media, time))) return;
        const start = mediaStart(media);
        const sourceOffset = Number(media.dataset.sourceOffset || 0);
        const timelineTarget = Math.max(time, start);
        const rawSourceTime = Math.max(0, sourceOffset + (timelineTarget - start) * mediaRate(media));
        const sourceTime = media.loop && Number.isFinite(media.duration) && media.duration > 0
          ? rawSourceTime % media.duration
          : rawSourceTime;
        if (Math.abs(media.currentTime - sourceTime) <= 0.35) return;
        try { media.currentTime = sourceTime; } catch (error) { reportMediaError(media, error); }
      };
      const postMediaState = (state, pending = []) => {
        postParentMessage({
          type: "courseforge-composition-media-state",
          state,
          pendingMediaIds: pending.map(mediaIdentity),
        });
      };
      const primeMediaForTime = (time, force = false) => {
        if (!force && Math.abs(time - lastPrimeTime) < 1) return;
        lastPrimeTime = time;
        const lookaheadEnd = Math.min(duration, time + MEDIA_LOOKAHEAD_SECONDS);
        const candidates = timedMedia()
          .filter((media) => mediaIsAvailable(media)
            && mediaParticipatesInPlayback(media)
            && mediaEnd(media) > time
            && mediaStart(media) <= lookaheadEnd)
          .sort((left, right) => {
            const activeDelta = Number(mediaIsActiveAt(right, time)) - Number(mediaIsActiveAt(left, time));
            return activeDelta || mediaStart(left) - mediaStart(right);
          })
          .slice(0, MAX_PRIMED_MEDIA);
        candidates.forEach((media) => {
          if (media.preload !== "auto") media.preload = "auto";
          seekPrimedMediaToEntryPoint(media, time);
          if (primedMedia.has(media) || media.readyState >= MEDIA_MINIMUM_READY_STATE) return;
          primedMedia.add(media);
          mediaWarmupStartedAt.set(media, performance.now());
          try { media.load(); } catch (error) { reportMediaError(media, error); }
        });
      };
      const admitHtmlLayout = () => {
        if (!htmlLayoutRequired) return true;
        try {
          if (!htmlLayout) throw new Error("HTML_LAYOUT_RUNTIME_MISSING");
          if (htmlLayout.getState() === "PENDING") return false;
          htmlLayout.assert(); return true;
        }
        catch {
          root?.setAttribute("data-preview-ready", "false");
          initialMediaReady = false;
          pause();
          if (!htmlLayoutFailureReported) {
            htmlLayoutFailureReported = true;
            postParentMessage({ type: "courseforge-composition-load-error", code: "COMPILATION_FAILED", documentHash: compiledDocumentHash, previewGeneration });
          }
          return false;
        }
      };
      const announceInitialReadyIfPossible = () => {
        if (!admitHtmlLayout()) return false;
        if (initialMediaReady) return true;
        const pending = pendingMediaAt(currentTime);
        if (pending.length > 0) {
          postMediaState("PREPARING", pending);
          return false;
        }
        initialMediaReady = true;
        root?.setAttribute("data-preview-ready", "true");
        emitMediaMetric("preview_initial_ready_ms", previewStartedAt, [...activeMedia].map(mediaIdentity));
        postMediaState("READY");
        postParentMessage({ type: "courseforge-composition-ready", documentHash: compiledDocumentHash, duration, previewGeneration, selectedHfId });
        return true;
      };
      const queueAspectCorrection = (target, layout) => {
        const hfId = target.dataset.hfId;
        if (!hfId) return;
        pendingAspectCorrections.set(hfId, { hfId, layout });
        if (aspectCorrectionTimer) window.clearTimeout(aspectCorrectionTimer);
        aspectCorrectionTimer = window.setTimeout(() => {
          const corrections = [...pendingAspectCorrections.values()];
          pendingAspectCorrections.clear();
          aspectCorrectionTimer = null;
          if (corrections.length > 0) {
            postParentMessage({ type: "courseforge-composition-aspect-corrections", corrections });
          }
        }, 50);
      };
      const preserveDefaultMediaAspect = (media) => {
        const target = media.closest('.clip-content[data-preserve-aspect]');
        if (!target || !(target instanceof HTMLElement)) return;
        const sourceWidth = Number(media.videoWidth || media.naturalWidth || 0);
        const sourceHeight = Number(media.videoHeight || media.naturalHeight || 0);
        if (sourceWidth <= 0 || sourceHeight <= 0) return;
        const layout = {
          height: Number.parseFloat(target.style.height),
          width: Number.parseFloat(target.style.width),
          x: Number.parseFloat(target.style.left),
          y: Number.parseFloat(target.style.top),
        };
        if (Object.values(layout).some((value) => !Number.isFinite(value))) return;
        const legacyWidth = Math.round(canvasWidth * .32);
        const legacyHeight = Math.round(canvasHeight * .65);
        const usesLegacyAvatarBox = target.dataset.preserveAspect === "BOTTOM_RIGHT"
          && Math.abs(layout.width - legacyWidth) <= 2
          && Math.abs(layout.height - legacyHeight) <= 2
          && Math.abs(layout.x - (canvasWidth - legacyWidth - 48)) <= 2
          && Math.abs(layout.y - (canvasHeight - legacyHeight - 48)) <= 2;
        const usesDefaultBrollBox = target.dataset.preserveAspect === "CENTER"
          && Math.abs(layout.width - canvasWidth) <= 2
          && Math.abs(layout.height - canvasHeight) <= 2
          && Math.abs(layout.x) <= 2
          && Math.abs(layout.y) <= 2;
        if (!usesLegacyAvatarBox && !usesDefaultBrollBox) return;
        const sourceRatio = sourceWidth / sourceHeight;
        const layoutRatio = layout.width / layout.height;
        if (Math.abs(sourceRatio - layoutRatio) <= .01) return;
        const width = sourceRatio >= layoutRatio ? layout.width : Math.round(layout.height * sourceRatio);
        const height = sourceRatio >= layoutRatio ? Math.round(layout.width / sourceRatio) : layout.height;
        const correctedLayout = {
          height,
          width,
          x: usesLegacyAvatarBox
            ? layout.x + layout.width - width
            : layout.x + Math.round((layout.width - width) / 2),
          y: usesLegacyAvatarBox
            ? layout.y + layout.height - height
            : layout.y + Math.round((layout.height - height) / 2),
        };
        Object.assign(target.style, {
          height: correctedLayout.height + "px",
          left: correctedLayout.x + "px",
          top: correctedLayout.y + "px",
          width: correctedLayout.width + "px",
        });
        queueAspectCorrection(target, correctedLayout);
      };
      const reportMediaError = (media, error) => {
        if (reportedMediaErrors.has(media)) return;
        reportedMediaErrors.add(media);
        const code = error?.name || (media.error ? "MEDIA_ERROR_" + media.error.code : "MEDIA_PLAYBACK_ERROR");
        const message = error?.message || media.error?.message || "El navegador no pudo reproducir este medio.";
        postParentMessage({
          type: "courseforge-composition-media-error",
          code,
          mediaId: mediaIdentity(media),
          message,
        });
      };
      const handleMediaPlaybackFailure = (media, error) => {
        if (error?.name === "AbortError") return;
        reportMediaError(media, error);
        if (error?.name !== "NotAllowedError" || media.tagName !== "AUDIO") return;
        blockedAudioMedia.add(media);
        if (audioUnlock) audioUnlock.dataset.visible = "true";
      };
      const requestMediaPlayback = (media) => {
        if (!playbackActive || !media.paused || pendingMediaPlayback.has(media) || blockedAudioMedia.has(media)) return;
        let playRequest;
        try {
          playRequest = media.play();
        } catch (error) {
          handleMediaPlaybackFailure(media, error);
          return;
        }
        if (!playRequest || typeof playRequest.catch !== "function") return;
        pendingMediaPlayback.set(media, playRequest);
        playRequest.then(() => {
          reportedMediaErrors.delete(media);
          blockedAudioMedia.delete(media);
          if (audioUnlock && blockedAudioMedia.size === 0) audioUnlock.dataset.visible = "false";
        }).catch((error) => {
          handleMediaPlaybackFailure(media, error);
        }).finally(() => {
          if (pendingMediaPlayback.get(media) === playRequest) pendingMediaPlayback.delete(media);
        });
      };
      const handleMediaReadinessChange = (event) => {
        const media = event?.currentTarget;
        if (media && mediaHasPlayableData(media) && !measuredMediaWarmup.has(media)) {
          const startedAt = mediaWarmupStartedAt.get(media);
          if (Number.isFinite(startedAt)) {
            measuredMediaWarmup.add(media);
            emitMediaMetric("media_warmup_ms", startedAt, [mediaIdentity(media)]);
          }
        }
        primeMediaForTime(currentTime, true);
        announceInitialReadyIfPossible();
        if (!playbackIntent || bufferingTargetTime === null) return;
        const pending = pendingMediaAt(bufferingTargetTime);
        if (pending.length > 0) {
          postMediaState("BUFFERING", pending);
          return;
        }
        const resumeTime = bufferingTargetTime;
        bufferingTargetTime = null;
        if (bufferingTimeout) window.clearTimeout(bufferingTimeout);
        bufferingTimeout = null;
        if (bufferingStartedAt !== null) {
          emitMediaMetric("buffering_duration_ms", bufferingStartedAt, bufferingMediaIds);
          bufferingStartedAt = null;
          bufferingMediaIds = [];
        }
        seek(resumeTime, true);
        startPlaybackClock();
      };
      const enterBuffering = (targetTime, pending = pendingMediaAt(targetTime)) => {
        if (!playbackIntent || pending.length === 0) return false;
        audioMeters.pause();
        bufferingTargetTime = targetTime;
        if (bufferingStartedAt === null) {
          bufferingStartedAt = performance.now();
          bufferingMediaIds = pending.map(mediaIdentity);
        }
        playbackActive = false;
        if (playbackTimer) window.cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
        document.querySelectorAll("audio, video").forEach((media) => media.pause());
        primeMediaForTime(targetTime, true);
        postMediaState("BUFFERING", pending);
        if (!bufferingTimeout) {
          bufferingTimeout = window.setTimeout(() => {
            bufferingTimeout = null;
            const unresolved = pendingMediaAt(bufferingTargetTime ?? currentTime);
            unresolved.forEach((media) => reportMediaError(media, new Error(
              "El medio no entregó un frame reproducible dentro del tiempo permitido.",
            )));
          }, MEDIA_BUFFERING_TIMEOUT_MS);
        }
        postParentMessage({ type: "courseforge-composition-playback", playing: false });
        return true;
      };
      const boundMedia = new WeakSet();
      const bindMediaReadinessListeners = () => {
        timedMedia().forEach((media) => {
          if (boundMedia.has(media)) return;
          boundMedia.add(media);
          if (media.tagName === "VIDEO") {
            media.addEventListener("loadedmetadata", () => preserveDefaultMediaAspect(media));
            if (media.readyState >= 1) preserveDefaultMediaAspect(media);
          }
          ["loadeddata", "canplay", "canplaythrough", "progress", "playing"].forEach((eventName) => {
            media.addEventListener(eventName, handleMediaReadinessChange);
          });
          media.addEventListener("playing", () => {
            if (playRequestedAt === null) return;
            const hasActiveVideo = [...activeMedia].some((active) => active.tagName === "VIDEO");
            if (media.tagName !== "VIDEO" && hasActiveVideo) return;
            if (media.tagName === "VIDEO" && typeof media.requestVideoFrameCallback === "function") {
              media.requestVideoFrameCallback(completePlayStartLatency);
            } else {
              completePlayStartLatency();
            }
          });
          ["waiting", "stalled"].forEach((eventName) => {
            media.addEventListener(eventName, () => {
              if (playbackActive && mediaIsActiveAt(media, currentTime) && !mediaHasPlayableData(media)) {
                enterBuffering(currentTime, [media]);
              }
            });
          });
          media.addEventListener("error", (event) => {
            reportMediaError(media);
            handleMediaReadinessChange(event);
          });
        });
      };
      const syncMedia = (time, forceSeek = false) => {
        primeMediaForTime(time);
        document.querySelectorAll("video[data-start], audio[data-start]").forEach((media) => {
          const start = Number(media.dataset.start || 0);
          const sourceOffset = Number(media.dataset.sourceOffset || 0);
          const active = mediaIsActiveAt(media, time);
          if (!active) {
            media.pause();
            activeMedia.delete(media);
            return;
          }
          const entered = !activeMedia.has(media);
          activeMedia.add(media);
          if (media.dataset.volumeAutomated !== "true") {
            const volume = Number(media.dataset.volume || 1);
            media.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
          }
          let heldVideoTail = false;
          if (Number.isFinite(media.duration) && media.duration > 0) {
            const sourceTime = Math.max(0, sourceOffset + (time - start) * mediaRate(media));
            heldVideoTail = media.tagName === "VIDEO" && !media.loop && sourceTime >= media.duration;
            const next = media.loop ? sourceTime % media.duration : Math.min(media.duration, sourceTime);
            const seekTolerance = forceSeek || entered
              ? MEDIA_FORCED_SEEK_TOLERANCE_SECONDS
              : MEDIA_SEEK_TOLERANCE_SECONDS;
            // Reassigning the same currentTime is not a no-op in Chromium: it can
            // discard decoded data and abort the active Range request. During a
            // buffering recovery that created an endless seek/pause/resume loop.
            if (Math.abs(media.currentTime - next) > seekTolerance) media.currentTime = next;
          }
          if (media.playbackRate !== mediaRate(media)) media.playbackRate = mediaRate(media);
          if (playbackActive && !heldVideoTail) requestMediaPlayback(media);
          else media.pause();
        });
      };
      const seek = (time, forceMediaSeek = false) => {
        cancelKeyboardTransform();
        currentTime = Math.max(0, Math.min(duration, Number(time) || 0));
        if (!admitHtmlLayout()) return;
        timeline.seek(currentTime, false);
        seekDeterministicWaapiAnimations(currentTime);
        applyRuntimeVisibilityOverrides();
        reconcileCanvasFocus();
        syncMedia(currentTime, forceMediaSeek);
        postParentMessage({ type: "courseforge-composition-time", seconds: currentTime });
      };
      const captureDeterministicWaapiAnimations = (compositionTimeMs) => {
        document.getAnimations().forEach((animation) => {
          if (deterministicWaapiOrigins.has(animation)) return;
          const observedAnimationTimeMs = Number(animation.currentTime);
          const animationTimeMs = Number.isFinite(observedAnimationTimeMs)
            ? (compositionTimeMs > 0 && observedAnimationTimeMs >= compositionTimeMs
              ? Math.max(0, observedAnimationTimeMs - compositionTimeMs)
              : observedAnimationTimeMs)
            : 0;
          deterministicWaapiOrigins.set(animation, { animationTimeMs, compositionTimeMs });
          deterministicWaapiAnimations.add(animation);
        });
      };
      const seekDeterministicWaapiAnimations = (time) => {
        const compositionTimeMs = Math.max(0, time) * 1000;
        // GSAP can create browser-owned CSS transitions while seeking. Discover
        // after the master timeline so those transient animations participate
        // in the same deterministic clock as HyperFrames' WAAPI adapter.
        captureDeterministicWaapiAnimations(compositionTimeMs);
        for (const animation of deterministicWaapiAnimations) {
          const target = animation.effect?.target;
          if (target instanceof Element && !target.isConnected) {
            deterministicWaapiAnimations.delete(animation);
            deterministicWaapiOrigins.delete(animation);
            continue;
          }
          const origin = deterministicWaapiOrigins.get(animation);
          if (!origin) continue;
          try {
            animation.currentTime = origin.animationTimeMs
              + Math.max(0, compositionTimeMs - origin.compositionTimeMs);
            animation.pause();
          } catch {
            // A detached or browser-owned animation can disappear between
            // discovery and seek. It must not stop the composition clock.
          }
        }
      };
      const pause = () => {
        audioMeters.pause();
        playbackIntent = false;
        playbackActive = false;
        bufferingTargetTime = null;
        if (bufferingTimeout) window.clearTimeout(bufferingTimeout);
        bufferingTimeout = null;
        bufferingStartedAt = null;
        bufferingMediaIds = [];
        playRequestedAt = null;
        if (playbackTimer) window.cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
        document.querySelectorAll("audio, video").forEach((media) => media.pause());
        postMediaState(initialMediaReady ? "READY" : "PREPARING", pendingMediaAt(currentTime));
        postParentMessage({ type: "courseforge-composition-playback", playing: false });
      };
      const scrubTo = (time) => {
        // A manual seek is authoritative. Cancel an older playback/buffering
        // target before loading the frame at the newly requested position.
        pause();
        seek(time, true);
      };
      function startPlaybackClock() {
        if (!admitHtmlLayout()) return;
        void audioMeters.resume();
        if (playbackTimer) window.cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
        playbackActive = true;
        syncMedia(currentTime, true);
        let last = performance.now();
        const tick = (now) => {
          if (!playbackActive) return;
          const next = currentTime + (now - last) / 1000;
          last = now;
          if (next >= duration) { seek(duration); pause(); return; }
          const pending = pendingMediaAt(next);
          if (enterBuffering(next, pending)) return;
          seek(next);
          playbackTimer = window.requestAnimationFrame(tick);
        };
        playbackTimer = window.requestAnimationFrame(tick);
        if (timedMedia().every((media) => !mediaIsActiveAt(media, currentTime))) completePlayStartLatency();
        postMediaState("PLAYING");
        postParentMessage({ type: "courseforge-composition-playback", playing: true });
      }
      const play = () => {
        if (!admitHtmlLayout()) return;
        playRequestedAt = performance.now();
        playbackIntent = true;
        primeMediaForTime(currentTime, true);
        const pending = pendingMediaAt(currentTime);
        if (enterBuffering(currentTime, pending)) return;
        startPlaybackClock();
      };
      audioUnlock?.addEventListener("click", () => {
        if (playbackActive) void audioMeters.resume();
        // This handler executes inside the iframe under a real user gesture,
        // which lets the browser grant playback to its previously blocked audio.
        blockedAudioMedia.clear();
        syncMedia(currentTime, true);
      });
      bindMediaReadinessListeners();
      ${renderCompositionCanvasFocusContinuity()}
      const selectTarget = (target, origin = "PREVIEW", requestedHfIds = null) => {
        cancelKeyboardTransform();
        if (!target) return;
        const focusToken = readCanvasControlFocus();
        const targetHfId = target.dataset.hfId || null;
        const nextHfIds = new Set(
          Array.isArray(requestedHfIds)
            ? requestedHfIds.filter((hfId) => typeof hfId === "string").slice(0, 100)
            : targetHfId ? [targetHfId] : [],
        );
        if (targetHfId) nextHfIds.add(targetHfId);
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => {
          if (node instanceof HTMLElement) applyCrop(node, readCrop(node), false);
        });
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => node.removeAttribute("data-crop-mode"));
        document.querySelectorAll(".composition-editor-control").forEach((node) => node.remove());
        target.setAttribute("data-selected", "true");
        nextHfIds.forEach((hfId) => {
          document.querySelector('[data-hf-id="' + CSS.escape(hfId) + '"]')?.setAttribute("data-selected", "true");
        });
        const canCrop = target.dataset.croppable === "true";
        if (cropEnabled && canCrop) {
          target.setAttribute("data-crop-mode", "true");
          const cropHandleLabels = {
            n: "Recortar desde arriba",
            e: "Recortar desde la derecha",
            s: "Recortar desde abajo",
            w: "Recortar desde la izquierda",
          };
          for (const [edge, label] of Object.entries(cropHandleLabels)) {
            const cropHandle = document.createElement("button");
            cropHandle.type = "button";
            cropHandle.className = "composition-editor-control composition-crop-handle";
            cropHandle.dataset.cropEdge = edge;
            cropHandle.setAttribute("aria-label", label);
            cropHandle.title = label + ": flechas; Shift paso mayor; Escape cancelar";
            target.appendChild(cropHandle);
          }
        }
        if (editingEnabled && !cropEnabled) {
          const moveHandle = document.createElement("button");
          moveHandle.type = "button";
          moveHandle.className = "composition-editor-control composition-move-handle";
          moveHandle.setAttribute("aria-label", "Mover elemento");
          moveHandle.title = "Arrastra o usa flechas para mover; Shift paso mayor; Escape cancelar";
          moveHandle.textContent = "✥";
          target.appendChild(moveHandle);
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "composition-editor-control composition-resize-handle";
          handle.setAttribute("aria-label", "Redimensionar elemento");
          handle.title = "Arrastra para cambiar el tamaño o usa flechas; Alt libre; Shift paso mayor; Escape cancelar";
          handle.textContent = "↘";
          target.appendChild(handle);
        }
        applyCrop(target, readCrop(target), cropEnabled && canCrop);
        selectedHfId = targetHfId;
        selectedHfIds = nextHfIds;
        restoreCanvasControlFocus(focusToken, target);
        const box = target.getBoundingClientRect();
        postParentMessage({ type: "courseforge-composition-selection", hfId: selectedHfId, hfIds: [...selectedHfIds], origin, bounds: { height: box.height, width: box.width, x: box.x, y: box.y } });
      };
      const clearTarget = (origin = "PREVIEW") => {
        cancelKeyboardTransform();
        const focusToken = readCanvasControlFocus();
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => {
          if (node instanceof HTMLElement) applyCrop(node, readCrop(node), false);
        });
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => node.removeAttribute("data-crop-mode"));
        document.querySelectorAll(".composition-editor-control").forEach((node) => node.remove());
        selectedHfId = null;
        selectedHfIds = new Set();
        if (focusToken && document.hasFocus()) root.focus({ preventScroll: true });
        postParentMessage({ type: "courseforge-composition-selection", hfId: null, hfIds: [], origin });
      };
      ${renderCompositionCanvasSnapGeometry()}
      ${renderCompositionCanvasVisibleBounds()}
      const clearSmartGuides = () => {
        document.querySelectorAll(".composition-smart-guide").forEach((guide) => guide.remove());
      };
      const showSmartGuides = (x, y) => {
        clearSmartGuides();
        if (Number.isFinite(x)) {
          const guide = document.createElement("span");
          guide.className = "composition-smart-guide";
          guide.dataset.axis = "x";
          guide.style.left = x + "px";
          root.appendChild(guide);
        }
        if (Number.isFinite(y)) {
          const guide = document.createElement("span");
          guide.className = "composition-smart-guide";
          guide.dataset.axis = "y";
          guide.style.top = y + "px";
          root.appendChild(guide);
        }
      };
      const readLayoutBox = (target) => ({
        height: Number.parseFloat(target.style.height),
        width: Number.parseFloat(target.style.width),
        x: Number.parseFloat(target.style.left),
        y: Number.parseFloat(target.style.top),
        rotation: Number(target.style.transform.match(/^rotate[(]([-+0-9.eE]+)deg[)]$/)?.[1] || 0),
      });
      const collectSmartGuidePositions = (target, axis) => {
        const canvasPositions = axis === "x" ? [0, canvasWidth / 2, canvasWidth] : [0, canvasHeight / 2, canvasHeight];
        const peerPositions = [...document.querySelectorAll("[data-hf-id]")].flatMap((peer) => {
          if (!(peer instanceof HTMLElement) || peer === target) return [];
          const style = getComputedStyle(peer);
          if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return [];
          const box = compositionCanvasVisibleBounds(readLayoutBox(peer), readCrop(peer));
          if (!box) return [];
          return axis === "x"
            ? [box.left, box.centerX, box.right]
            : [box.top, box.centerY, box.bottom];
        });
        return [...new Set([...canvasPositions, ...peerPositions])];
      };
      const resolveClosestSmartGuide = (anchors, guides, threshold) => {
        let match = null;
        for (const anchor of anchors) {
          for (const guide of guides) {
            const delta = guide - anchor;
            if (Math.abs(delta) > threshold) continue;
            if (!match || Math.abs(delta) < Math.abs(match.delta)) match = { delta, guide };
          }
        }
        return match;
      };
      const resolveSmartMove = (target, layout, x, y, scale) => {
        const threshold = canvasSnapTolerance(scale, canvasSnapGeometry.screenTolerancePixels);
        const box = compositionCanvasVisibleBounds({ ...readLayoutBox(target), x, y }, readCrop(target));
        if (!box) return { x, y, guideX: undefined, guideY: undefined };
        const xMatch = resolveClosestSmartGuide(
          [box.left, box.centerX, box.right],
          collectSmartGuidePositions(target, "x"),
          threshold,
        );
        const yMatch = resolveClosestSmartGuide(
          [box.top, box.centerY, box.bottom],
          collectSmartGuidePositions(target, "y"),
          threshold,
        );
        return {
          guideX: xMatch?.guide,
          guideY: yMatch?.guide,
          x: x + (xMatch?.delta || 0),
          y: y + (yMatch?.delta || 0),
        };
      };
      const resolveSmartResize = (target, layout, width, height, preserveRatio, scale) => {
        const threshold = canvasSnapTolerance(scale, canvasSnapGeometry.screenTolerancePixels);
        return resolveVisibleResizeSnap({
          layout: { ...layout, rotation: readLayoutBox(target).rotation }, crop: activeTransform.crop,
          width, height, preserveRatio, threshold,
          guidesX: collectSmartGuidePositions(target, "x"), guidesY: collectSmartGuidePositions(target, "y"),
        });
      };
      ${renderCompositionCanvasKeyboardSelection()}
      ${renderCompositionCanvasControlKeyboard()}
      ${renderCompositionEditorShortcutBridge()}
      document.addEventListener("click", (event) => {
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        if (activeTransform?.moved) return;
        const target = event.target.closest("[data-hf-id]");
        if (!target) {
          clearTarget();
          return;
        }
        const targetHfId = target.dataset.hfId || null;
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        if (!additive || !targetHfId) {
          selectTarget(target);
          return;
        }
        const nextHfIds = new Set(selectedHfIds);
        if (nextHfIds.has(targetHfId)) nextHfIds.delete(targetHfId);
        else nextHfIds.add(targetHfId);
        if (nextHfIds.size === 0) {
          clearTarget();
          return;
        }
        const primaryHfId = nextHfIds.has(targetHfId) ? targetHfId : [...nextHfIds].at(-1);
        const primaryTarget = primaryHfId
          ? document.querySelector('[data-hf-id="' + CSS.escape(primaryHfId) + '"]')
          : null;
        selectTarget(primaryTarget, "PREVIEW", [...nextHfIds]);
      });
      root?.addEventListener("pointerdown", (event) => {
        if (!editingEnabled) return;
        const cropHandle = event.target.closest(".composition-crop-handle");
        const handle = event.target.closest(".composition-resize-handle");
        const target = cropHandle?.parentElement || handle?.parentElement || event.target.closest("[data-hf-id]");
        if (!target) {
          const rootBox = root.getBoundingClientRect();
          const scale = rootBox.width / canvasWidth;
          if (!Number.isFinite(scale) || scale <= 0) return;
          const marquee = document.createElement("div");
          marquee.className = "composition-selection-marquee";
          root.appendChild(marquee);
          activeMarquee = {
            additive: event.ctrlKey || event.metaKey || event.shiftKey,
            marquee,
            rootBox,
            scale,
            startX: event.clientX,
            startY: event.clientY,
          };
          root.setPointerCapture?.(event.pointerId);
          event.preventDefault();
          return;
        }
        if (!(target instanceof HTMLElement) || event.ctrlKey || event.metaKey || event.shiftKey) return;
        selectTarget(target);
        const rootBox = root.getBoundingClientRect();
        const scale = rootBox.width / canvasWidth;
        if (!Number.isFinite(scale) || scale <= 0) return;
        const layout = {
          height: Number.parseFloat(target.style.height),
          width: Number.parseFloat(target.style.width),
          x: Number.parseFloat(target.style.left),
          y: Number.parseFloat(target.style.top),
        };
        if (Object.values(layout).some((value) => !Number.isFinite(value))) return;
        const canCrop = target.dataset.croppable === "true";
        const currentCrop = readCrop(target);
        activeTransform = { crop: currentCrop, cropEdge: cropHandle?.dataset.cropEdge || null, startX: event.clientX, startY: event.clientY, layout, mode: cropHandle ? "crop-edge" : cropEnabled && canCrop ? "crop-move" : handle ? "resize" : "move", moved: false, preserveRatio: !event.altKey, scale, target };
        target.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
      root?.addEventListener("pointermove", (event) => {
        if (activeMarquee) {
          clearSmartGuides();
          const left = Math.min(activeMarquee.startX, event.clientX);
          const top = Math.min(activeMarquee.startY, event.clientY);
          const width = Math.abs(event.clientX - activeMarquee.startX);
          const height = Math.abs(event.clientY - activeMarquee.startY);
          activeMarquee.marquee.style.left = (left - activeMarquee.rootBox.left) / activeMarquee.scale + "px";
          activeMarquee.marquee.style.top = (top - activeMarquee.rootBox.top) / activeMarquee.scale + "px";
          activeMarquee.marquee.style.width = width / activeMarquee.scale + "px";
          activeMarquee.marquee.style.height = height / activeMarquee.scale + "px";
          return;
        }
        if (!activeTransform) return;
        const dx = (event.clientX - activeTransform.startX) / activeTransform.scale;
        const dy = (event.clientY - activeTransform.startY) / activeTransform.scale;
        if (Math.abs(dx) > .25 || Math.abs(dy) > .25) activeTransform.moved = true;
        const target = activeTransform.target;
        if (activeTransform.mode === "crop-edge") {
          clearSmartGuides();
          applyCrop(target, adjustCropFromHandle(activeTransform.crop, activeTransform.layout, activeTransform.cropEdge || "", dx, dy));
          return;
        }
        if (activeTransform.mode === "crop-move") {
          clearSmartGuides();
          applyCrop(target, moveCropWindow(activeTransform.crop, activeTransform.layout, dx, dy));
          return;
        }
        if (activeTransform.mode === "move") {
          const minX = -activeTransform.crop.left;
          const minY = -activeTransform.crop.top;
          const maxX = canvasWidth - activeTransform.layout.width + activeTransform.crop.right;
          const maxY = canvasHeight - activeTransform.layout.height + activeTransform.crop.bottom;
          const x = Math.max(minX, Math.min(maxX, activeTransform.layout.x + dx));
          const y = Math.max(minY, Math.min(maxY, activeTransform.layout.y + dy));
          const gridSize = canvasSnapGeometry.gridSizePixels;
          const snappedVisibleX = Math.round((x + activeTransform.crop.left) / gridSize) * gridSize;
          const snappedVisibleY = Math.round((y + activeTransform.crop.top) / gridSize) * gridSize;
          const smartMove = snapEnabled ? resolveSmartMove(target, activeTransform.layout, x, y, activeTransform.scale) : null;
          const nextX = snapEnabled
            ? Math.max(minX, Math.min(maxX, smartMove?.guideX === undefined ? snappedVisibleX - activeTransform.crop.left : smartMove.x))
            : Math.round(x);
          const nextY = snapEnabled
            ? Math.max(minY, Math.min(maxY, smartMove?.guideY === undefined ? snappedVisibleY - activeTransform.crop.top : smartMove.y))
            : Math.round(y);
          target.style.left = nextX + "px";
          target.style.top = nextY + "px";
          showSmartGuides(
            smartMove && Math.abs(nextX - smartMove.x) < 1e-6 ? smartMove.guideX : undefined,
            smartMove && Math.abs(nextY - smartMove.y) < 1e-6 ? smartMove.guideY : undefined,
          );
          return;
        }
        const maxWidth = canvasWidth - activeTransform.layout.x;
        const maxHeight = canvasHeight - activeTransform.layout.y;
        const aspectRatio = activeTransform.preserveRatio ? activeTransform.layout.width / activeTransform.layout.height : null;
        const resizeBounds = { maxWidth, maxHeight, aspectRatio, minimumSize: canvasSnapGeometry.minimumSizePixels };
        // El eje con mayor desplazamiento proporcional gobierna el tirador de esquina.
        const proportionalDx = aspectRatio === null ? dx : Math.abs(dx) >= Math.abs(dy * aspectRatio) ? dx : dy * aspectRatio;
        const requestedSize = boundCanvasResize({ ...resizeBounds, width: activeTransform.layout.width + proportionalDx, height: activeTransform.layout.height + dy });
        if (!requestedSize) { clearSmartGuides(); return; }
        const { width, height } = requestedSize;
        const smartResize = snapEnabled
          ? resolveSmartResize(target, activeTransform.layout, width, height, activeTransform.preserveRatio, activeTransform.scale)
          : null;
        const gridSize = canvasSnapGeometry.gridSizePixels;
        const hasGuide = smartResize?.guideX !== undefined || smartResize?.guideY !== undefined;
        const finalSize = boundCanvasResize({
          ...resizeBounds,
          width: snapEnabled ? hasGuide ? smartResize.width : Math.round(width / gridSize) * gridSize : Math.round(width),
          height: snapEnabled ? hasGuide ? smartResize.height : Math.round(height / gridSize) * gridSize : Math.round(height),
        });
        if (!finalSize) { clearSmartGuides(); return; }
        const nextWidth = finalSize.width;
        const nextHeight = finalSize.height;
        target.style.width = nextWidth + "px";
        target.style.height = nextHeight + "px";
        const visibleBounds = compositionCanvasResizedVisibleBounds(
          { ...activeTransform.layout, rotation: readLayoutBox(target).rotation }, activeTransform.crop, nextWidth, nextHeight,
        );
        showSmartGuides(
          visibleBounds && Math.abs(visibleBounds.right - smartResize?.guideX) < 1e-6 ? smartResize.guideX : undefined,
          visibleBounds && Math.abs(visibleBounds.bottom - smartResize?.guideY) < 1e-6 ? smartResize.guideY : undefined,
        );
        applyCrop(target, scaleCropForLayout(activeTransform.crop, activeTransform.layout, { width: nextWidth, height: nextHeight }), false);
      });
      const finishTransform = (event) => {
        clearSmartGuides();
        if (activeMarquee) {
          const marqueeState = activeMarquee;
          activeMarquee = null;
          root.releasePointerCapture?.(event.pointerId);
          marqueeState.marquee.remove();
          const selectionBox = {
            bottom: Math.max(marqueeState.startY, event.clientY),
            left: Math.min(marqueeState.startX, event.clientX),
            right: Math.max(marqueeState.startX, event.clientX),
            top: Math.min(marqueeState.startY, event.clientY),
          };
          const moved = selectionBox.right - selectionBox.left > 3 || selectionBox.bottom - selectionBox.top > 3;
          if (!moved) return;
          suppressNextClick = true;
          const hitHfIds = [...document.querySelectorAll("[data-hf-id]")]
            .filter((candidate) => {
              if (!(candidate instanceof HTMLElement) || getComputedStyle(candidate).visibility === "hidden") return false;
              const box = candidate.getBoundingClientRect();
              return box.right >= selectionBox.left && box.left <= selectionBox.right
                && box.bottom >= selectionBox.top && box.top <= selectionBox.bottom;
            })
            .flatMap((candidate) => candidate instanceof HTMLElement && candidate.dataset.hfId ? [candidate.dataset.hfId] : []);
          const nextHfIds = new Set(marqueeState.additive ? selectedHfIds : []);
          hitHfIds.forEach((hfId) => {
            if (nextHfIds.size < 100) nextHfIds.add(hfId);
          });
          const primaryHfId = [...nextHfIds].at(-1);
          const primaryTarget = primaryHfId
            ? document.querySelector('[data-hf-id="' + CSS.escape(primaryHfId) + '"]')
            : null;
          if (primaryTarget) selectTarget(primaryTarget, "PREVIEW", [...nextHfIds]);
          else clearTarget();
          return;
        }
        if (!activeTransform) return;
        const transform = activeTransform;
        activeTransform = null;
        transform.target.releasePointerCapture?.(event.pointerId);
        if (!transform.moved || !selectedHfId) return;
        if (transform.mode === "crop-move" || transform.mode === "crop-edge") {
          commitCrop(transform.target);
          return;
        }
        postParentMessage({
          type: "courseforge-composition-layout-commit",
          hfId: selectedHfId,
          layout: {
            height: Number.parseFloat(transform.target.style.height),
            width: Number.parseFloat(transform.target.style.width),
            x: Number.parseFloat(transform.target.style.left),
            y: Number.parseFloat(transform.target.style.top),
          },
        });
      };
      root?.addEventListener("pointerup", finishTransform);
      root?.addEventListener("pointercancel", finishTransform);
      const targetIsActiveAt = (target, time) => {
        const timingHost = target.matches("[data-start]") ? target : target.closest("[data-start]");
        if (!timingHost) return true;
        const start = Number(timingHost.dataset.start || 0);
        const durationSeconds = Number(timingHost.dataset.duration || 0);
        return time >= start && time < start + durationSeconds;
      };
      const applyRuntimeVisibilityOverrides = () => {
        document.querySelectorAll('[data-runtime-visibility]').forEach((target) => {
          if (!(target instanceof HTMLElement)) return;
          const hidden = target.dataset.runtimeVisibility === "hidden";
          const active = targetIsActiveAt(target, currentTime);
          const layoutOpacity = Number(target.dataset.layoutOpacity || 1);
          target.style.visibility = !hidden && active ? "visible" : "hidden";
          target.style.opacity = !hidden && active ? String(Number.isFinite(layoutOpacity) ? layoutOpacity : 1) : "0";
        });
      };
      const setRuntimeMediaVisibility = (target, hidden) => {
        const mediaElements = [
          ...(target.matches("audio, video") ? [target] : []),
          ...target.querySelectorAll("audio, video"),
        ];
        const siblingAudio = target.id ? document.getElementById(target.id + "-audio") : null;
        if (siblingAudio) mediaElements.push(siblingAudio);
        mediaElements.forEach((media) => {
          if (hidden) media.dataset.clipHidden = "true";
          else delete media.dataset.clipHidden;
        });
      };
      const resolveBasicColorGrading = (value) => {
        if (value === null) return null;
        if (!value || typeof value !== "object") return undefined;
        const adjust = value.adjust;
        if (!adjust || typeof adjust !== "object") return undefined;
        if (Number.isFinite(adjust.exposure) && adjust.exposure >= -2 && adjust.exposure <= 2
          && Number.isFinite(adjust.contrast) && adjust.contrast >= -1 && adjust.contrast <= 1
          && Number.isFinite(adjust.saturation) && adjust.saturation >= -1 && adjust.saturation <= 1) {
          return { adjust: { contrast: adjust.contrast, exposure: adjust.exposure, saturation: adjust.saturation } };
        }
        return undefined;
      };
      const isBasicColorGrading = (value) => resolveBasicColorGrading(value) !== undefined;
      const applyCourseforgeColorFallback = (media, colorGrading) => {
        const basicColorGrading = resolveBasicColorGrading(colorGrading);
        if (basicColorGrading === undefined) return false;
        if (basicColorGrading === null) {
          media.style.removeProperty("--courseforge-color-filter");
          delete media.dataset.courseforgeColorFallback;
          return true;
        }
        const adjust = basicColorGrading.adjust;
        const brightness = Math.pow(2, adjust.exposure).toFixed(6);
        const contrast = Math.max(0, 1 + adjust.contrast).toFixed(6);
        const saturation = Math.max(0, 1 + adjust.saturation).toFixed(6);
        media.style.setProperty("--courseforge-color-filter", "brightness(" + brightness + ") contrast(" + contrast + ") saturate(" + saturation + ")");
        media.dataset.courseforgeColorFallback = "true";
        return true;
      };
      const getColorGradingRuntime = () => (
        window.__hfColorGradingRuntimeContractVersion === ${COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT.version}
          ? window.__hf?.colorGrading
          : null
      );
      const reportColorGradingStatus = (target, media) => {
        const runtime = getColorGradingRuntime();
        const hfId = target?.dataset?.hfId;
        if (!hfId || !media) return;
        if (!runtime) {
          postParentMessage({
            hfId,
            message: "Vista previa aproximada; el render final conserva el ajuste canónico.",
            state: "fallback",
            type: "courseforge-composition-color-grading-status",
          });
          return;
        }
        const status = runtime.getStatus(media);
        postParentMessage({
          hfId,
          message: String(status.message || "Color grading status unavailable").slice(0, 500),
          state: status.state,
          type: "courseforge-composition-color-grading-status",
        });
      };
      const applyColorGrading = (target, colorGrading) => {
        if (!isBasicColorGrading(colorGrading)) return false;
        const runtime = getColorGradingRuntime();
        const media = target?.querySelector?.("video, img") || (target?.id ? document.getElementById(target.id + "-media") : null);
        if (!(media instanceof HTMLVideoElement || media instanceof HTMLImageElement)) return false;
        if (colorGrading === null) media.removeAttribute("data-color-grading");
        else media.setAttribute("data-color-grading", JSON.stringify(colorGrading));
        if (!runtime) {
          if (!applyCourseforgeColorFallback(media, colorGrading)) return false;
          reportColorGradingStatus(target, media);
          return true;
        }
        runtime.setGrading(media, colorGrading);
        reportColorGradingStatus(target, media);
        window.setTimeout(() => reportColorGradingStatus(target, media), 250);
        return true;
      };
      const applyVisualPatch = (message) => {
        const startedAt = performance.now();
        const finish = (applied, code) => postParentMessage({
          applied,
          code,
          durationMs: Math.max(0, performance.now() - startedAt),
          sequence: message.sequence,
          type: "courseforge-composition-visual-patch-result",
        });
        if (!compiledDocumentHash || message.baseDocumentHash !== compiledDocumentHash) {
          finish(false, "VERSION_MISMATCH");
          return;
        }
        const changes = message.patch?.changes;
        if (!Number.isInteger(message.sequence) || message.sequence < 1 || !Array.isArray(changes) || changes.length > 100
          || (changes.length === 0 && !Array.isArray(message.patch?.motion) && !message.patch?.scene)
          || (message.patch?.motion !== undefined && (!Array.isArray(message.patch.motion) || message.patch.motion.length > 200))) {
          finish(false, "INVALID_PATCH");
          return;
        }
        const resolvedChanges = [];
        for (const change of changes) {
          if (!change || typeof change.hfId !== "string") { finish(false, "INVALID_PATCH"); return; }
          const target = document.querySelector('[data-hf-id="' + CSS.escape(change.hfId) + '"]');
          if (!(target instanceof HTMLElement)) { finish(false, "TARGET_NOT_FOUND"); return; }
          resolvedChanges.push({ change, target });
        }
        try {
          if (message.patch.scene !== undefined) {
            if (htmlLayoutRequired) throw new Error("CONTROLLED_HTML_REQUIRES_COMPILATION");
            const scene = message.patch.scene;
            if (!root || !Array.isArray(scene.nodes) || scene.nodes.length > 999 || !scene.timeline
              || !Number.isFinite(scene.canvas?.durationSeconds) || scene.canvas.durationSeconds <= 0
              || !Number.isFinite(scene.canvas.width) || !Number.isFinite(scene.canvas.height)) throw new Error("INVALID_SCENE");
            const commitScene = (${prepareCompositionPreviewScenePatch.toString()})(root, scene);
            timeline.revert();
            commitScene();
            duration = scene.canvas.durationSeconds;
            canvasWidth = scene.canvas.width;
            canvasHeight = scene.canvas.height;
            viewport.dataset.width = String(canvasWidth);
            viewport.dataset.height = String(canvasHeight);
            viewport.dataset.duration = String(duration);
            viewport.dataset.fps = String(scene.canvas.fps);
            timeline = window.__courseforgeInstallTimeline(scene.timeline);
            for (const media of activeMedia) if (!media.isConnected) activeMedia.delete(media);
            for (const media of blockedAudioMedia) if (!media.isConnected) blockedAudioMedia.delete(media);
            bindMediaReadinessListeners();
            document.querySelectorAll('.clip-content[data-preserve-aspect] video').forEach((media) => {
              if (media.readyState >= 1) preserveDefaultMediaAspect(media);
            });
            initializeColorGrading();
            fitCompositionToViewport();
            const selectedTarget = selectedHfId ? document.querySelector('[data-hf-id="' + CSS.escape(selectedHfId) + '"]') : null;
            if (selectedTarget) selectTarget(selectedTarget, "PARENT", [...selectedHfIds]);
            else clearTarget("PARENT");
          }
          for (const { change, target } of resolvedChanges) {
            if (change.layout) {
              Object.assign(target.style, {
                height: change.layout.height + "px",
                left: change.layout.x + "px",
                top: change.layout.y + "px",
                transform: "rotate(" + change.layout.rotation + "deg)",
                width: change.layout.width + "px",
                zIndex: String(change.layout.zIndex),
              });
            }
            if (change.cropInsets) applyCrop(target, change.cropInsets);
            if (Object.prototype.hasOwnProperty.call(change, "colorGrading") && !applyColorGrading(target, change.colorGrading)) {
              throw new Error("COLOR_GRADING_RUNTIME_UNAVAILABLE");
            }
            if (change.mediaFit === "CONTAIN" || change.mediaFit === "COVER") {
              target.dataset.mediaFit = change.mediaFit;
              if (change.aspectAnchor) target.dataset.preserveAspect = change.aspectAnchor;
              else delete target.dataset.preserveAspect;
              const media = target.querySelector("video, img");
              if (media) preserveDefaultMediaAspect(media);
            }
            if (typeof change.hidden === "boolean") {
              target.dataset.runtimeVisibility = change.hidden ? "hidden" : "shown";
              setRuntimeMediaVisibility(target, change.hidden);
            }
            if (typeof change.volume === "number") {
              const volumeTarget = target.matches("audio") ? target : document.getElementById(target.id + "-audio");
              if (!(volumeTarget instanceof HTMLMediaElement)) throw new Error("VOLUME_TARGET_NOT_FOUND");
              volumeTarget.dataset.volume = String(change.volume);
              if (volumeTarget.dataset.volumeAutomated !== "true") volumeTarget.volume = change.volume;
            }
          }
          if (message.patch.motion !== undefined) window.__courseforgeReplaceMotion(message.patch.motion);
          seek(currentTime);
          finish(true, "APPLIED");
        } catch {
          finish(false, "RUNTIME_ERROR");
        }
      };
      window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || typeof message.type !== "string") return;
        if ((message.protocolVersion ?? ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}) !== ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}) return;
        cancelKeyboardTransform();
        if (message.type === "courseforge-composition-restore-focus") restoreCanvasFocusAfterReload(message.hfId);
        if (message.type === "courseforge-composition-visual-patch") { applyVisualPatch(message); return; }
        if (message.type === "courseforge-composition-seek") scrubTo(message.seconds);
        if (message.type === "courseforge-composition-play") play();
        if (message.type === "courseforge-composition-pause") pause();
        if (message.type === "courseforge-composition-reset-audio-meter") audioMeters.reset();
        if (message.type === "courseforge-composition-editor-settings") {
          editingEnabled = message.editingEnabled !== false;
          cropEnabled = message.cropEnabled === true;
          snapEnabled = message.snapEnabled !== false;
          if (editorGrid) editorGrid.setAttribute("data-visible", message.gridVisible === true ? "true" : "false");
          const selectedTarget = selectedHfId ? document.querySelector('[data-hf-id="' + CSS.escape(selectedHfId) + '"]') : null;
          if (selectedTarget) selectTarget(selectedTarget, "PARENT", [...selectedHfIds]);
        }
        if (message.type === "courseforge-composition-preview-zoom") {
          previewUserScale = Math.max(.5, Math.min(2, Number(message.scale) || 1));
          fitCompositionToViewport();
        }
        if (message.type === "courseforge-composition-preview-crop" && typeof message.hfId === "string") {
          const target = document.querySelector('[data-hf-id="' + CSS.escape(message.hfId) + '"]');
          if (target instanceof HTMLElement) applyCrop(target, message.crop || {});
        }
        if (message.type === "courseforge-composition-preview-color-grading" && typeof message.hfId === "string") {
          const target = document.querySelector('[data-hf-id="' + CSS.escape(message.hfId) + '"]');
          if (target instanceof HTMLElement && isBasicColorGrading(message.colorGrading)) {
            applyColorGrading(target, message.colorGrading);
          }
        }
        if (message.type === "courseforge-composition-select") {
          if (message.hfId === null) {
            clearTarget("PARENT");
          } else if (typeof message.hfId === "string") {
            const target = document.querySelector('[data-hf-id="' + CSS.escape(message.hfId) + '"]');
            selectTarget(target, "PARENT", Array.isArray(message.hfIds) ? message.hfIds : [message.hfId]);
          }
        }
      });
      new ResizeObserver(fitCompositionToViewport).observe(viewport);
      fitCompositionToViewport();
      primeMediaForTime(0, true);
      const initializeColorGrading = () => {
        document.querySelectorAll("video.composition-media, img.composition-media").forEach((media) => {
          const target = media.closest("[data-hf-id]");
          if (!getColorGradingRuntime()) {
            const serializedColorGrading = media.getAttribute("data-color-grading");
            if (serializedColorGrading) {
              try { applyCourseforgeColorFallback(media, JSON.parse(serializedColorGrading)); } catch { /* Invalid persisted attributes stay unmodified. */ }
            }
          }
          if (target instanceof HTMLElement) reportColorGradingStatus(target, media);
        });
      };
      initializeColorGrading();
      captureDeterministicWaapiAnimations(0);
      seek(0);
      announceInitialReadyIfPossible();
      if (htmlLayout) htmlLayout.ready.then(() => { seek(currentTime); announceInitialReadyIfPossible(); }, () => admitHtmlLayout());
      window.setTimeout(initializeColorGrading, 250);
    })();
  </script>`;
}

function requireRuntimeTrackIndex(indexes: ReadonlyMap<string, number>, clipId: string) {
  const index = indexes.get(clipId);
  if (index === undefined) throw new CompositionPreviewCompilerError(`No se pudo asignar un track temporal a ${clipId}.`);
  return index;
}

export async function readCompositionAnimationRuntime() {
  const candidates = [
    resolve(process.cwd(), "node_modules/gsap/dist/gsap.min.js"),
    resolve(process.cwd(), "../node_modules/gsap/dist/gsap.min.js"),
    resolve(process.cwd(), "../../node_modules/gsap/dist/gsap.min.js"),
  ];
  for (const filePath of candidates) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  throw new CompositionPreviewDependencyError("No se encontró el runtime de animación del preview.");
}

function renderCompositionFontFaces(
  document: CompositionEditorDocument,
  fontAssets: Map<string, CompositionCompiledFont> | undefined,
) {
  let references: ReturnType<typeof compositionFontReferenceDetails>;
  try { references = compositionFontReferenceDetails(document); }
  catch { throw new CompositionPreviewCompilerError("Las referencias tipográficas de la composición no son válidas.", 409); }
  return [...references].map(([assetId, reference]) => {
    const family = reference.fontFamily;
    const font = fontAssets?.get(assetId);
    if (!font) throw new CompositionPreviewCompilerError(`No se resolvió la fuente personalizada ${family}.`, 409);
    if (font.family !== family) throw new CompositionPreviewCompilerError(`La fuente ${font.family} no coincide con la familia declarada ${family}.`, 409);
    const face = font.googleFace ? googleFontFaceBindingSchema.parse(font.googleFace) : undefined;
    if (JSON.stringify(face) !== JSON.stringify(reference.googleFace)) throw new CompositionPreviewCompilerError("La variante tipográfica no coincide con la referencia guardada.", 409);
    const descriptors = face ? ` font-style: ${face.style}; font-weight: ${face.weight.minimum}${face.weight.maximum === face.weight.minimum ? "" : ` ${face.weight.maximum}`};${face.unicodeRange ? ` unicode-range: ${face.unicodeRange};` : ""}` : "";
    return `@font-face { font-family: '${escapeCssString(font.family)}'; src: url("${escapeCssUrl(font.sourceUrl)}") format('${font.format}'); font-display: block;${descriptors} }`;
  }).join("\n");
}

function escapeCssString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeCssUrl(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, "");
}

export async function readOptionalCompositionColorGradingRuntime() {
  const directoryPath = resolveInstalledHyperframesCoreDirectory();
  if (!directoryPath) return null;

  let source: string;
  try {
    source = await readFile(
      resolve(directoryPath, COMPOSITION_COLOR_GRADING_RUNTIME_ARTIFACT),
      "utf8",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const manifestRaw = await readFile(
      resolve(directoryPath, "hyperframe.manifest.json"),
      "utf8",
    );
    return validateCompositionColorGradingRuntimeArtifact({ manifestRaw, source }).source;
  } catch (error) {
    throw new CompositionPreviewDependencyError(
      `El runtime autónomo de color de HyperFrames no superó la validación: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveInstalledHyperframesCoreDirectory() {
  try {
    // Resolving the public package metadata makes the installed package the only source
    // of preview code. This prevents a sibling checkout from masking an
    // incomplete deployment dependency.
    return resolveHyperframesCoreDirectoryFromPackageResolution(
      require.resolve("@hyperframes/core/package.json"),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

/**
 * Next/Turbopack can compile `require.resolve(...)` into a numeric module id in
 * serverless bundles. A numeric id proves that the module was bundled, but it is
 * not a filesystem path and must not be passed to `path.dirname`. The color
 * runtime is optional, so an unavailable physical path intentionally selects
 * Courseforge's deterministic CSS fallback.
 */
export function resolveHyperframesCoreDirectoryFromPackageResolution(
  packageResolution: unknown,
) {
  if (typeof packageResolution !== "string" || packageResolution.length === 0) return null;
  return resolve(dirname(packageResolution), "dist");
}

export async function readCompositionColorGradingRuntime() {
  const runtime = await readOptionalCompositionColorGradingRuntime();
  if (runtime) return runtime;
  throw new CompositionPreviewDependencyError(
    "No se encontró el runtime autónomo de corrección de color de HyperFrames. Actualiza @hyperframes/core antes de abrir el preview.",
  );
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return escapeAttribute(value).replace(/>/g, "&gt;");
}
