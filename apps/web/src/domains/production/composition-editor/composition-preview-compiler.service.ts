import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";

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
  const deckStyles = document.deckStyles
    ? `${document.deckStyles.fontUrls.map((url) => `@import url(${JSON.stringify(replaceUrls(url, params.deckAssetUrls))});`).join("\n")}\n${replaceUrls(document.deckStyles.css, params.deckAssetUrls)}`
    : "";
  const clips = document.clips
    .slice()
    .sort((left, right) => left.layout.zIndex - right.layout.zIndex || left.startSeconds - right.startSeconds)
    .map((clip, index) => renderClip(clip, params.assetUrls, params.deckAssetUrls, target, index))
    .join("\n");
  const hasAudibleMedia = document.clips.some((clip) => (
    clip.kind === "AUDIO" || (clip.kind === "VIDEO" && clip.trackId === "avatar")
  ));
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
    #composition-root { --preview-scale: 1; position: absolute; left: 50%; top: 50%; width: ${document.canvas.width}px; height: ${document.canvas.height}px; overflow: hidden; background: #020617; transform: translate(-50%, -50%) scale(var(--preview-scale)); transform-origin: center; }
    .clip { position: absolute; inset: 0;${isInteractivePreview ? " pointer-events: none;" : ""} }
    .clip-content { position: absolute; transform-origin: top left;${isInteractivePreview ? " pointer-events: auto;" : ""} visibility: hidden; }
    ${isInteractivePreview ? `.clip-content[data-selected="true"] { outline: 4px solid #22d3ee; outline-offset: -4px; }
    .clip-content[data-selected="true"]::after { content: ""; position: absolute; inset: 0; border: 1px solid rgba(8,145,178,.9); pointer-events: none; }
    .composition-resize-handle { position: absolute; right: -7px; bottom: -7px; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 3px; background: #0891b2; box-shadow: 0 1px 4px rgba(0,0,0,.45); cursor: nwse-resize; z-index: 2147483647; }` : ""}
    .composition-media { width: 100%; height: 100%; object-fit: cover; display: block; }
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
    </div>
    ${isInteractivePreview && hasAudibleMedia ? '<button id="composition-audio-unlock" class="composition-audio-unlock" type="button">Activar audio y reproducir</button>' : ""}
  </div>
  ${animationRuntime ? `<script>${animationRuntime}</script>` : '<script src="assets/gsap.min.js"></script>'}
  ${renderTimelineInitializer(document)}
  ${isInteractivePreview ? renderInteractivePreviewController(document) : ""}
</body>
</html>`;
}

function renderClip(
  clip: CompositionClip,
  assetUrls: Map<string, string>,
  deckAssetUrls: Map<string, string> | undefined,
  target: CompositionCompilationTarget,
  clipIndex: number,
) {
  const isHyperframesRender = target === COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER;
  const layout = `left:${clip.layout.x}px;top:${clip.layout.y}px;width:${clip.layout.width}px;height:${clip.layout.height}px;opacity:${clip.layout.opacity};z-index:${clip.layout.zIndex};transform:rotate(${clip.layout.rotation}deg);`;
  const common = `id="${escapeAttribute(clip.id)}" data-hf-id="${escapeAttribute(clip.hfId)}" style="${layout}"`;
  const timing = `data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${trackIndex(clip.trackId, clipIndex)}"`;
  const mediaOffset = `data-source-offset="${clip.sourceOffsetSeconds || 0}"${isHyperframesRender ? ` data-media-start="${clip.sourceOffsetSeconds || 0}"` : ""}`;
  const hidden = clip.hidden ? (isHyperframesRender ? ' data-hidden="true"' : ' data-clip-hidden="true"') : "";
  if (clip.source.type === "DECK_SLIDE") {
    return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${timing}><div ${common} class="clip-content deck-content"><div class="deck-scope"><div class="deck-shell"><main class="deck-stage"><section class="${escapeAttribute(clip.source.classes)}">${replaceUrls(clip.source.html, deckAssetUrls)}</section></main></div></div></div></section>`;
  }
  const sourceUrl = assetUrls.get(clip.source.productionAssetId);
  if (!sourceUrl) throw new CompositionPreviewCompilerError(`No existe URL de preview para el asset ${clip.source.productionAssetId}.`);
  if (clip.kind === "AUDIO") {
    return `<audio id="${escapeAttribute(clip.id)}" class="composition-audio${isHyperframesRender ? " clip" : ""}" data-hf-id="${escapeAttribute(clip.hfId)}"${hidden} ${mediaOffset} data-volume="1" src="${escapeAttribute(sourceUrl)}" ${timing}></audio>`;
  }
  if (clip.kind === "VIDEO" && isHyperframesRender) {
    const video = `<video id="${escapeAttribute(clip.id)}-media" class="composition-media clip" src="${escapeAttribute(sourceUrl)}" muted playsinline preload="metadata" ${mediaOffset}${hidden} ${timing}></video>`;
    const audio = clip.trackId === "avatar"
      ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio clip" src="${escapeAttribute(sourceUrl)}" ${mediaOffset}${hidden} data-volume="1" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${10 + clipIndex}"></audio>`
      : "";
    return `<div ${common} class="clip-content">${video}</div>${audio}`;
  }
  const media = clip.kind === "VIDEO"
    ? `<video class="composition-media" src="${escapeAttribute(sourceUrl)}" muted playsinline preload="metadata" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" ${mediaOffset}></video>${clip.trackId === "avatar" ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio"${hidden} src="${escapeAttribute(sourceUrl)}" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" ${mediaOffset} data-volume="1"></audio>` : ""}`
    : `<img class="composition-media" src="${escapeAttribute(sourceUrl)}" alt="" />`;
  return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${timing}><div ${common} class="clip-content">${media}</div></section>`;
}

