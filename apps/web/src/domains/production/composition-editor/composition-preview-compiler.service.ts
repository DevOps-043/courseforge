import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompositionClip, CompositionEditorDocument, CompositionTrack } from "./composition-document.types";
import { resolveCompositionAnimationWindow } from "./composition-motion-scheduling.service";
import {
  buildCompositionVolumeAutomations,
  type CompositionClipVolumeAutomation,
} from "./composition-audio-mix.service";

export class CompositionPreviewCompilerError extends Error {}

export const COMPOSITION_COMPILATION_TARGETS = {
  HYPERFRAMES_RENDER: "HYPERFRAMES_RENDER",
  INTERACTIVE_PREVIEW: "INTERACTIVE_PREVIEW",
} as const;
export type CompositionCompilationTarget = typeof COMPOSITION_COMPILATION_TARGETS[keyof typeof COMPOSITION_COMPILATION_TARGETS];

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
    .clip-content { position: absolute; overflow: hidden; transform-origin: top left;${isInteractivePreview ? " pointer-events: auto;" : ""} visibility: hidden; }
    .motion-subject { position: relative; width: 100%; height: 100%; transform-origin: center; }
    ${isInteractivePreview ? `.clip-content[data-selected="true"] { outline: var(--editor-outline-width) solid #22d3ee; outline-offset: calc(-1 * var(--editor-outline-width)); box-shadow: 0 0 0 var(--editor-outline-width) rgba(255,255,255,.75), 0 0 18px rgba(34,211,238,.75); }
    .clip-content[data-selected="true"]::after { content: ""; position: absolute; inset: 0; border: var(--editor-outline-width) solid rgba(8,145,178,.9); pointer-events: none; }
    .composition-editor-control { position: absolute; z-index: 2147483647; display: grid; width: 22px; height: 22px; padding: 0; place-items: center; border: 2px solid #fff; border-radius: 5px; color: #fff; box-shadow: 0 1px 5px rgba(0,0,0,.65); cursor: pointer; }
    .composition-move-handle { left: 0; top: 0; background: #0e7490; font: 700 15px/1 system-ui, sans-serif; cursor: move; transform: scale(var(--editor-control-scale)); transform-origin: top left; }
    .composition-resize-handle { right: 0; bottom: 0; background: #0891b2; font: 800 14px/1 system-ui, sans-serif; cursor: nwse-resize; transform: scale(var(--editor-control-scale)); transform-origin: bottom right; }
    .clip-content[data-crop-mode="true"] { cursor: grab; }
    .clip-content[data-crop-mode="true"]:active { cursor: grabbing; }
    .clip-content[data-crop-mode="true"]::before { content: ""; position: absolute; inset: 0; z-index: 2147483645; pointer-events: none; background-image: linear-gradient(to right, transparent 33.1%, rgba(255,255,255,.7) 33.2%, rgba(255,255,255,.7) 33.5%, transparent 33.6%, transparent 66.4%, rgba(255,255,255,.7) 66.5%, rgba(255,255,255,.7) 66.8%, transparent 66.9%), linear-gradient(to bottom, transparent 33.1%, rgba(255,255,255,.7) 33.2%, rgba(255,255,255,.7) 33.5%, transparent 33.6%, transparent 66.4%, rgba(255,255,255,.7) 66.5%, rgba(255,255,255,.7) 66.8%, transparent 66.9%); box-shadow: inset 0 0 0 var(--editor-outline-width) #f59e0b; }
    .composition-crop-handle { z-index: 2147483647; width: 14px; height: 14px; border-color: #fff; border-radius: 3px; background: #f59e0b; transform: translate(-50%, -50%) scale(var(--editor-control-scale)); transform-origin: center; }
    .composition-crop-handle[data-crop-edge="n"] { left: 50%; top: 0; width: 34px; height: 10px; cursor: ns-resize; }
    .composition-crop-handle[data-crop-edge="s"] { left: 50%; top: 100%; width: 34px; height: 10px; cursor: ns-resize; }
    .composition-crop-handle[data-crop-edge="e"] { left: 100%; top: 50%; width: 10px; height: 34px; cursor: ew-resize; }
    .composition-crop-handle[data-crop-edge="w"] { left: 0; top: 50%; width: 10px; height: 34px; cursor: ew-resize; }
    .composition-crop-handle[data-crop-edge="nw"], .composition-crop-handle[data-crop-edge="se"] { cursor: nwse-resize; }
    .composition-crop-handle[data-crop-edge="ne"], .composition-crop-handle[data-crop-edge="sw"] { cursor: nesw-resize; }
    .composition-crop-handle[data-crop-edge="nw"] { left: 0; top: 0; }
    .composition-crop-handle[data-crop-edge="ne"] { left: 100%; top: 0; }
    .composition-crop-handle[data-crop-edge="sw"] { left: 0; top: 100%; }
    .composition-crop-handle[data-crop-edge="se"] { left: 100%; top: 100%; }
    .composition-editor-grid { position: absolute; inset: 0; z-index: 2147483646; display: none; pointer-events: none; background-image: linear-gradient(to right, rgba(34,211,238,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,.18) 1px, transparent 1px), linear-gradient(to right, rgba(34,211,238,.38) 1px, transparent 1px), linear-gradient(to bottom, rgba(34,211,238,.38) 1px, transparent 1px); background-size: 16px 16px, 16px 16px, 80px 80px, 80px 80px; box-shadow: inset 0 0 0 1px rgba(34,211,238,.5); }
    .composition-editor-grid[data-visible="true"] { display: block; }` : ""}
    .composition-media { width: 100%; height: 100%; object-fit: cover; display: block; }
    .clip-content[data-preserve-aspect="true"] .composition-media { object-fit: contain; }
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
  const preservesSourceAspect = track?.semanticRole === "AVATAR" || track?.id === "avatar";
  const crop = clip.crop || { focusX: 0.5, focusY: 0.5, zoom: 1 };
  const cropData = ` data-crop-zoom="${crop.zoom}" data-crop-focus-x="${crop.focusX}" data-crop-focus-y="${crop.focusY}"`;
  const cropStyle = renderVisualCropStyle(crop);
  const common = `id="${escapeAttribute(clip.id)}" data-hf-id="${escapeAttribute(clip.hfId)}"${cropData}${preservesSourceAspect ? ' data-preserve-aspect="true"' : ""} style="${layout}"`;
  const motionId = `${escapeAttribute(clip.id)}-motion`;
  const timing = `data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${trackIndex(clip.trackId, clipIndex)}"`;
  const mediaOffset = `data-source-offset="${clip.sourceOffsetSeconds || 0}"${isHyperframesRender ? ` data-media-start="${clip.sourceOffsetSeconds || 0}"` : ""}`;
  const hidden = clip.hidden || track?.hidden ? (isHyperframesRender ? ' data-hidden="true"' : ' data-clip-hidden="true"') : "";
  const volumeAutomation = hasVolumeAutomation ? ' data-volume-automated="true"' : "";
  const volume = track?.muted ? 0 : track?.volume ?? 1;
  if (clip.source.type === "DECK_SLIDE") {
    return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${timing}><div ${common} class="clip-content"><div id="${motionId}" class="motion-subject deck-content"><div class="deck-scope"><div class="deck-shell"><main class="deck-stage"><section class="${escapeAttribute(clip.source.classes)}">${replaceUrls(clip.source.html, deckAssetUrls)}</section></main></div></div></div></div></section>`;
  }
  const sourceUrl = assetUrls.get(clip.source.productionAssetId);
  if (!sourceUrl) throw new CompositionPreviewCompilerError(`No existe URL de preview para el asset ${clip.source.productionAssetId}.`);
  if (clip.kind === "AUDIO") {
    return `<audio id="${escapeAttribute(clip.id)}" class="composition-audio${isHyperframesRender ? " clip" : ""}" data-hf-id="${escapeAttribute(clip.hfId)}"${hidden}${volumeAutomation} ${mediaOffset} data-volume="${volume}" src="${escapeAttribute(sourceUrl)}" ${timing}></audio>`;
  }
  if (clip.kind === "VIDEO" && isHyperframesRender) {
    const video = `<video id="${escapeAttribute(clip.id)}-media" class="composition-media clip" style="${cropStyle}" src="${escapeAttribute(sourceUrl)}" muted playsinline loop preload="metadata" ${mediaOffset}${hidden} ${timing}></video>`;
    const audio = clip.trackId === "avatar"
      ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio clip" src="${escapeAttribute(sourceUrl)}" loop ${mediaOffset}${hidden} data-volume="${volume}" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${10 + clipIndex}"></audio>`
      : "";
    return `<div ${common} class="clip-content"><div id="${motionId}" class="motion-subject">${video}</div></div>${audio}`;
  }
  const media = clip.kind === "VIDEO"
    ? `<video id="${escapeAttribute(clip.id)}-media" class="composition-media" style="${cropStyle}" src="${escapeAttribute(sourceUrl)}" muted playsinline loop preload="metadata" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" ${mediaOffset}${hidden}></video>${clip.trackId === "avatar" ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio"${hidden} src="${escapeAttribute(sourceUrl)}" loop data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" ${mediaOffset} data-volume="${volume}"></audio>` : ""}`
    : `<img class="composition-media" style="${cropStyle}" src="${escapeAttribute(sourceUrl)}" alt="" />`;
  return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${timing}><div ${common} class="clip-content"><div id="${motionId}" class="motion-subject">${media}</div></div></section>`;
}

