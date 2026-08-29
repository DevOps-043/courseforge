import JSZip from "jszip";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { HyperframesAnimatedDeckSource, HyperframesAssetManifestItem } from "./hyperframes.types";
import type { HyperframesPlan } from "./hyperframes-plan.service";

export interface HyperframesProjectAsset extends HyperframesAssetManifestItem {
  durationSeconds?: number;
  hasAudio?: boolean;
  label?: string;
  publicUrl: string | null;
  sceneClipId?: string;
  sceneOrder?: number;
  sourceHeight?: number;
  sourceWidth?: number;
  storageBucket: string;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
}

export interface BuiltHyperframesProject {
  archive: Uint8Array;
  assetFiles: Record<string, string>;
  entryPoint: "index.html";
  previewHtml: string;
  projectHash: string;
  previewTimeline: {
    durationSeconds: number;
    tracks: Array<{ id: string; label: string; segments: Array<{ end: number; label: string; start: number }> }>;
  };
  variablesSchema: unknown[];
  variablesValues: Record<string, unknown>;
}

export interface BuiltHyperframesDraftSource {
  entryPoint: "index.html";
  html: string;
  previewTimeline: BuiltHyperframesProject["previewTimeline"];
  variablesSchema: unknown[];
  variablesValues: Record<string, unknown>;
}

/**
 * Produces editable source without copying media or creating an archive. The
 * visual editor consumes this draft; the archive is intentionally deferred
 * until the author approves a snapshot for cloud rendering.
 */
export async function buildInternalHyperframesDraftSource(params: {
  animatedDeck?: HyperframesAnimatedDeckSource | null;
  assetUrls: Record<string, string>;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
}): Promise<BuiltHyperframesDraftSource> {
  const variablesSchema = [
    { id: "title", type: "string", label: "Título", default: params.plan.title, maxLength: 100 },
    { id: "subtitle", type: "string", label: "Subtítulo", default: params.plan.subtitle, maxLength: 220 },
    { id: "accent", type: "color", label: "Acento", default: params.plan.accentColor },
  ];
  const gsapRuntime = await readBundledGsapRuntime();
  return {
    entryPoint: "index.html",
    html: renderInternalComposition({
      animatedDeck: params.animatedDeck,
      assetFiles: params.assetUrls,
      assets: params.assets,
      plan: params.plan,
      runtimeScript: `<script>${gsapRuntime}</script>`,
      variablesSchema,
    }),
    previewTimeline: buildPreviewTimeline(params.animatedDeck, params.plan.durationSeconds),
    variablesSchema,
    variablesValues: {
      accent: params.plan.accentColor,
      subtitle: params.plan.subtitle,
      title: params.plan.title,
    },
  };
}

/**
 * Compiles a constrained plan into a deterministic, self-contained project.
 * Selected media is copied into the archive so cloud rendering does not depend
 * on runtime network fetches.
 */
export async function buildInternalHyperframesProject(params: {
  animatedDeck?: HyperframesAnimatedDeckSource | null;
  assets: HyperframesProjectAsset[];
  downloadAsset: (asset: HyperframesProjectAsset) => Promise<Uint8Array>;
  plan: HyperframesPlan;
}) : Promise<BuiltHyperframesProject> {
  const zip = new JSZip();
  const assetFiles: Record<string, string> = {};
  for (const asset of params.assets) {
    const fileName = buildAssetFileName(asset);
    const bytes = await params.downloadAsset(asset);
    if (bytes.byteLength !== asset.fileSizeBytes) {
      throw new Error(`El tamaño del asset ${asset.productionAssetId} no coincide con su manifiesto.`);
    }
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== asset.checksum.toLowerCase()) {
      throw new Error(`El checksum del asset ${asset.productionAssetId} no coincide con su manifiesto.`);
    }
    zip.file(fileName, bytes);
    assetFiles[asset.productionAssetId] = fileName;
  }

  const variablesSchema = [
    { id: "title", type: "string", label: "Título", default: params.plan.title, maxLength: 100 },
    { id: "subtitle", type: "string", label: "Subtítulo", default: params.plan.subtitle, maxLength: 220 },
    { id: "accent", type: "color", label: "Acento", default: params.plan.accentColor },
  ];
  const variablesValues = {
    accent: params.plan.accentColor,
    subtitle: params.plan.subtitle,
    title: params.plan.title,
  };
  const gsapRuntime = await readBundledGsapRuntime();
  zip.file("vendor/gsap.min.js", gsapRuntime);
  const indexHtml = renderInternalComposition({ animatedDeck: params.animatedDeck, assetFiles, assets: params.assets, plan: params.plan, runtimeScript: '<script src="vendor/gsap.min.js"></script>', variablesSchema });
  const previewHtml = renderInternalComposition({
    animatedDeck: params.animatedDeck,
    assetFiles: Object.fromEntries(params.assets.map((asset) => [
      asset.productionAssetId,
      asset.publicUrl || assetFiles[asset.productionAssetId],
    ])),
    assets: params.assets,
    plan: params.plan,
    runtimeScript: `<script>${gsapRuntime}</script>`,
    variablesSchema,
  });
  zip.file("index.html", indexHtml);
  zip.file("assets-manifest.json", JSON.stringify({ assetFiles, assets: params.assets }, null, 2));
  zip.file("composition-plan.json", JSON.stringify(params.plan, null, 2));
  const archive = await zip.generateAsync({ compression: "DEFLATE", type: "uint8array" });
  return {
    archive,
    assetFiles,
    entryPoint: "index.html",
    previewHtml,
    projectHash: createHash("sha256").update(archive).digest("hex"),
    previewTimeline: buildPreviewTimeline(params.animatedDeck, params.plan.durationSeconds),
    variablesSchema,
    variablesValues,
  };
}

