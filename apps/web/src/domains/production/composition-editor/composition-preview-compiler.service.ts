import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "./composition-document.types";
import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";
import {
  buildCompositionVolumeAutomations,
  type CompositionClipVolumeAutomation,
} from "./composition-audio-mix.service";
import { resolveCompositionCropInsets } from "./composition-visual-crop.service";

export class CompositionPreviewCompilerError extends Error {}

export const COMPOSITION_COMPILATION_TARGETS = {
  HYPERFRAMES_RENDER: "HYPERFRAMES_RENDER",
  INTERACTIVE_PREVIEW: "INTERACTIVE_PREVIEW",
} as const;
export type CompositionCompilationTarget = typeof COMPOSITION_COMPILATION_TARGETS[keyof typeof COMPOSITION_COMPILATION_TARGETS];

export const COMPOSITION_PREVIEW_MEDIA_CONFIG = {
  bufferingTimeoutMs: 12_000,
  forcedSeekToleranceSeconds: 0.05,
  lookaheadSeconds: 15,
  maxPrimedMedia: 6,
  minimumReadyState: 2,
  seekToleranceSeconds: 0.35,
} as const;

/**
 * Compiles the native document into an isolated, seekable review document.
 * The document is not persisted and never becomes the editable source of truth.
 */
export async function compileCompositionPreview(params: {
  assetUrls: Map<string, string>;
  deckAssetUrls?: Map<string, string>;
  document: CompositionEditorDocument;
  target?: CompositionCompilationTarget;
}) {
  const target = params.target || COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW;
  const isInteractivePreview = target === COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW;
  const animationRuntime = isInteractivePreview ? await readCompositionAnimationRuntime() : null;
  const { document } = params;
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const volumeAutomations = buildCompositionVolumeAutomations(document);
  const automatedClipIds = new Set(volumeAutomations.map((automation) => automation.targetClipId));
  const deckStyles = document.deckStyles
    ? `${document.deckStyles.fontUrls.map((url) => `@import url(${JSON.stringify(replaceUrls(url, params.deckAssetUrls))});`).join("\n")}\n${replaceUrls(document.deckStyles.css, params.deckAssetUrls)}`
    : "";
  const clips = document.clips
    .slice()
    .sort((left, right) => left.layout.zIndex - right.layout.zIndex || left.startSeconds - right.startSeconds)
    .map((clip, index) => renderClip(
      clip,
      tracksById.get(clip.trackId),
      params.assetUrls,
      params.deckAssetUrls,
      target,
      index,
      automatedClipIds.has(clip.id),
    ))
    .join("\n");
  const hasAudibleMedia = document.clips.some((clip) => {
    const track = tracksById.get(clip.trackId);
    return !clip.hidden && !track?.hidden && !track?.muted
      && (clip.kind === "AUDIO" || (clip.kind === "VIDEO" && clip.trackId === "avatar"));
  });
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${document.canvas.width}, height=${document.canvas.height}" />
  <title>${escapeHtml(document.variables.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #020617; }
    #composition-viewport { position: fixed; inset: 0; overflow: hidden; background: #020617; }
    #composition-root { --preview-scale: 1; --preview-user-scale: 1; --editor-control-scale: 1; --editor-outline-width: 3px; position: absolute; left: 50%; top: 50%; width: ${document.canvas.width}px; height: ${document.canvas.height}px; overflow: hidden; background: #020617; transform: translate(-50%, -50%) scale(calc(var(--preview-scale) * var(--preview-user-scale))); transform-origin: center; }
    .clip { position: absolute; inset: 0;${isInteractivePreview ? " pointer-events: none;" : ""} }
    .clip-content { position: absolute; overflow: hidden; transform-origin: top left;${isInteractivePreview ? " pointer-events: none;" : ""} visibility: hidden; }
    .motion-subject { position: relative; width: 100%; height: 100%; transform-origin: center;${isInteractivePreview ? " pointer-events: auto;" : ""} }
    ${isInteractivePreview ? `.clip-content[data-selected="true"]::after { content: ""; position: absolute; inset: var(--crop-top, 0px) var(--crop-right, 0px) var(--crop-bottom, 0px) var(--crop-left, 0px); border: var(--editor-outline-width) solid rgba(8,145,178,.9); box-shadow: 0 0 0 var(--editor-outline-width) rgba(255,255,255,.75), 0 0 18px rgba(34,211,238,.75); pointer-events: none; }
    .composition-editor-control { position: absolute; z-index: 2147483647; display: grid; width: 22px; height: 22px; padding: 0; place-items: center; border: 2px solid #fff; border-radius: 5px; color: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.65); cursor: pointer; pointer-events: auto; }
    .composition-move-handle { left: 0; top: 0; background: #0e7490; font: 700 15px/1 system-ui, sans-serif; cursor: move; transform: scale(var(--editor-control-scale)); transform-origin: top left; }
    .composition-resize-handle { right: 0; bottom: 0; background: #0891b2; font: 800 14px/1 system-ui, sans-serif; cursor: nwse-resize; transform: scale(var(--editor-control-scale)); transform-origin: bottom right; }
    .clip-content[data-crop-mode="true"] { cursor: grab; }
    .clip-content[data-crop-mode="true"]:active { cursor: grabbing; }
    .clip-content[data-crop-mode="true"]::before { content: ""; position: absolute; inset: var(--crop-top, 0px) var(--crop-right, 0px) var(--crop-bottom, 0px) var(--crop-left, 0px); z-index: 2147483645; pointer-events: none; background-image: linear-gradient(to right, transparent 33.1%, rgba(255,255,255,.7) 33.2%, rgba(255,255,255,.7) 33.5%, transparent 33.6%, transparent 66.4%, rgba(255,255,255,.7) 66.5%, rgba(255,255,255,.7) 66.8%, transparent 66.9%), linear-gradient(to bottom, transparent 33.1%, rgba(255,255,255,.7) 33.2%, rgba(255,255,255,.7) 33.5%, transparent 33.6%, transparent 66.4%, rgba(255,255,255,.7) 66.5%, rgba(255,255,255,.7) 66.8%, transparent 66.9%); box-shadow: 0 0 0 9999px rgba(2,6,23,.58), inset 0 0 0 var(--editor-outline-width) #f59e0b; }
    .composition-crop-handle { z-index: 2147483647; width: 14px; height: 14px; border-color: #fff; border-radius: 3px; background: #f59e0b; transform: translate(-50%, -50%) scale(var(--editor-control-scale)); transform-origin: center; }
    .composition-crop-handle[data-crop-edge="n"], .composition-crop-handle[data-crop-edge="s"] { width: 34px; height: 10px; cursor: ns-resize; }
    .composition-crop-handle[data-crop-edge="e"], .composition-crop-handle[data-crop-edge="w"] { width: 10px; height: 34px; cursor: ew-resize; }
    .composition-editor-grid { position: absolute; inset: 0; z-index: 2147483646; display: none; pointer-events: none; background-image: linear-gradient(to right, rgba(34,211,238,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,.18) 1px, transparent 1px), linear-gradient(to right, rgba(34,211,238,.38) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,.38) 1px, transparent 1px); background-size: 16px 16px, 16px 16px, 80px 80px, 80px 80px; box-shadow: inset 0 0 0 1px rgba(34,211,238,.5); }
    .composition-editor-grid[data-visible="true"] { display: block; }` : ""}
    .composition-media { width: 100%; height: 100%; object-fit: cover; display: block; }
    .clip-content[data-media-fit="CONTAIN"] .composition-media { object-fit: contain; }
    .composition-audio { display: none; }
    ${isInteractivePreview ? `.composition-audio-unlock { position: absolute; left: 50%; bottom: 28px; z-index: 2147483647; display: none; transform: translateX(-50%); border: 1px solid rgba(255,255,255,.55); border-radius: 999px; background: rgba(2,6,23,.92); color: #fff; padding: 12px 18px; font: 700 16px/1 system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.4); cursor: pointer; }
    .composition-audio-unlock[data-visible="true"] { display: block; }` : ""}
    .deck-content { overflow: hidden; }
    .deck-content .deck-scope, .deck-content .deck-shell, .deck-content .deck-stage, .deck-content .deck-stage > .slide { width: 100%; height: 100%; }
    ${deckStyles}
  </style>
</head>
<body>
  <div id="composition-viewport" data-composition-id="courseforge-composition" data-start="0" data-width="${document.canvas.width}" data-height="${document.canvas.height}" data-duration="${document.canvas.durationSeconds}" data-fps="${document.canvas.fps}">
    <div id="composition-root">
      ${clips}
      ${isInteractivePreview ? '<div id="composition-editor-grid" class="composition-editor-grid" aria-hidden="true"></div>' : ""}
    </div>
    ${isInteractivePreview && hasAudibleMedia ? '<button id="composition-audio-unlock" class="composition-audio-unlock" type="button">Activar audio y reproducir</button>' : ""}
  </div>
  ${animationRuntime ? `<script>${animationRuntime}</script>` : '<script src="assets/gsap.min.js"></script>'}
  ${renderTimelineInitializer(document, volumeAutomations)}
  ${isInteractivePreview ? renderInteractivePreviewController(document) : ""}
</body>
</html>`;
}

function renderClip(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
  assetUrls: Map<string, string>,
  deckAssetUrls: Map<string, string> | undefined,
  target: CompositionCompilationTarget,
  clipIndex: number,
  hasVolumeAutomation: boolean,
) {
  const isHyperframesRender = target === COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER;
  const layout = `left:${clip.layout.x}px;top:${clip.layout.y}px;width:${clip.layout.width}px;height:${clip.layout.height}px;opacity:${clip.layout.opacity};z-index:${clip.layout.zIndex};transform:rotate(${clip.layout.rotation}deg);`;
  const isAvatar = track?.semanticRole === "AVATAR" || track?.id === "avatar";
  const isBroll = track?.semanticRole === "BROLL" || track?.id === "broll";
  // Missing mediaFit is intentionally backward-compatible with historical
  // documents: avatars contained their source, all other media used cover.
  const mediaFit = clip.mediaFit || (isAvatar ? "CONTAIN" : "COVER");
  const aspectAnchor = mediaFit === "CONTAIN" && (isAvatar || isBroll)
    ? (isAvatar ? "BOTTOM_RIGHT" : "CENTER")
    : null;
  const crop = resolveCompositionCropInsets(clip.crop, clip.layout);
  const cropData = ` data-crop-top="${crop.top}" data-crop-right="${crop.right}" data-crop-bottom="${crop.bottom}" data-crop-left="${crop.left}"`;
  const cropStyle = renderVisualCropStyle(crop);
  const common = `id="${escapeAttribute(clip.id)}" data-hf-id="${escapeAttribute(clip.hfId)}" data-media-fit="${mediaFit}"${cropData}${aspectAnchor ? ` data-preserve-aspect="${aspectAnchor}"` : ""} style="${layout}"`;
  const motionId = `${escapeAttribute(clip.id)}-motion`;
  const timing = `data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${trackIndex(clip.trackId, clipIndex)}"`;
  const mediaOffset = `data-source-offset="${clip.sourceOffsetSeconds || 0}"${isHyperframesRender ? ` data-media-start="${clip.sourceOffsetSeconds || 0}"` : ""}`;
  const hidden = clip.hidden || track?.hidden ? (isHyperframesRender ? ' data-hidden="true"' : ' data-clip-hidden="true"') : "";
  const volumeAutomation = hasVolumeAutomation ? ' data-volume-automated="true"' : "";
  const volume = resolveClipAudioVolume(clip, track);
  const hasSynchronizedVideoAudio = clip.kind === "VIDEO" && Boolean(
    track?.semanticRole === "AVATAR"
    || track?.semanticRole === "BROLL"
    || track?.id === "avatar"
    || track?.id === "broll"
  );
  if (clip.source.type === "DECK_SLIDE") {
    return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${timing}><div ${common} class="clip-content"><div id="${motionId}" class="motion-subject deck-content"><div class="deck-scope"><div class="deck-shell"><main class="deck-stage"><section class="${escapeAttribute(clip.source.classes)}">${replaceUrls(clip.source.html, deckAssetUrls)}</section></main></div></div></div></div></section>`;
  }
  const sourceUrl = assetUrls.get(clip.source.productionAssetId);
  if (!sourceUrl) throw new CompositionPreviewCompilerError(`No existe URL de preview para el asset ${clip.source.productionAssetId}.`);
  if (clip.kind === "AUDIO") {
    return `<audio id="${escapeAttribute(clip.id)}" class="composition-audio${isHyperframesRender ? " clip" : ""}" data-hf-id="${escapeAttribute(clip.hfId)}"${hidden}${volumeAutomation} ${mediaOffset} data-volume="${volume}" src="${escapeAttribute(sourceUrl)}" preload="metadata" ${timing}></audio>`;
  }
  if (clip.kind === "VIDEO" && isHyperframesRender) {
    const video = `<video id="${escapeAttribute(clip.id)}-media" class="composition-media clip" src="${escapeAttribute(sourceUrl)}" muted playsinline loop preload="metadata" ${mediaOffset}${hidden} ${timing}></video>`;
    const audio = hasSynchronizedVideoAudio
      ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio clip" src="${escapeAttribute(sourceUrl)}" loop preload="metadata" ${mediaOffset}${hidden} data-volume="${volume}" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${10 + clipIndex}"></audio>`
      : "";
    return `<div ${common} class="clip-content"><div id="${motionId}" class="motion-subject" style="${cropStyle}">${video}</div></div>${audio}`;
  }
  const media = clip.kind === "VIDEO"
    ? `<video id="${escapeAttribute(clip.id)}-media" class="composition-media" src="${escapeAttribute(sourceUrl)}" muted playsinline loop preload="metadata" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" ${mediaOffset}${hidden}></video>${hasSynchronizedVideoAudio ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio"${hidden} src="${escapeAttribute(sourceUrl)}" loop preload="metadata" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" ${mediaOffset} data-volume="${volume}"></audio>` : ""}`
    : `<img class="composition-media" src="${escapeAttribute(sourceUrl)}" alt="" />`;
  return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${timing}><div ${common} class="clip-content"><div id="${motionId}" class="motion-subject" style="${cropStyle}">${media}</div></div></section>`;
}

function resolveClipAudioVolume(
  clip: CompositionClip,
  track: CompositionTrack | undefined,
) {
  if (track?.muted) return 0;
  const trackVolume = track?.volume ?? 1;
  const isBrollVideo = clip.kind === "VIDEO"
    && (track?.semanticRole === "BROLL" || track?.id === "broll");
  const clipVolume = isBrollVideo ? clip.volume ?? 0 : 1;
  return Math.max(0, Math.min(1, trackVolume * clipVolume));
}

function renderVisualCropStyle(crop: { bottom: number; left: number; right: number; top: number }) {
  return `clip-path:inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px);`;
}

function replaceUrls(value: string, replacements?: Map<string, string>) {
  if (!replacements || replacements.size === 0) return value;
  let result = value;
  for (const [sourceUrl, replacementUrl] of replacements) {
    result = result.split(sourceUrl).join(replacementUrl);
  }
  return result;
}

function renderTimelineInitializer(
  document: CompositionEditorDocument,
  volumeAutomations: CompositionClipVolumeAutomation[],
) {
  const tracksById = new Map(document.tracks.map((track) => [track.id, track]));
  const clipMetadata = document.clips.map((clip) => ({
    duration: clip.durationSeconds,
    hfId: clip.hfId,
    hidden: clip.hidden || Boolean(tracksById.get(clip.trackId)?.hidden),
    id: clip.id,
    kind: clip.kind,
    start: clip.startSeconds,
  }));
  const motionAnimations = document.motion.animations.map((animation) => {
    const clip = document.clips.find((candidate) => candidate.id === animation.target.clipId)!;
    const relativeStart = resolveCompositionAnimationWindow(animation, clip.durationSeconds).start;
    return {
      duration: animation.timing.durationSeconds,
      id: animation.id,
      keyframes: animation.keyframes,
      start: clip.startSeconds + relativeStart,
      targetId: `${clip.id}-motion`,
    };
  });
  return `<script>
    (() => {
      const clips = ${JSON.stringify(clipMetadata)};
      const motionAnimations = ${JSON.stringify(motionAnimations)};
      const volumeAutomations = ${JSON.stringify(volumeAutomations)};
      const timeline = gsap.timeline({ paused: true });
      for (const clip of clips) {
        if (clip.kind === "AUDIO") continue;
        const element = document.getElementById(clip.id);
        if (!element) continue;
        if (clip.hidden) { timeline.set(element, { autoAlpha: 0 }, 0); continue; }
        timeline.set(element, { autoAlpha: 1 }, clip.start);
        if (clip.kind === "DECK_SLIDE") {
          const deckScope = element.querySelector(".deck-scope");
          if (deckScope) {
            timeline.fromTo(
              deckScope,
              { "--deck-t": 0 },
              { "--deck-t": clip.duration, duration: clip.duration, ease: "none", immediateRender: false },
              clip.start,
            );
          }
        }
        timeline.set(element, { autoAlpha: 0 }, clip.start + clip.duration + 0.0001);
      }
      for (const automation of volumeAutomations) {
        const media = document.getElementById(automation.targetClipId);
        if (!media || automation.points.length === 0) continue;
        timeline.set(media, { volume: automation.points[0].volume }, automation.points[0].timeSeconds);
        for (let index = 1; index < automation.points.length; index += 1) {
          const previous = automation.points[index - 1];
          const point = automation.points[index];
          const transitionDuration = Math.max(0, point.timeSeconds - previous.timeSeconds);
          if (transitionDuration === 0) {
            timeline.set(media, { volume: point.volume }, point.timeSeconds);
            continue;
          }
          timeline.fromTo(
            media,
            { volume: previous.volume },
            { volume: point.volume, duration: transitionDuration, ease: "none", immediateRender: false },
            previous.timeSeconds,
          );
        }
      }
      for (const animation of motionAnimations) {
        const target = document.getElementById(animation.targetId);
        const first = animation.keyframes[0];
        if (!target || !first) continue;
        timeline.set(target, first.values, animation.start);
        for (let index = 1; index < animation.keyframes.length; index += 1) {
          const previous = animation.keyframes[index - 1];
          const keyframe = animation.keyframes[index];
          const segmentDuration = (keyframe.offset - previous.offset) * animation.duration;
          timeline.to(target, {
            ...keyframe.values,
            duration: segmentDuration,
            ease: keyframe.ease || "none",
          }, animation.start + previous.offset * animation.duration);
        }
      }
      window.__timelines = window.__timelines || {};
      window.__timelines["courseforge-composition"] = timeline;
    })();
  </script>`;
}

function renderInteractivePreviewController(document: CompositionEditorDocument) {
  return `<script>
    (() => {
      const root = document.getElementById("composition-root");
      const viewport = document.getElementById("composition-viewport");
      const audioUnlock = document.getElementById("composition-audio-unlock");
      const editorGrid = document.getElementById("composition-editor-grid");
      const timeline = window.__timelines["courseforge-composition"];
      let editingEnabled = true;
      let cropEnabled = false;
      let snapEnabled = true;
      let previewUserScale = 1;
      let selectedHfId = null;
      let activeTransform = null;
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
      const previewStartedAt = performance.now();
      const activeMedia = new Set();
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
      let lastPrimeTime = Number.NEGATIVE_INFINITY;
      // Browser autoplay policy may reject audible media in the sandboxed iframe.
      // That is an audio-permission issue, not a transport failure: the muted
      // video and the composition clock must keep running.
      const blockedAudioMedia = new Set();
      const pendingMediaPlayback = new WeakMap();
      const reportedMediaErrors = new WeakSet();
      const duration = ${document.canvas.durationSeconds};
      const canvasWidth = ${document.canvas.width};
      const canvasHeight = ${document.canvas.height};
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
        window.parent.postMessage({
          type: "courseforge-composition-crop-commit",
          hfId,
          crop: readCrop(target),
        }, "*");
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
      const fitCompositionToViewport = () => {
        if (!root || !viewport) return;
        const scale = Math.min(viewport.clientWidth / ${document.canvas.width}, viewport.clientHeight / ${document.canvas.height});
        const safeScale = Math.max(.01, scale);
        const renderedScale = safeScale * previewUserScale;
        root.style.setProperty("--preview-scale", String(safeScale));
        root.style.setProperty("--preview-user-scale", String(previewUserScale));
        root.style.setProperty("--editor-control-scale", String(1 / renderedScale));
        root.style.setProperty("--editor-outline-width", (2 / renderedScale) + "px");
      };
      const mediaIdentity = (media) => media.id || media.closest("[data-hf-id]")?.dataset.hfId || media.tagName.toLowerCase();
      const emitMediaMetric = (name, startedAt, mediaIds = []) => {
        if (!Number.isFinite(startedAt)) return;
        window.parent.postMessage({
          type: "courseforge-composition-media-metric",
          metric: {
            atSeconds: Math.max(0, currentTime),
            durationMs: Math.max(0, Math.min(120000, performance.now() - startedAt)),
            mediaIds: mediaIds.slice(0, 6),
            name,
          },
        }, "*");
      };
      const completePlayStartLatency = () => {
        if (playRequestedAt === null) return;
        emitMediaMetric("play_start_latency_ms", playRequestedAt, [...activeMedia].map(mediaIdentity));
        playRequestedAt = null;
      };
      const timedMedia = () => Array.from(document.querySelectorAll("video[data-start], audio[data-start]"));
      const mediaStart = (media) => Number(media.dataset.start || 0);
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
        const rawSourceTime = Math.max(0, sourceOffset + timelineTarget - start);
        const sourceTime = media.loop && Number.isFinite(media.duration) && media.duration > 0
          ? rawSourceTime % media.duration
          : rawSourceTime;
        if (Math.abs(media.currentTime - sourceTime) <= 0.35) return;
        try { media.currentTime = sourceTime; } catch (error) { reportMediaError(media, error); }
      };
      const postMediaState = (state, pending = []) => {
        window.parent.postMessage({
          type: "courseforge-composition-media-state",
          state,
          pendingMediaIds: pending.map(mediaIdentity),
        }, "*");
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
      const announceInitialReadyIfPossible = () => {
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
        window.parent.postMessage({ type: "courseforge-composition-ready", duration, selectedHfId }, "*");
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
            window.parent.postMessage({ type: "courseforge-composition-aspect-corrections", corrections }, "*");
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
        window.parent.postMessage({
          type: "courseforge-composition-media-error",
          code,
          mediaId: mediaIdentity(media),
          message,
        }, "*");
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
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: false }, "*");
        return true;
      };
      const bindMediaReadinessListeners = () => {
        timedMedia().forEach((media) => {
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
          if (Number.isFinite(media.duration) && media.duration > 0) {
            const sourceTime = Math.max(0, sourceOffset + time - start);
            const next = media.loop ? sourceTime % media.duration : Math.min(media.duration, sourceTime);
            const seekTolerance = forceSeek || entered
              ? MEDIA_FORCED_SEEK_TOLERANCE_SECONDS
              : MEDIA_SEEK_TOLERANCE_SECONDS;
            // Reassigning the same currentTime is not a no-op in Chromium: it can
            // discard decoded data and abort the active Range request. During a
            // buffering recovery that created an endless seek/pause/resume loop.
            if (Math.abs(media.currentTime - next) > seekTolerance) media.currentTime = next;
          }
          if (playbackActive) requestMediaPlayback(media);
          else media.pause();
        });
      };
      const seek = (time, forceMediaSeek = false) => {
        currentTime = Math.max(0, Math.min(duration, Number(time) || 0));
        timeline.seek(currentTime, false);
        syncMedia(currentTime, forceMediaSeek);
        window.parent.postMessage({ type: "courseforge-composition-time", seconds: currentTime }, "*");
      };
      const pause = () => {
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
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: false }, "*");
      };
      const scrubTo = (time) => {
        // A manual seek is authoritative. Cancel an older playback/buffering
        // target before loading the frame at the newly requested position.
        pause();
        seek(time, true);
      };
      function startPlaybackClock() {
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
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: true }, "*");
      }
      const play = () => {
        playRequestedAt = performance.now();
        playbackIntent = true;
        primeMediaForTime(currentTime, true);
        const pending = pendingMediaAt(currentTime);
        if (enterBuffering(currentTime, pending)) return;
        startPlaybackClock();
      };
      audioUnlock?.addEventListener("click", () => {
        // This handler executes inside the iframe under a real user gesture,
        // which lets the browser grant playback to its previously blocked audio.
        blockedAudioMedia.clear();
        syncMedia(currentTime, true);
      });
      document.querySelectorAll('.clip-content[data-preserve-aspect] video').forEach((media) => {
        if (media.readyState >= 1) preserveDefaultMediaAspect(media);
        else media.addEventListener("loadedmetadata", () => preserveDefaultMediaAspect(media), { once: true });
      });
      bindMediaReadinessListeners();
      const selectTarget = (target) => {
        if (!target) return;
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => {
          if (node instanceof HTMLElement) applyCrop(node, readCrop(node), false);
        });
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => node.removeAttribute("data-crop-mode"));
        document.querySelectorAll(".composition-editor-control").forEach((node) => node.remove());
        target.setAttribute("data-selected", "true");
        const canCrop = Boolean(target.querySelector('.composition-media'));
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
            cropHandle.title = label;
            target.appendChild(cropHandle);
          }
        }
        if (editingEnabled && !cropEnabled) {
          const moveHandle = document.createElement("button");
          moveHandle.type = "button";
          moveHandle.className = "composition-editor-control composition-move-handle";
          moveHandle.setAttribute("aria-label", "Mover elemento");
          moveHandle.title = "Arrastra para mover";
          moveHandle.textContent = "✥";
          target.appendChild(moveHandle);
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "composition-editor-control composition-resize-handle";
          handle.setAttribute("aria-label", "Redimensionar elemento");
          handle.title = "Arrastra para cambiar el tamaño";
          handle.textContent = "↘";
          target.appendChild(handle);
        }
        applyCrop(target, readCrop(target), cropEnabled && canCrop);
        selectedHfId = target.dataset.hfId || null;
        const box = target.getBoundingClientRect();
        window.parent.postMessage({ type: "courseforge-composition-selection", hfId: selectedHfId, bounds: { height: box.height, width: box.width, x: box.x, y: box.y } }, "*");
      };
      const clearTarget = () => {
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => {
          if (node instanceof HTMLElement) applyCrop(node, readCrop(node), false);
        });
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => node.removeAttribute("data-crop-mode"));
        document.querySelectorAll(".composition-editor-control").forEach((node) => node.remove());
        selectedHfId = null;
        window.parent.postMessage({ type: "courseforge-composition-selection", hfId: null }, "*");
      };
      document.addEventListener("click", (event) => {
        if (activeTransform?.moved) return;
        const target = event.target.closest("[data-hf-id]");
        if (!target) {
          clearTarget();
          return;
        }
        selectTarget(target);
      });
      root?.addEventListener("pointerdown", (event) => {
        if (!editingEnabled) return;
        const cropHandle = event.target.closest(".composition-crop-handle");
        const handle = event.target.closest(".composition-resize-handle");
        const target = cropHandle?.parentElement || handle?.parentElement || event.target.closest("[data-hf-id]");
        if (!target || !(target instanceof HTMLElement)) return;
        selectTarget(target);
        const rootBox = root.getBoundingClientRect();
        const scale = rootBox.width / ${document.canvas.width};
        if (!Number.isFinite(scale) || scale <= 0) return;
        const layout = {
          height: Number.parseFloat(target.style.height),
          width: Number.parseFloat(target.style.width),
          x: Number.parseFloat(target.style.left),
          y: Number.parseFloat(target.style.top),
        };
        if (Object.values(layout).some((value) => !Number.isFinite(value))) return;
        const canCrop = Boolean(target.querySelector('.composition-media'));
        const currentCrop = readCrop(target);
        activeTransform = { crop: currentCrop, cropEdge: cropHandle?.dataset.cropEdge || null, startX: event.clientX, startY: event.clientY, layout, mode: cropHandle ? "crop-edge" : cropEnabled && canCrop ? "crop-move" : handle ? "resize" : "move", moved: false, preserveRatio: !event.altKey, scale, target };
        target.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
      root?.addEventListener("pointermove", (event) => {
        if (!activeTransform) return;
        const dx = (event.clientX - activeTransform.startX) / activeTransform.scale;
        const dy = (event.clientY - activeTransform.startY) / activeTransform.scale;
        if (Math.abs(dx) > .25 || Math.abs(dy) > .25) activeTransform.moved = true;
        const target = activeTransform.target;
        if (activeTransform.mode === "crop-edge") {
          applyCrop(target, adjustCropFromHandle(activeTransform.crop, activeTransform.layout, activeTransform.cropEdge || "", dx, dy));
          return;
        }
        if (activeTransform.mode === "crop-move") {
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
          const snappedVisibleX = Math.round((x + activeTransform.crop.left) / 16) * 16;
          const snappedVisibleY = Math.round((y + activeTransform.crop.top) / 16) * 16;
          const nextX = snapEnabled ? Math.max(minX, Math.min(maxX, snappedVisibleX - activeTransform.crop.left)) : Math.round(x);
          const nextY = snapEnabled ? Math.max(minY, Math.min(maxY, snappedVisibleY - activeTransform.crop.top)) : Math.round(y);
          target.style.left = nextX + "px";
          target.style.top = nextY + "px";
          return;
        }
        const width = Math.max(24, Math.min(canvasWidth - activeTransform.layout.x, activeTransform.layout.width + dx));
        const height = activeTransform.preserveRatio
          ? Math.max(24, width * (activeTransform.layout.height / activeTransform.layout.width))
          : Math.max(24, activeTransform.layout.height + dy);
        const boundedHeight = Math.min(canvasHeight - activeTransform.layout.y, height);
        const maxWidth = Math.max(24, canvasWidth - activeTransform.layout.x);
        const maxHeight = Math.max(24, canvasHeight - activeTransform.layout.y);
        const nextWidth = snapEnabled ? Math.min(maxWidth, Math.max(24, Math.round(width / 16) * 16)) : Math.round(width);
        const nextHeight = snapEnabled ? Math.min(maxHeight, Math.max(24, Math.round(boundedHeight / 16) * 16)) : Math.round(boundedHeight);
        target.style.width = nextWidth + "px";
        target.style.height = nextHeight + "px";
        applyCrop(target, scaleCropForLayout(activeTransform.crop, activeTransform.layout, { width: nextWidth, height: nextHeight }), false);
      });
      const finishTransform = (event) => {
        if (!activeTransform) return;
        const transform = activeTransform;
        activeTransform = null;
        transform.target.releasePointerCapture?.(event.pointerId);
        if (!transform.moved || !selectedHfId) return;
        if (transform.mode === "crop-move" || transform.mode === "crop-edge") {
          commitCrop(transform.target);
          return;
        }
        window.parent.postMessage({
          type: "courseforge-composition-layout-commit",
          hfId: selectedHfId,
          layout: {
            height: Number.parseFloat(transform.target.style.height),
            width: Number.parseFloat(transform.target.style.width),
            x: Number.parseFloat(transform.target.style.left),
            y: Number.parseFloat(transform.target.style.top),
          },
        }, "*");
      };
      root?.addEventListener("pointerup", finishTransform);
      root?.addEventListener("pointercancel", finishTransform);
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || typeof message.type !== "string") return;
        if (message.type === "courseforge-composition-seek") scrubTo(message.seconds);
        if (message.type === "courseforge-composition-play") play();
        if (message.type === "courseforge-composition-pause") pause();
        if (message.type === "courseforge-composition-editor-settings") {
          editingEnabled = message.editingEnabled !== false;
          cropEnabled = message.cropEnabled === true;
          snapEnabled = message.snapEnabled !== false;
          if (editorGrid) editorGrid.setAttribute("data-visible", message.gridVisible === true ? "true" : "false");
          document.querySelectorAll(".composition-editor-control").forEach((node) => node.remove());
          const selectedTarget = selectedHfId ? document.querySelector('[data-hf-id="' + CSS.escape(selectedHfId) + '"]') : null;
          if (selectedTarget) selectTarget(selectedTarget);
        }
        if (message.type === "courseforge-composition-preview-zoom") {
          previewUserScale = Math.max(.5, Math.min(2, Number(message.scale) || 1));
          fitCompositionToViewport();
        }
        if (message.type === "courseforge-composition-preview-crop" && typeof message.hfId === "string") {
          const target = document.querySelector('[data-hf-id="' + CSS.escape(message.hfId) + '"]');
          if (target instanceof HTMLElement) applyCrop(target, message.crop || {});
        }
        if (message.type === "courseforge-composition-select") {
          if (message.hfId === null) {
            clearTarget();
          } else if (typeof message.hfId === "string") {
            const target = document.querySelector('[data-hf-id="' + CSS.escape(message.hfId) + '"]');
            selectTarget(target);
          }
        }
      });
      new ResizeObserver(fitCompositionToViewport).observe(viewport);
      fitCompositionToViewport();
      primeMediaForTime(0, true);
      seek(0);
      announceInitialReadyIfPossible();
    })();
  </script>`;
}

function trackIndex(trackId: string, clipIndex = 0) {
  if (trackId === "deck") return 0;
  if (trackId === "avatar") return 1;
  if (trackId === "broll") return 2;
  if (trackId === "visual") return 3;
  if (trackId === "overlay") return 4;
  if (trackId === "voice") return 10;
  if (trackId === "music" || trackId === "audio") return 11;
  return 20 + clipIndex;
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
  throw new CompositionPreviewCompilerError("No se encontró el runtime de animación del preview.");
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return escapeAttribute(value).replace(/>/g, "&gt;");
}
