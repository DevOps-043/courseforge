import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { RenderInternals } from "@remotion/renderer";
import sharp from "sharp";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import {
  COMPOSITION_COMPILATION_TARGETS,
  compileCompositionPreview,
  readCompositionAnimationRuntime,
} from "../composition-preview-compiler.service";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "../composition-preview-protocol";
import { COMPOSITION_CONFORMANCE_THRESHOLDS } from "../composition-preview-render-conformance";
import { captureCompositionQaScreenshot, compositionQaDelay, launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";

const runFile = promisify(execFile);
const outputDirectory = resolve(process.cwd(), ".tmp/composition-video-freeze-qa");
const assetId = "55555555-5555-4555-8555-555555555558";
const checkpoints = [
  { label: "moving-red", seconds: 0.5 },
  { label: "last-source-color", seconds: 1.5 },
  { label: "frozen-tail", seconds: 2.5 },
] as const;

async function main() {
  process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE = "true";
  await mkdir(resolve(outputDirectory, "render/assets"), { recursive: true });
  await mkdir(resolve(outputDirectory, "preview"), { recursive: true });
  const framesDirectory = resolve(outputDirectory, "source-frames");
  await mkdir(framesDirectory, { recursive: true });
  const videoPath = resolve(outputDirectory, "synthetic.mp4");
  const [redFrame, greenFrame] = await Promise.all([
    sharp({ create: { width: 160, height: 90, channels: 3, background: "#ff0000" } }).png().toBuffer(),
    sharp({ create: { width: 160, height: 90, channels: 3, background: "#00ff00" } }).png().toBuffer(),
  ]);
  await Promise.all(Array.from({ length: 50 }, (_, frame) => (
    writeFile(resolve(framesDirectory, `frame-${String(frame).padStart(3, "0")}.png`), frame < 25 ? redFrame : greenFrame)
  )));
  const ffmpegPath = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  await runFile(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", "25", "-i", resolve(framesDirectory, "frame-%03d.png"),
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-movflags", "+faststart", videoPath,
  ], { timeout: 20_000 });
  const videoBytes = await readFile(videoPath);
  const videoUrl = `data:video/mp4;base64,${videoBytes.toString("base64")}`;
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: createHash("sha256").update(videoBytes).digest("hex"), durationSeconds: 2, fileSizeBytes: videoBytes.length, hasAudio: false, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, sourceHeight: 90, sourceWidth: 160, storageBucket: "production-assets", storagePath: "production-assets/qa-freeze.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#000000", durationSeconds: 3, subtitle: "", title: "Freeze QA" },
  });
  document.canvas.durationSeconds = 3;
  document.canvas.width = 320;
  document.canvas.height = 180;
  const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
  video.durationSeconds = 3;
  video.layout = { height: 180, opacity: 1, rotation: 0, width: 320, x: 0, y: 0, zIndex: 0 };
  const frozen = applyCompositionEditorPatches(document, [{ clipId: video.id, enabled: true, type: "clip.freeze-tail" }]);
  const documentHash = hashCompositionDocument(frozen);
  const assetUrls = new Map([[assetId, videoUrl]]);
  const previewHtml = await compileCompositionPreview({ assetUrls, document: frozen, documentHash, target: COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW });
  const renderHtml = await compileCompositionPreview({ assetUrls, document: frozen, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  const renderRuntime = await readFile(require.resolve("@hyperframes/core/runtime"), "utf8");
  const animationRuntime = await readCompositionAnimationRuntime();
  await Promise.all([
    writeFile(resolve(outputDirectory, "preview/index.html"), previewHtml, "utf8"),
    writeFile(resolve(outputDirectory, "render/index.html"), renderHtml.replace("</body>", `<script>window.__HF_EXPORT_RENDER_SEEK_CONFIG={fps:${frozen.canvas.fps},fpsSource:"render-options"};</script><script src="./assets/hyperframe.runtime.iife.js"></script></body>`), "utf8"),
    writeFile(resolve(outputDirectory, "render/assets/gsap.min.js"), animationRuntime, "utf8"),
    writeFile(resolve(outputDirectory, "render/assets/hyperframe.runtime.iife.js"), renderRuntime, "utf8"),
  ]);

  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-freeze-" });
  try {
    await browser.client.send("Emulation.setDeviceMetricsOverride", { deviceScaleFactor: 1, height: 180, mobile: false, width: 320 });
    const preview = await captureTarget(browser.client, "preview");
    const render = await captureTarget(browser.client, "render");
    const failures: string[] = [];
    for (const [target, samples] of [["preview", preview], ["render", render]] as const) {
      if (!isRed(samples[0]!)) failures.push(`${target}: el primer segundo no muestra el frame rojo.`);
      if (!isGreen(samples[1]!) || !isGreen(samples[2]!)) failures.push(`${target}: el último frame no permanece verde durante la cola.`);
    }
    const frameComparisons = await Promise.all(checkpoints.map(async ({ label }) => ({
      label,
      ...await compareScreenshots(`preview-${label}.png`, `render-${label}.png`),
    })));
    const tailComparisons = await Promise.all(["preview", "render"].map(async (target) => ({
      target,
      ...await compareScreenshots(`${target}-last-source-color.png`, `${target}-frozen-tail.png`),
    })));
    for (const comparison of [...frameComparisons, ...tailComparisons]) {
      if (comparison.meanAbsoluteError > COMPOSITION_CONFORMANCE_THRESHOLDS.maxMeanAbsoluteError
        || comparison.mismatchedPixelRatio > COMPOSITION_CONFORMANCE_THRESHOLDS.maxMismatchedPixelRatio) {
        failures.push(`Diferencia visual excesiva en ${"label" in comparison ? comparison.label : comparison.target}.`);
      }
    }
    const encodedVideo = await verifyEncodedRender(browser.client, ffmpegPath);
    failures.push(...encodedVideo.failures);
    const report = { browserPath: browser.browserPath, documentHash, encodedVideo, failures, frameComparisons, preview, render, status: failures.length ? "FAIL" : "PASS", tailComparisons };
    await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ ...report, outputDirectory }, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function verifyEncodedRender(client: CompositionQaCdpClient, ffmpegPath: string) {
  const framesDirectory = resolve(outputDirectory, "encoded-frames");
  await mkdir(framesDirectory, { recursive: true });
  for (let frameIndex = 0; frameIndex < 75; frameIndex += 1) {
    await seek(client, "render", frameIndex / 25);
    await evaluate(client, `new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`, true);
    await writeFile(resolve(framesDirectory, `frame-${String(frameIndex).padStart(3, "0")}.png`), await captureCompositionQaScreenshot(client));
  }
  const exportedPath = resolve(outputDirectory, "encoded-render.mp4");
  await runFile(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y", "-framerate", "25",
    "-i", resolve(framesDirectory, "frame-%03d.png"), "-c:v", "libx264",
    "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", exportedPath,
  ], { timeout: 60_000 });
  const ffprobePath = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffprobe" });
  const { stdout } = await runFile(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "json", exportedPath], { timeout: 10_000 });
  const metadata = JSON.parse(stdout) as { format?: { duration?: string } };
  const durationSeconds = Number(metadata.format?.duration);
  const failures: string[] = [];
  if (!Number.isFinite(durationSeconds) || Math.abs(durationSeconds - 3) > 1 / 25) {
    failures.push(`El MP4 local tiene una duración inesperada: ${durationSeconds} s.`);
  }
  const decodedSamples: Array<[number, number, number]> = [];
  for (const checkpoint of checkpoints) {
    const outputPath = resolve(outputDirectory, `decoded-${checkpoint.label}.png`);
    await runFile(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-ss", String(checkpoint.seconds),
      "-i", exportedPath, "-frames:v", "1", outputPath,
    ], { timeout: 10_000 });
    const { data } = await sharp(outputPath).extract({ left: 160, top: 90, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    decodedSamples.push([data[0]!, data[1]!, data[2]!]);
  }
  if (!isRed(decodedSamples[0]!)) failures.push("El MP4 local perdió el frame rojo inicial.");
  if (!isGreen(decodedSamples[1]!) || !isGreen(decodedSamples[2]!)) failures.push("El MP4 local no conserva el último frame verde.");
  return { decodedSamples, durationSeconds, failures, outputPath: exportedPath };
}

async function compareScreenshots(firstName: string, secondName: string) {
  const [first, second] = await Promise.all([firstName, secondName].map(async (name) => (
    sharp(resolve(outputDirectory, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  )));
  if (first.info.width !== second.info.width || first.info.height !== second.info.height) {
    throw new Error(`Las capturas ${firstName} y ${secondName} no tienen la misma dimensión.`);
  }
  let absoluteDifference = 0;
  let mismatchedPixels = 0;
  for (let offset = 0; offset < first.data.length; offset += 4) {
    let mismatched = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(first.data[offset + channel]! - second.data[offset + channel]!);
      absoluteDifference += difference;
      if (difference > COMPOSITION_CONFORMANCE_THRESHOLDS.pixelDifferenceThreshold) mismatched = true;
    }
    if (mismatched) mismatchedPixels += 1;
  }
  const pixelCount = first.info.width * first.info.height;
  return {
    meanAbsoluteError: absoluteDifference / (pixelCount * 3),
    mismatchedPixelRatio: mismatchedPixels / pixelCount,
  };
}

async function captureTarget(client: CompositionQaCdpClient, target: "preview" | "render") {
  await client.send("Page.navigate", { url: pathToFileURL(resolve(outputDirectory, target, "index.html")).href });
  await waitForReadiness(client, target);
  const samples: Array<[number, number, number]> = [];
  for (const checkpoint of checkpoints) {
    await seek(client, target, checkpoint.seconds);
    await compositionQaDelay(200);
    const screenshot = await captureCompositionQaScreenshot(client);
    await writeFile(resolve(outputDirectory, `${target}-${checkpoint.label}.png`), screenshot);
    const { data } = await sharp(screenshot).extract({ left: 160, top: 90, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    samples.push([data[0]!, data[1]!, data[2]!]);
  }
  if (samples.length !== checkpoints.length) throw new Error(`Captura incompleta en ${target}.`);
  return samples;
}

async function waitForReadiness(client: CompositionQaCdpClient, target: "preview" | "render") {
  const expression = target === "preview"
    ? `document.getElementById("composition-root")?.dataset.previewReady === "true"`
    : `window.__playerReady === true && typeof window.__player?.renderSeek === "function"`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate<boolean>(client, expression)) return;
    await compositionQaDelay(100);
  }
  throw new Error(`${target} no quedó listo para la prueba de congelación.`);
}

async function seek(client: CompositionQaCdpClient, target: "preview" | "render", seconds: number) {
  if (target === "render") {
    await evaluate(client, `(async()=>{window.__player.renderSeek(${seconds});if(window.__hfWaitForSeekCompletion)await window.__hfWaitForSeekCompletion();return true})()`, true);
    return;
  }
  await evaluate(client, `new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("seek timeout")),5000);const listener=(event)=>{if(event.source!==window||event.data?.type!=="courseforge-composition-time"||Math.abs(event.data.seconds-${seconds})>0.01)return;clearTimeout(timeout);window.removeEventListener("message",listener);resolve(true)};window.addEventListener("message",listener);window.postMessage({protocolVersion:${COMPOSITION_PREVIEW_PROTOCOL_VERSION},seconds:${seconds},type:"courseforge-composition-seek"},"*")})`, true);
}

async function evaluate<T>(client: CompositionQaCdpClient, expression: string, awaitPromise = false): Promise<T> {
  const result = await client.send("Runtime.evaluate", { awaitPromise, expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}

function isRed([red, green, blue]: [number, number, number]) { return red > 150 && green < 80 && blue < 80; }
function isGreen([red, green, blue]: [number, number, number]) { return green > 100 && red < 80 && blue < 80; }

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