function renderInternalComposition(params: {
  animatedDeck?: HyperframesAnimatedDeckSource | null;
  assetFiles: Record<string, string>;
  assets: HyperframesProjectAsset[];
  plan: HyperframesPlan;
  runtimeScript: string;
  variablesSchema: unknown[];
}) {
  const firstImage = params.assets.find((asset) => asset.mimeType.startsWith("image/"));
  const firstVideo = params.assets.find((asset) => asset.mimeType.startsWith("video/"));
  const firstAudio = params.assets.find((asset) => asset.mimeType.startsWith("audio/"));
  const visual = params.animatedDeck
    ? renderAnimatedDeckClips(params.animatedDeck, params.plan.durationSeconds)
    : firstVideo
    ? `<video id="visual-video" class="media" src="${escapeAttribute(params.assetFiles[firstVideo.productionAssetId]!)}" data-start="0" data-duration="${params.plan.durationSeconds}" data-track-index="0" muted playsinline></video>`
    : firstImage
      ? `<img id="visual-image" class="media" src="${escapeAttribute(params.assetFiles[firstImage.productionAssetId]!)}" alt="" />`
      : `<div class="media-gradient" aria-hidden="true"></div>`;
  const audio = firstAudio
    ? `<audio id="music" src="${escapeAttribute(params.assetFiles[firstAudio.productionAssetId]!)}" data-start="0" data-duration="${params.plan.durationSeconds}" data-track-index="3" data-volume="0.25"></audio>`
    : "";
  const variables = escapeAttribute(JSON.stringify(params.variablesSchema));
  return `<!doctype html>
<html lang="es" data-composition-variables='${variables}'>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080" />
  <title>${escapeHtml(params.plan.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #07111f; color: #f8fafc; font-family: Arial, sans-serif; }
    #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #07111f; }
    .clip { position: absolute; inset: 0; }
    .media, .media-gradient { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .media { opacity: .34; }
    .media-gradient { background: radial-gradient(circle at 75% 25%, var(--accent, #38bdf8), transparent 35%), linear-gradient(135deg, #0f172a, #111827); }
    .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(2,6,23,.94), rgba(2,6,23,.42)); }
    .copy { position: absolute; left: 150px; top: 280px; width: 1040px; }
    .eyebrow { color: var(--accent, #38bdf8); font-size: 32px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 24px 0; max-width: 1000px; font-size: 108px; line-height: 1.04; }
    p { margin: 0; max-width: 860px; font-size: 42px; line-height: 1.32; color: #dbeafe; }
    .copy-inner { animation: enter .7s ease-out both; }
    @keyframes enter { from { opacity: 0; transform: translateY(36px); } to { opacity: 1; transform: translateY(0); } }
    ${params.animatedDeck?.css || ""}
  </style>
</head>
<body>
  ${params.runtimeScript}
  <div id="root" data-composition-id="courseforge-internal" data-start="0" data-width="1920" data-height="1080" data-duration="${params.plan.durationSeconds}">
    ${params.animatedDeck ? visual : `<section class="clip" data-start="0" data-duration="${params.plan.durationSeconds}" data-track-index="0">${visual}<div class="shade"></div></section>`}
    ${params.animatedDeck ? "" : `<section class="clip" data-start="0" data-duration="${params.plan.durationSeconds}" data-track-index="2"><div class="copy"><div class="copy-inner"><div class="eyebrow">Courseforge</div><h1 data-var-text="title">${escapeHtml(params.plan.title)}</h1><p data-var-text="subtitle">${escapeHtml(params.plan.subtitle)}</p></div></div></section>`}
    ${audio}
  </div>
  ${renderTimelineController(params.plan.durationSeconds)}
</body>
</html>`;
}