function replaceUrls(value: string, replacements?: Map<string, string>) {
  if (!replacements || replacements.size === 0) return value;
  let result = value;
  for (const [sourceUrl, replacementUrl] of replacements) {
    result = result.split(sourceUrl).join(replacementUrl);
  }
  return result;
}

function renderTimelineInitializer(document: CompositionEditorDocument) {
  const clipMetadata = document.clips.map((clip) => ({
    duration: clip.durationSeconds,
    hfId: clip.hfId,
    hidden: clip.hidden,
    id: clip.id,
    kind: clip.kind,
    start: clip.startSeconds,
  }));
  return `<script>
    (() => {
      const clips = ${JSON.stringify(clipMetadata)};
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
      const timeline = window.__timelines["courseforge-composition"];
      let selectedHfId = null;
      let activeTransform = null;
      let playbackTimer = null;
      let playbackActive = false;
      let currentTime = 0;
      const activeMedia = new Set();
      const reportedMediaErrors = new WeakSet();
      const duration = ${document.canvas.durationSeconds};
      const fitCompositionToViewport = () => {
        if (!root || !viewport) return;
        const scale = Math.min(viewport.clientWidth / ${document.canvas.width}, viewport.clientHeight / ${document.canvas.height});
        root.style.setProperty("--preview-scale", String(Math.max(0, scale)));
      };
      const mediaIdentity = (media) => media.id || media.getAttribute("src") || media.tagName.toLowerCase();
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
      const requestMediaPlayback = (media) => {
        if (!playbackActive || !media.paused) return;
        const playRequest = media.play();
        if (!playRequest || typeof playRequest.catch !== "function") return;
        playRequest.then(() => {
          reportedMediaErrors.delete(media);
          if (audioUnlock) audioUnlock.dataset.visible = "false";
        }).catch((error) => {
          reportMediaError(media, error);
          if (error?.name === "NotAllowedError") {
            playbackActive = false;
            if (playbackTimer) window.cancelAnimationFrame(playbackTimer);
            playbackTimer = null;
            if (audioUnlock) audioUnlock.dataset.visible = "true";
            document.querySelectorAll("audio, video").forEach((candidate) => candidate.pause());
            window.parent.postMessage({ type: "courseforge-composition-playback", playing: false }, "*");
          }
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
          const volume = Number(media.dataset.volume || 1);
          media.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
          if (Number.isFinite(media.duration)) {
            const next = Math.max(0, Math.min(media.duration, sourceOffset + time - start));
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
      audioUnlock?.addEventListener("click", () => play());
      const selectTarget = (target) => {
        if (!target) return;
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll(".composition-resize-handle").forEach((node) => node.remove());
        target.setAttribute("data-selected", "true");
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "composition-resize-handle";
        handle.setAttribute("aria-label", "Redimensionar elemento");
        target.appendChild(handle);
        selectedHfId = target.dataset.hfId || null;
        const box = target.getBoundingClientRect();
        window.parent.postMessage({ type: "courseforge-composition-selection", hfId: selectedHfId, bounds: { height: box.height, width: box.width, x: box.x, y: box.y } }, "*");
      };
      const clearTarget = () => {
        document.querySelectorAll("[data-selected='true']").forEach((node) => node.removeAttribute("data-selected"));
        document.querySelectorAll(".composition-resize-handle").forEach((node) => node.remove());
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
        const handle = event.target.closest(".composition-resize-handle");
        const target = handle?.parentElement || event.target.closest("[data-hf-id]");
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
        activeTransform = { startX: event.clientX, startY: event.clientY, layout, mode: handle ? "resize" : "move", moved: false, preserveRatio: !event.altKey, scale, target };
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
        if (activeTransform.mode === "move") {
          target.style.left = Math.round(activeTransform.layout.x + dx) + "px";
          target.style.top = Math.round(activeTransform.layout.y + dy) + "px";
          return;
        }
        const width = Math.max(24, activeTransform.layout.width + dx);
        const height = activeTransform.preserveRatio
          ? Math.max(24, width * (activeTransform.layout.height / activeTransform.layout.width))
          : Math.max(24, activeTransform.layout.height + dy);
        target.style.width = Math.round(width) + "px";
        target.style.height = Math.round(height) + "px";
      });
      const finishTransform = (event) => {
        if (!activeTransform) return;
        const transform = activeTransform;
        activeTransform = null;
        transform.target.releasePointerCapture?.(event.pointerId);
        if (!transform.moved || !selectedHfId) return;
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
  if (trackId === "visual") return 1;
  if (trackId === "audio") return 10 + clipIndex;
  return 3;
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
