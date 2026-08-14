import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompositionClip, CompositionEditorDocument } from "./composition-document.types";

export class CompositionPreviewCompilerError extends Error {}

/**
 * Compiles the native document into an isolated, seekable review document.
 * The document is not persisted and never becomes the editable source of truth.
 */
export async function compileCompositionPreview(params: {
  assetUrls: Map<string, string>;
  document: CompositionEditorDocument;
}) {
  const animationRuntime = await readAnimationRuntime();
  const { document } = params;
  const deckStyles = document.deckStyles
    ? `${document.deckStyles.fontUrls.map((url) => `@import url(${JSON.stringify(url)});`).join("\n")}\n${document.deckStyles.css}`
    : "";
  const clips = document.clips
    .slice()
    .sort((left, right) => left.layout.zIndex - right.layout.zIndex || left.startSeconds - right.startSeconds)
    .map((clip) => renderClip(clip, params.assetUrls))
    .join("\n");
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
    .clip { position: absolute; inset: 0; pointer-events: none; }
    .clip-content { position: absolute; transform-origin: top left; pointer-events: auto; visibility: hidden; }
    .clip-content[data-selected="true"] { outline: 4px solid #22d3ee; outline-offset: -4px; }
    .clip-content[data-selected="true"]::after { content: ""; position: absolute; inset: 0; border: 1px solid rgba(8,145,178,.9); pointer-events: none; }
    .composition-resize-handle { position: absolute; right: -7px; bottom: -7px; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 3px; background: #0891b2; box-shadow: 0 1px 4px rgba(0,0,0,.45); cursor: nwse-resize; z-index: 2147483647; }
    .composition-media { width: 100%; height: 100%; object-fit: cover; display: block; }
    .composition-audio { display: none; }
    .deck-content { overflow: hidden; }
    .deck-content .deck-scope, .deck-content .deck-scope > .slide { width: 100%; height: 100%; }
    ${deckStyles}
  </style>
</head>
<body>
  <div id="composition-viewport">
    <div id="composition-root" data-composition-id="courseforge-composition" data-start="0" data-width="${document.canvas.width}" data-height="${document.canvas.height}" data-duration="${document.canvas.durationSeconds}" data-fps="${document.canvas.fps}">
      ${clips}
    </div>
  </div>
  <script>${animationRuntime}</script>
  ${renderPreviewController(document)}
</body>
</html>`;
}

function renderClip(clip: CompositionClip, assetUrls: Map<string, string>) {
  const layout = `left:${clip.layout.x}px;top:${clip.layout.y}px;width:${clip.layout.width}px;height:${clip.layout.height}px;opacity:${clip.layout.opacity};z-index:${clip.layout.zIndex};transform:rotate(${clip.layout.rotation}deg);`;
  const common = `id="${escapeAttribute(clip.id)}" data-hf-id="${escapeAttribute(clip.hfId)}" style="${layout}"`;
  const timing = `data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-track-index="${trackIndex(clip.trackId)}"`;
  if (clip.source.type === "DECK_SLIDE") {
    return `<section class="clip" ${timing}><div ${common} class="clip-content deck-content"><div class="deck-scope"><section class="${escapeAttribute(clip.source.classes)}">${clip.source.html}</section></div></div></section>`;
  }
  const sourceUrl = assetUrls.get(clip.source.productionAssetId);
  if (!sourceUrl) throw new CompositionPreviewCompilerError(`No existe URL de preview para el asset ${clip.source.productionAssetId}.`);
  if (clip.kind === "AUDIO") {
    return `<audio id="${escapeAttribute(clip.id)}" class="composition-audio" data-hf-id="${escapeAttribute(clip.hfId)}" data-clip-hidden="${clip.hidden}" src="${escapeAttribute(sourceUrl)}" ${timing}></audio>`;
  }
  const media = clip.kind === "VIDEO"
    ? `<video class="composition-media" src="${escapeAttribute(sourceUrl)}" muted playsinline preload="metadata" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}"></video>${clip.trackId === "avatar" ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio" data-clip-hidden="${clip.hidden}" src="${escapeAttribute(sourceUrl)}" data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-volume="1"></audio>` : ""}`
    : `<img class="composition-media" src="${escapeAttribute(sourceUrl)}" alt="" />`;
  return `<section class="clip" ${timing}><div ${common} class="clip-content">${media}</div></section>`;
}

function renderPreviewController(document: CompositionEditorDocument) {
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
      const root = document.getElementById("composition-root");
      const viewport = document.getElementById("composition-viewport");
      const clips = ${JSON.stringify(clipMetadata)};
      const timeline = gsap.timeline({ paused: true });
      for (const clip of clips) {
        if (clip.kind === "AUDIO") continue;
        const element = document.getElementById(clip.id);
        if (!element) continue;
        if (clip.hidden) { timeline.set(element, { autoAlpha: 0 }, 0); continue; }
        timeline.set(element, { autoAlpha: 1 }, clip.start);
        timeline.set(element, { autoAlpha: 0 }, clip.start + clip.duration + 0.0001);
      }
      window.__timelines = window.__timelines || {};
      window.__timelines["courseforge-composition"] = timeline;
      let selectedHfId = null;
      let activeTransform = null;
      let playbackTimer = null;
      let currentTime = 0;
      const duration = ${document.canvas.durationSeconds};
      const fitCompositionToViewport = () => {
        if (!root || !viewport) return;
        const scale = Math.min(viewport.clientWidth / ${document.canvas.width}, viewport.clientHeight / ${document.canvas.height});
        root.style.setProperty("--preview-scale", String(Math.max(0, scale)));
      };
      const syncMedia = (time) => {
        document.querySelectorAll("video[data-start], audio[data-start]").forEach((media) => {
          const start = Number(media.dataset.start || 0);
          const clipDuration = Number(media.dataset.duration || 0);
          const active = media.dataset.clipHidden !== "true" && time >= start && time <= start + clipDuration;
          if (media.tagName === "AUDIO") {
            active ? media.play().catch(() => {}) : media.pause();
          }
          if (active && Number.isFinite(media.duration)) {
            const next = Math.max(0, Math.min(media.duration, time - start));
            if (Math.abs(media.currentTime - next) > 0.12) media.currentTime = next;
          }
        });
      };
      const seek = (time) => {
        currentTime = Math.max(0, Math.min(duration, Number(time) || 0));
        timeline.seek(currentTime, false);
        syncMedia(currentTime);
        window.parent.postMessage({ type: "courseforge-composition-time", seconds: currentTime }, "*");
      };
      const pause = () => {
        if (playbackTimer) window.cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
        document.querySelectorAll("audio, video").forEach((media) => media.pause());
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: false }, "*");
      };
      const play = () => {
        pause();
        let last = performance.now();
        const tick = (now) => {
          const next = currentTime + (now - last) / 1000;
          last = now;
          if (next >= duration) { seek(duration); pause(); return; }
          seek(next);
          playbackTimer = window.requestAnimationFrame(tick);
        };
        playbackTimer = window.requestAnimationFrame(tick);
        window.parent.postMessage({ type: "courseforge-composition-playback", playing: true }, "*");
      };
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
        if (message.type === "courseforge-composition-seek") seek(message.seconds);
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

function trackIndex(trackId: string) {
  if (trackId === "deck") return 0;
  if (trackId === "visual") return 1;
  if (trackId === "audio") return 2;
  return 3;
}

async function readAnimationRuntime() {
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