function renderAnimatedDeckClips(deck: HyperframesAnimatedDeckSource, durationSeconds: number) {
  const slideDuration = durationSeconds / deck.slides.length;
  const scale = Math.min(1920 / deck.width, 1080 / deck.height);
  const offsetX = (1920 - deck.width * scale) / 2;
  const offsetY = (1080 - deck.height * scale) / 2;
  const fontImports = deck.fonts.map((font) => `@import url("${escapeAttribute(font.href)}");`).join("\n");
  return `${fontImports ? `<style>${fontImports}</style>` : ""}${deck.slides.map((slide, position) => {
    const start = roundSeconds(position * slideDuration);
    const duration = roundSeconds(position === deck.slides.length - 1 ? durationSeconds - start : slideDuration);
    const classes = normalizeDeckClasses(slide.classes);
    return `<section id="deck-slide-${slide.index}" class="clip deck-clip" data-start="${start}" data-duration="${duration}" data-track-index="1"><div class="deck-scope" data-deck-start="${start}" data-deck-duration="${duration}" style="--deck-t:0;position:absolute;width:${deck.width}px;height:${deck.height}px;left:${offsetX}px;top:${offsetY}px;transform:scale(${scale});transform-origin:top left;overflow:hidden"><div class="deck-shell"><main class="deck-stage"><section class="${escapeAttribute(classes)}">${slide.html}</section></main></div></div></section>`;
  }).join("")}`;
}

function renderTimelineController(durationSeconds: number) {
  return `<script>
    (() => {
      const root = document.getElementById("root");
      const clips = Array.from(document.querySelectorAll(".deck-clip"));
      const tl = gsap.timeline({ paused: true });
      clips.forEach((clip) => {
        const stage = clip.querySelector(".deck-scope");
        const start = Number(stage?.dataset.deckStart || 0);
        const duration = Number(stage?.dataset.deckDuration || 0);
        if (stage && duration > 0) tl.to(stage, { "--deck-t": duration, duration }, start);
      });
      tl.set({}, {}, ${durationSeconds});
      window.__timelines = window.__timelines || {};
      window.__timelines["courseforge-internal"] = tl;
      const seek = (seconds) => {
        const time = Math.max(0, Number(seconds) || 0);
        tl.seek(time, false);
        clips.forEach((clip) => {
          const stage = clip.querySelector(".deck-scope");
          const start = Number(stage?.dataset.deckStart || 0);
          const duration = Number(stage?.dataset.deckDuration || 0);
          const active = time >= start && time < start + duration;
          clip.style.opacity = active ? "1" : "0";
          clip.style.pointerEvents = active ? "auto" : "none";
          stage?.style.setProperty("--deck-t", String(Math.min(duration, Math.max(0, time - start))));
        });
      };
      seek(0);
      window.addEventListener("message", (event) => {
        if (event.data?.type === "courseforge-preview-seek") seek(event.data.seconds);
      });
      window.__courseforgePreview = { seek };
      root?.setAttribute("data-preview-ready", "true");
    })();
  </script>`;
}

function normalizeDeckClasses(value: string) {
  const classes = value.split(/\s+/).filter(Boolean);
  return classes.includes("active") ? classes.join(" ") : [...classes, "active"].join(" ");
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}

function buildPreviewTimeline(deck: HyperframesAnimatedDeckSource | null | undefined, durationSeconds: number) {
  if (!deck) {
    return { durationSeconds, tracks: [{ id: "composition", label: "Composición", segments: [{ end: durationSeconds, label: "Video", start: 0 }] }] };
  }
  const each = durationSeconds / deck.slides.length;
  return {
    durationSeconds,
    tracks: [{
      id: "slides",
      label: "Slides HTML",
      segments: deck.slides.map((slide, index) => {
        const start = roundSeconds(index * each);
        return { end: roundSeconds(index === deck.slides.length - 1 ? durationSeconds : start + each), label: slide.label || `Slide ${index + 1}`, start };
      }),
    }],
  };
}

async function readBundledGsapRuntime() {
  // Turbopack rewrites require.resolve() in app routes to a virtual [project]
  // path. Resolve real workspace paths instead, supporting both an app-local
  // install and the hoisted workspace dependency used by this repository.
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
  throw new Error("No se encontró el runtime de animación requerido para el preview.");
}

function buildAssetFileName(asset: HyperframesProjectAsset) {
  const extension = getExtension(asset.mimeType);
  return `assets/${asset.productionAssetId}.${extension}`;
}

function getExtension(mimeType: string) {
  const subtype = mimeType.split("/")[1]?.toLowerCase();
  if (subtype === "mpeg") return "mp3";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype?.replace(/[^a-z0-9]/g, "") || "bin";
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