function renderVisualCropStyle(crop: { focusX: number; focusY: number; zoom: number }) {
  if (crop.zoom <= 1.0001) return "";
  const leftPercent = 50 - crop.focusX * crop.zoom * 100;
  const topPercent = 50 - crop.focusY * crop.zoom * 100;
  return `position:absolute;max-width:none;left:${leftPercent}%;top:${topPercent}%;width:${crop.zoom * 100}%;height:${crop.zoom * 100}%;`;
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
      let cropCommitTimer = null;
      let playbackTimer = null;
      let playbackActive = false;
      let currentTime = 0;
      const activeMedia = new Set();
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
        focusX: Number(target.dataset.cropFocusX || .5),
        focusY: Number(target.dataset.cropFocusY || .5),
        zoom: Number(target.dataset.cropZoom || 1),
      });
      const applyCrop = (target, crop) => {
        const media = target.querySelector('.composition-media');
        if (!media || !(media instanceof HTMLElement)) return;
        const zoom = Math.max(1, Math.min(8, Number(crop.zoom) || 1));
        const minimumFocus = .5 / zoom;
        const maximumFocus = 1 - minimumFocus;
        const focusX = Math.max(minimumFocus, Math.min(maximumFocus, Number(crop.focusX) || .5));
        const focusY = Math.max(minimumFocus, Math.min(maximumFocus, Number(crop.focusY) || .5));
        target.dataset.cropZoom = String(zoom);
        target.dataset.cropFocusX = String(focusX);
        target.dataset.cropFocusY = String(focusY);
        if (zoom <= 1.0001) {
          Object.assign(media.style, { height: '', left: '', maxWidth: '', position: '', top: '', width: '' });
          return;
        }
        Object.assign(media.style, {
          height: (zoom * 100) + '%',
          left: (50 - focusX * zoom * 100) + '%',
          maxWidth: 'none',
          position: 'absolute',
          top: (50 - focusY * zoom * 100) + '%',
          width: (zoom * 100) + '%',
        });
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
      const queueCropCommit = (target) => {
        if (cropCommitTimer) window.clearTimeout(cropCommitTimer);
        cropCommitTimer = window.setTimeout(() => {
          cropCommitTimer = null;
          commitCrop(target);
        }, 180);
      };
      const resizeCropFrame = (layout, edge, dx, dy) => {
        const minimumSize = 24;
        const snap = (value) => snapEnabled ? Math.round(value / 16) * 16 : Math.round(value);
        let left = layout.x;
        let top = layout.y;
        let right = layout.x + layout.width;
        let bottom = layout.y + layout.height;
        if (edge.includes("w")) left = Math.max(0, Math.min(right - minimumSize, snap(layout.x + dx)));
        if (edge.includes("e")) right = Math.max(left + minimumSize, Math.min(canvasWidth, snap(layout.x + layout.width + dx)));
        if (edge.includes("n")) top = Math.max(0, Math.min(bottom - minimumSize, snap(layout.y + dy)));
        if (edge.includes("s")) bottom = Math.max(top + minimumSize, Math.min(canvasHeight, snap(layout.y + layout.height + dy)));
        return { height: bottom - top, width: right - left, x: left, y: top };
      };
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
      const preserveLegacyAvatarAspect = (media) => {
        const target = media.closest('.clip-content[data-preserve-aspect="true"]');
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
        const usesLegacyAvatarBox = Math.abs(layout.width - legacyWidth) <= 2
          && Math.abs(layout.height - legacyHeight) <= 2
          && Math.abs(layout.x - (canvasWidth - legacyWidth - 48)) <= 2
          && Math.abs(layout.y - (canvasHeight - legacyHeight - 48)) <= 2;
        if (!usesLegacyAvatarBox) return;
        const sourceRatio = sourceWidth / sourceHeight;
        const layoutRatio = layout.width / layout.height;
        if (Math.abs(sourceRatio - layoutRatio) <= .01) return;
        const width = sourceRatio >= layoutRatio ? layout.width : Math.round(layout.height * sourceRatio);
        const height = sourceRatio >= layoutRatio ? Math.round(layout.width / sourceRatio) : layout.height;
        const correctedLayout = {
          height,
          width,
          x: layout.x + layout.width - width,
          y: layout.y + layout.height - height,
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
      const syncMedia = (time, forceSeek = false) => {
        document.querySelectorAll("video[data-start], audio[data-start]").forEach((media) => {
          const start = Number(media.dataset.start || 0);
          const clipDuration = Number(media.dataset.duration || 0);
          const sourceOffset = Number(media.dataset.sourceOffset || 0);
          const active = media.dataset.clipHidden !== "true" && time >= start && time <= start + clipDuration;
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
            if (forceSeek || entered || Math.abs(media.currentTime - next) > 0.35) media.currentTime = next;
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
        playbackActive = false;
        if (playbackTimer) window.cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
        document.querySelectorAll("audio, video").forEach((media) => media.pause());
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: false }, "*");
      };
      const play = () => {
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
          seek(next);
          playbackTimer = window.requestAnimationFrame(tick);
        };
        playbackTimer = window.requestAnimationFrame(tick);
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: true }, "*");
      };
      audioUnlock?.addEventListener("click", () => {
        // This handler executes inside the iframe under a real user gesture,
        // which lets the browser grant playback to its previously blocked audio.
        blockedAudioMedia.clear();
        syncMedia(currentTime, true);
      });
      document.querySelectorAll('.clip-content[data-preserve-aspect="true"] video').forEach((media) => {
        if (media.readyState >= 1) preserveLegacyAvatarAspect(media);
        else media.addEventListener("loadedmetadata", () => preserveLegacyAvatarAspect(media), { once: true });
      });
      const selectTarget = (target) => {
        if (!target) return;
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll("[data-crop-mode='true']").forEach((node) => node.removeAttribute("data-crop-mode"));
        document.querySelectorAll(".composition-editor-control").forEach((node) => node.remove());
        target.setAttribute("data-selected", "true");
        const canCrop = Boolean(target.querySelector('.composition-media'));
        if (cropEnabled && canCrop) {
          target.setAttribute("data-crop-mode", "true");
          const cropHandleLabels = {
            n: "Ajustar borde superior", ne: "Ajustar esquina superior derecha",
            e: "Ajustar borde derecho", se: "Ajustar esquina inferior derecha",
            s: "Ajustar borde inferior", sw: "Ajustar esquina inferior izquierda",
            w: "Ajustar borde izquierdo", nw: "Ajustar esquina superior izquierda",
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
        selectedHfId = target.dataset.hfId || null;
        const box = target.getBoundingClientRect();
        window.parent.postMessage({ type: "courseforge-composition-selection", hfId: selectedHfId, bounds: { height: box.height, width: box.width, x: box.x, y: box.y } }, "*");
      };
      const clearTarget = () => {
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
        const initializesCrop = cropEnabled && canCrop && currentCrop.zoom <= 1.0001;
        const crop = initializesCrop ? { focusX: .5, focusY: .5, zoom: 1.5 } : currentCrop;
        activeTransform = { crop, cropEdge: cropHandle?.dataset.cropEdge || null, startX: event.clientX, startY: event.clientY, layout, mode: cropHandle ? "crop-frame" : cropEnabled && canCrop ? "crop" : handle ? "resize" : "move", moved: false, preserveRatio: !event.altKey, scale, target };
        target.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
      root?.addEventListener("wheel", (event) => {
        if (!editingEnabled || !cropEnabled) return;
        const target = event.target.closest("[data-hf-id]");
        if (!target || !(target instanceof HTMLElement) || !target.querySelector('.composition-media')) return;
        selectTarget(target);
        const crop = readCrop(target);
        const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        const zoom = Math.max(1, Math.min(8, Math.round(crop.zoom * zoomFactor * 100) / 100));
        applyCrop(target, { ...crop, zoom });
        queueCropCommit(target);
        event.preventDefault();
        event.stopPropagation();
      }, { passive: false });
      root?.addEventListener("pointermove", (event) => {
        if (!activeTransform) return;
        const dx = (event.clientX - activeTransform.startX) / activeTransform.scale;
        const dy = (event.clientY - activeTransform.startY) / activeTransform.scale;
        if (Math.abs(dx) > .25 || Math.abs(dy) > .25) activeTransform.moved = true;
        const target = activeTransform.target;
        if (activeTransform.mode === "crop-frame") {
          const layout = resizeCropFrame(activeTransform.layout, activeTransform.cropEdge || "", dx, dy);
          Object.assign(target.style, {
            height: layout.height + "px",
            left: layout.x + "px",
            top: layout.y + "px",
            width: layout.width + "px",
          });
          return;
        }
        if (activeTransform.mode === "crop") {
          const zoom = activeTransform.crop.zoom;
          applyCrop(target, {
            focusX: activeTransform.crop.focusX - dx / Math.max(1, activeTransform.layout.width * zoom),
            focusY: activeTransform.crop.focusY - dy / Math.max(1, activeTransform.layout.height * zoom),
            zoom,
          });
          return;
        }
        if (activeTransform.mode === "move") {
          const maxX = Math.max(0, canvasWidth - activeTransform.layout.width);
          const maxY = Math.max(0, canvasHeight - activeTransform.layout.height);
          const x = Math.max(0, Math.min(maxX, activeTransform.layout.x + dx));
          const y = Math.max(0, Math.min(maxY, activeTransform.layout.y + dy));
          const nextX = snapEnabled ? Math.min(maxX, Math.round(x / 16) * 16) : Math.round(x);
          const nextY = snapEnabled ? Math.min(maxY, Math.round(y / 16) * 16) : Math.round(y);
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
      });
      const finishTransform = (event) => {
        if (!activeTransform) return;
        const transform = activeTransform;
        activeTransform = null;
        transform.target.releasePointerCapture?.(event.pointerId);
        if (!transform.moved || !selectedHfId) return;
        if (transform.mode === "crop") {
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
        if (message.type === "courseforge-composition-seek") seek(message.seconds, true);
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
      seek(0);
      root?.setAttribute("data-preview-ready", "true");
      window.parent.postMessage({ type: "courseforge-composition-ready", duration, selectedHfId }, "*");
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
