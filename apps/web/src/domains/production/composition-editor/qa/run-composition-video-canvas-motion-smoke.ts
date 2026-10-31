import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { COMPOSITION_MOTION_PRESETS, createCompositionPresetAnimation } from "../composition-motion-preset.service";
import type { CompositionMotionPresetId } from "../composition-motion.types";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS, readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { launchCompositionQaBrowser, captureCompositionQaScreenshot, compositionQaDelay, type CompositionQaCdpClient } from "./composition-qa-browser";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const BASE = { x: 180, y: 120, width: 80, height: 80 };

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value: T }).value;
}

function fixture(presetId: CompositionMotionPresetId, treated = false) {
  const document = createInitialCompositionDocument({ animatedDeck: { width: 640, height: 360, css: "", fonts: [],
    slides: [{ index: 0, label: "Base de duración", classes: "slide", animationCount: 0, html: "<section></section>" }] }, assets: [],
    plan: { title: "Motion en video", subtitle: "", accentColor: "#38BDF8", durationSeconds: 6 } });
  document.canvas = { ...document.canvas, width: 640, height: 360, durationSeconds: 6 };
  document.tracks = [{ id: "visual", kind: "VISUAL", label: "Imagen", order: 0, locked: false }];
  document.clips = [{ id: "image", hfId: "image", kind: "IMAGE", trackId: "visual", label: "Imagen roja",
    startSeconds: 0, durationSeconds: 6, hidden: false, timingSource: "USER_EDITED",
    layout: { ...BASE, opacity: 1, rotation: 0, zIndex: 1 },
    source: { type: "PRODUCTION_ASSET", productionAssetId: ASSET_ID },
    ...(treated ? { crop: { top: 0, right: 0, bottom: 0, left: 10 }, mask: { shape: "CIRCLE" as const } } : {}),
  }];
  document.motion.animations = [createCompositionPresetAnimation({ animationId: "motion", clipId: "image", origin: "PRESET",
    presetId, durationSeconds: presetId === "FLOAT" || presetId === "SWAY" || presetId === "PULSE" || presetId === "BREATHE" || presetId === "HIDE" || presetId === "FADE_HIDE" ? 2 : 1,
    clipDurationSeconds: 6 })];
  return compositionEditorDocumentSchema.parse(document);
}

