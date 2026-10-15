import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { cpus, platform, arch } from "node:os";
import sharp from "sharp";
import { createCaptionEffectsFixture } from "../__tests__/composition-caption-effects.fixtures";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS, readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { buildCaptionEffectPlan } from "../composition-caption-effects-plan";
import { launchCompositionQaBrowser, captureCompositionQaScreenshot, compositionQaDelay, type CompositionQaCdpClient } from "./composition-qa-browser";
import { captureTextParityCheckpoint } from "./composition-text-checkpoint-capture";
import { NATIVE_TEXT_GEOMETRY_POLICY } from "../composition-text-parity-contract";
import { benchmarkCaptionEffects } from "./composition-caption-effects-benchmark";

async function evaluate(client: CompositionQaCdpClient, expression: string) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value?: unknown } | undefined)?.value;
}

async function encodeVideo(binary: string, framesDirectory: string, outputPath: string, fps: number) {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(binary, ["-y", "-framerate", String(fps), "-i", join(framesDirectory, "%04d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", outputPath], { shell: false, windowsHide: true });
    let diagnostics = "";
    child.stderr.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`Caption QA encode failed (${code}): ${diagnostics}`)));
  });
}

async function main() {
  const document = createCaptionEffectsFixture();
  const output = resolve(process.cwd(), ".tmp/composition-caption-effects-qa");
  const frames = join(output, "frames");
  await mkdir(join(output, "assets"), { recursive: true });
  await mkdir(frames, { recursive: true });
  const started = performance.now();
  const preview = await compileCompositionPreview({ document, assetUrls: new Map() });
  const render = await compileCompositionPreview({ document, assetUrls: new Map(), target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  const compileMs = performance.now() - started;
  await writeFile(join(output, "preview.html"), preview);
  await writeFile(join(output, "render.html"), render);
  await writeFile(join(output, "document.json"), JSON.stringify(document, null, 2));
  await writeFile(join(output, "assets/gsap.min.js"), await readCompositionAnimationRuntime());
  const checkpoints = [1, 1.125, 1.5, 1.9, 2.9, 3.125, 4.9, 1.9, 1.125];
  const results: Record<string, unknown> = {};
  const previewPixels: Buffer[] = [];
  const encoderIndex = process.argv.indexOf("--ffmpeg");
  const encoder = encoderIndex >= 0 ? resolve(process.argv[encoderIndex + 1] || "missing-ffmpeg") : null;
  for (const target of ["preview", "render"]) {
    process.stdout.write(`Checking caption effects in Chromium (${target})...\n`);
    const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-caption-effects-" });
    try {
      await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 360, deviceScaleFactor: 1, mobile: false });
      await browser.client.send("Page.navigate", { url: pathToFileURL(join(output, `${target}.html`)).href });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate(browser.client, `Boolean(window.__timelines?.["courseforge-composition"])`)) { ready = true; break; }
        await compositionQaDelay(50);
      }
      assert.ok(ready, "Caption effects timeline did not initialize");
      const captures = [];
      for (const seconds of checkpoints) {
        await evaluate(browser.client, `window.__timelines["courseforge-composition"].time(${seconds},true); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        const capture = await captureTextParityCheckpoint(browser.client, document, seconds, NATIVE_TEXT_GEOMETRY_POLICY);
        assert.equal(capture.status, "CAPTURED", `${target} at ${seconds}`);
        const pixels = await sharp(await captureCompositionQaScreenshot(browser.client)).raw().toBuffer();
        if (target === "preview") previewPixels.push(pixels);
        else assert.ok(pixels.equals(previewPixels[captures.length]!), `Pixel difference between preview/export at ${seconds}`);
        captures.push(capture);
      }
      process.stdout.write(`${target}: ${captures.length} checkpoints passed.\n`);
      assert.deepEqual(captures[3]!.expectedTexts, captures[7]!.expectedTexts, "Reverse seek changed caption state");
      results[target] = captures.map((capture) => ({ expectedTexts: capture.expectedTexts, regions: capture.regions }));
      await evaluate(browser.client, `void window.__timelines["courseforge-composition"].time(1.9,true)`);
      await writeFile(join(output, `${target}.png`), await captureCompositionQaScreenshot(browser.client));
      await evaluate(browser.client, `document.getElementById("captions-caption-first-part-2").style.color="#ff0000"; true`);
      await assert.rejects(() => captureTextParityCheckpoint(browser.client, document, 1.9, NATIVE_TEXT_GEOMETRY_POLICY), /CONFORMANCE_TEXT_CAPTURE_RUNTIME_FAILED/);
      await evaluate(browser.client, `window.__timelines["courseforge-composition"].time(1,true); void window.__timelines["courseforge-composition"].time(1.9,true)`);
      if (target === "render" && encoder) {
        for (let frame = 0; frame < document.canvas.fps * 6; frame += 1) {
          await evaluate(browser.client, `window.__timelines["courseforge-composition"].time(${frame / document.canvas.fps},true); new Promise(resolve => requestAnimationFrame(resolve))`);
          await writeFile(join(frames, `${String(frame).padStart(4, "0")}.png`), await captureCompositionQaScreenshot(browser.client));
        }
        await encodeVideo(encoder, frames, join(output, "caption-effects.mp4"), document.canvas.fps);
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(results.preview, results.render, "Preview/export caption appearances differ");
  const benchmark = process.argv.includes("--benchmark") ? await benchmarkCaptionEffects(output) : undefined;
  const report = { status: "PASS", checkpoints: checkpoints.length, reverseSeek: "PASS", previewRenderParity: "PASS", pixelParity: "EXACT", tamperedColorRejected: true,
    localVideo: encoder ? "caption-effects.mp4" : "not requested; pass --ffmpeg <path>",
    compileMs, htmlBytes: Buffer.byteLength(render), runtimeTargets: new Set(buildCaptionEffectPlan(document).map((step) => step.targetId)).size,
    ...(benchmark ? { benchmark } : {}),
    referenceHost: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cpuCount: cpus().length },
    remoteProviderExport: "Not invoked by this local QA; existing provider integration is unchanged" };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  if (error instanceof Error && error.cause) process.stderr.write(`${JSON.stringify(error.cause).slice(0, 4000)}\n`);
  process.exitCode = 1;
});