async function frame(client: CompositionQaCdpClient, time: number) {
  await evaluate(client, `window.__timelines["courseforge-composition"].time(${time},true); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  const png = await captureCompositionQaScreenshot(client);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let redPixels = 0, outsideAsset = 0, left = info.width, right = -1, top = info.height, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const index = (y * info.width + x) * info.channels;
    if (data[index]! < 180 || data[index + 1]! > 40 || data[index + 2]! > 40) continue;
    redPixels++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    if (x < BASE.x || x >= BASE.x + BASE.width || y < BASE.y || y >= BASE.y + BASE.height) outsideAsset++;
  }
  return { png, data, redPixels, outsideAsset, left, right, top, bottom };
}

async function main() {
  const output = resolve(".tmp/video-canvas-motion-qa");
  await mkdir(join(output, "assets"), { recursive: true });
  await writeFile(join(output, "assets/gsap.min.js"), await readCompositionAnimationRuntime());
  const imagePath = join(output, "red.png");
  await sharp({ create: { width: 80, height: 80, channels: 3, background: "#ff0000" } }).png().toFile(imagePath);
  const assetUrls = new Map([[ASSET_ID, pathToFileURL(imagePath).href]]);
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-video-canvas-motion-" });
  const reports: unknown[] = [];
  const targets = [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER];
  async function navigate(presetId: CompositionMotionPresetId, target: typeof targets[number], treated = false) {
    await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
    const path = join(output, "composition.html");
    await writeFile(path, await compileCompositionPreview({ document: fixture(presetId, treated), target, assetUrls }));
    await browser.client.send("Page.navigate", { url: pathToFileURL(path).href });
    const deadline = Date.now() + 10_000;
    while (!await evaluate(browser.client, `Boolean(window.__timelines?.["courseforge-composition"]) && document.getElementById('image-media')?.complete`)) {
      if (Date.now() > deadline) throw new Error("No se inició el fixture de motion.");
      await compositionQaDelay(50);
    }
  }
  try {
    for (const preset of COMPOSITION_MOTION_PRESETS) {
      let preview: Buffer | undefined;
      const time = preset.phase === "EXIT" ? 5.99 : preset.phase === "PLAYBACK" ? 2.75 : preset.id.startsWith("SLIDE_IN") ? 0.01 : 0.72;
      for (const target of targets) {
        await navigate(preset.id, target);
        const current = await frame(browser.client, time);
        if (preset.id.startsWith("SLIDE") || ["POP", "PULSE", "FLOAT", "SWAY"].includes(preset.id)) {
          assert.ok(current.outsideAsset > 0, `${preset.id}: debe pintar fuera del rectángulo estático del asset.`);
        }
        await frame(browser.client, Math.min(5.999, time + 0.2));
        assert.deepEqual((await frame(browser.client, time)).data, current.data, `${preset.id}: seek inverso distinto.`);
        if (preview) assert.deepEqual(current.data, preview, `${preset.id}: diferencia preview/render.`);
        else preview = current.data;
        if (preset.id === "SLIDE_IN_RIGHT") {
          await writeFile(join(output, `${target}-outside-asset.png`), current.png);
          // Control negativo: restituir el recorte anterior debe reproducir el defecto.
          await evaluate(browser.client, `document.getElementById('image').style.overflow='hidden'; true`);
          assert.equal((await frame(browser.client, time)).outsideAsset, 0);
        }
        reports.push({ preset: preset.id, target, redPixels: current.redPixels, outsideAsset: current.outsideAsset, reverseSeek: "PASS" });
      }
    }
    let treatedPreview: Buffer | undefined;
    for (const target of targets) {
      await navigate("SLIDE_IN_RIGHT", target, true);
      const treated = await frame(browser.client, 0.01);
      const position = await evaluate<{ x: number }>(browser.client, `({ x: document.getElementById('image-motion').getBoundingClientRect().x })`);
      assert.ok(treated.outsideAsset > 0);
      assert.ok(treated.redPixels > 1_000 && treated.redPixels < 5_600, "La máscara circular debe seguir recortando la imagen.");
      assert.ok(treated.left >= Math.floor(position.x + 10), "El crop debe viajar con el sujeto.");
      if (treatedPreview) assert.deepEqual(treated.data, treatedPreview);
      else treatedPreview = treated.data;
      await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 480, deviceScaleFactor: 1, mobile: false });
      await evaluate(browser.client, `document.getElementById('composition-root').style.setProperty('transform','translate(-50%,-50%)','important'); document.getElementById('image').style.left='620px'; true`);
      const edge = await frame(browser.client, 1.1);
      const root = await evaluate<{ right: number; left: number; top: number; bottom: number }>(browser.client, `(() => {const box=document.getElementById('composition-root').getBoundingClientRect(); return {left:box.left,right:box.right,top:box.top,bottom:box.bottom}})()`);
      assert.ok(edge.redPixels > 0, "Debe quedar visible la parte dentro del video.");
      assert.ok(edge.left >= root.left && edge.right < root.right && edge.top >= root.top && edge.bottom < root.bottom, "El canvas debe recortar el contenido fuera del video.");
      reports.push({ target, cropAndMask: "PASS", canvasEdge: "PASS" });
    }
    await writeFile(join(output, "report.json"), JSON.stringify(reports, null, 2));
    process.stdout.write("OK: 19 presets en preview/render, píxeles fuera del asset, crop, máscara, canvas y seek inverso.\n");
  } finally { await browser.close(); }
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
