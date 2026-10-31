import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { RenderInternals } from "@remotion/renderer";
import sharp from "sharp";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";
import { buildCompositionPreviewScenePatch } from "../composition-preview-scene-patch";
import { compositionQaDelay, launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";

const assetId = "55555555-5555-4555-8555-555555555558";
const replacementId = "55555555-5555-4555-8555-555555555559";
const hash = "a".repeat(64);

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}

async function main() {
  const output = resolve(process.cwd(), ".tmp/composition-preview-scene-qa");
  await mkdir(output, { recursive: true });
  const framePath = resolve(output, "frame.png");
  await sharp({ create: { width: 160, height: 90, channels: 3, background: "#1378bf" } }).png().toFile(framePath);
  const videoPath = resolve(output, "video.mp4");
  const ffmpeg = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  await promisify(execFile)(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", framePath, "-t", "4", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", videoPath], { timeout: 20_000 });
  const videoBytes = await readFile(videoPath);
  let html = "";
  let mediaRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.url === "/video.mp4" || request.url === "/replacement.mp4") {
      mediaRequests += 1;
      response.setHeader("Content-Type", "video/mp4");
      response.end(videoBytes);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const assetUrls = new Map([[assetId, `${origin}/video.mp4`], [replacementId, `${origin}/replacement.mp4`]]);
  const initial = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "b".repeat(64), durationSeconds: 4, fileSizeBytes: videoBytes.length, hasAudio: false, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "video.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 4, subtitle: "", title: "Scene smoke" },
  });
  delete initial.clips[0]!.volume;
  html = await compileCompositionPreview({ document: initial, documentHash: hash, previewGeneration: 1, assetUrls });
  await writeFile(resolve(output, "index.html"), html);
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-scene-smoke-" }).catch((error) => { server.close(); throw error; });
  try {
    await browser.client.send("Page.navigate", { url: origin });
    const videoId = initial.clips[0]!.id;
    const deadline = Date.now() + 10_000;
    while (!await evaluate(browser.client, `Boolean(window.__timelines?.["courseforge-composition"]) && document.querySelector('video')?.readyState >= 2`)) {
      if (Date.now() > deadline) throw new Error("SCENE_SMOKE_READY_TIMEOUT");
      await compositionQaDelay(50);
    }
    await evaluate(browser.client, `window.originalVideo = document.querySelector('video'); window.originalTimeOrigin = performance.timeOrigin; true`);
    let document = initial;
    let sequence = 0;
    const durations: number[] = [];
    async function apply(operations: CompositionEditorPatchOperation[]) {
      const next = applyCompositionEditorPatches(document, operations);
      const scene = buildCompositionPreviewScenePatch({ beforeDocument: document, document: next, assetUrls, audioMetersEnabled: false });
      assert.ok(scene, "La operación debe tener una proyección local.");
      sequence += 1;
      const result = await evaluate<{ applied: boolean; code: string; durationMs: number }>(browser.client, `new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ACK_TIMEOUT")), 2000);
        const listener = (event) => {
          if (event.data?.type !== "courseforge-composition-visual-patch-result" || event.data.sequence !== ${sequence}) return;
          removeEventListener("message", listener); clearTimeout(timeout); resolve(event.data);
        };
        addEventListener("message", listener);
        postMessage(${JSON.stringify({ type: "courseforge-composition-visual-patch", baseDocumentHash: hash, sequence, protocolVersion: 1, patch: { changes: [], scene } }).replace(/</g, "\\u003c")}, "*");
      })`);
      assert.equal(result.code, "APPLIED");
      assert.equal(result.applied, true);
      durations.push(result.durationMs);
      document = next;
      assert.equal(await evaluate(browser.client, "performance.timeOrigin === window.originalTimeOrigin"), true, "No debe navegar el iframe.");
    }

    const text = createCompositionNativeOverlay({ document, id: "live-text", kind: "TEXT", playheadSeconds: 0 });
    const caption = createCompositionNativeOverlay({ document, id: "live-caption", kind: "CAPTION", playheadSeconds: 0 });
    await apply([
      { type: "clip.add", clipId: text.clip.id, clip: text.clip, track: text.track },
      { type: "clip.add", clipId: caption.clip.id, clip: caption.clip, track: caption.track },
    ]);
    const requestsAfterAdd = mediaRequests;
    await apply([
      { type: "clip.text-content", clipId: "live-text", text: "Cambio inmediato <script>texto</script>" },
      { type: "clip.text-style", clipId: "live-text", style: { color: "#ff0000", fontSize: 88 } },
      { type: "clip.caption-cues", clipId: "live-caption", cues: [{ id: "cue-live", startSeconds: 0.2, endSeconds: 2, text: "Caption actualizado" }] },
      { type: "clip.layout", clipId: videoId, layout: { opacity: 0.6 } },
      { type: "clip.trim", clipId: videoId, startSeconds: 0, durationSeconds: 3, sourceOffsetSeconds: 0.5 },
    ]);
    await evaluate(browser.client, `postMessage({ type: "courseforge-composition-seek", seconds: 1, protocolVersion: 1 }, "*"); true`);
    await compositionQaDelay(100);
    assert.equal(await evaluate(browser.client, "document.querySelector('#live-text-motion').textContent"), "Cambio inmediato <script>texto</script>");
    assert.equal(await evaluate(browser.client, "getComputedStyle(document.querySelector('#live-text-motion')).fontSize"), "88px");
    assert.equal(await evaluate(browser.client, "getComputedStyle(document.querySelector('#live-caption-caption-cue-live')).visibility"), "visible");
    assert.equal(await evaluate(browser.client, "document.querySelector('video') === window.originalVideo"), true);
    assert.equal(mediaRequests, requestsAfterAdd, "Cambiar texto/timing no debe solicitar nuevamente el video.");
    await apply([{ type: "clip.split", clipId: videoId, atSeconds: 1.5, newClipId: "live-split", newHfId: "live-split" }]);
    assert.equal(await evaluate(browser.client, "document.querySelectorAll('video').length"), 2);
    await apply([{ type: "clip.remove", clipId: "live-split" }]);
    assert.equal(await evaluate(browser.client, "document.querySelectorAll('video').length"), 1);
    await apply([{ type: "clip.replace-source", clipId: videoId, productionAssetId: replacementId, mimeType: "video/mp4", sourceDurationSeconds: 4, hasAudio: false }]);
    assert.equal(await evaluate(browser.client, "document.querySelector('video').getAttribute('src')"), `${origin}/replacement.mp4`);
    assert.equal(await evaluate(browser.client, "document.querySelector('video') === window.originalVideo"), true);

    // Consecutive local edits keep the same sandbox and loaded media.
    await apply([{ type: "clip.text-content", clipId: "live-text", text: "Restaurado" }]);
    async function patchText(textContent: string) {
      sequence++;
      return evaluate<{ code: string }>(browser.client, `new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("ACK_TIMEOUT")), 2000);
        const listener = event => { if (event.data?.type !== "courseforge-composition-visual-patch-result" || event.data.sequence !== ${sequence}) return;
          removeEventListener("message", listener); clearTimeout(timeout); resolve(event.data); };
        addEventListener("message", listener);
        postMessage(${JSON.stringify({ type: "courseforge-composition-visual-patch", baseDocumentHash: hash, sequence, protocolVersion: 1, patch: { changes: [{ hfId: text.clip.hfId, textContent }] } }).replace(/</g, "\\u003c")}, "*");
      })`);
    }
    const literal = '<img src=x onerror="throw new Error()">';
    assert.equal((await patchText(literal)).code, "APPLIED");
    assert.equal(await evaluate(browser.client, "document.querySelector('#live-text-motion').textContent"), literal);
    assert.equal(await evaluate(browser.client, "document.querySelector('#live-text-motion img') === null"), true);
    // Simula la barrera DOM del runtime; no constituye una revisión HTML autorizada.
    await evaluate(browser.client, `document.querySelector('#live-text-motion').setAttribute('data-courseforge-html-scope', 'qa'); true`);
    assert.equal((await patchText("No debe tocar el árbol protegido")).code, "INVALID_PATCH");
    assert.equal(await evaluate(browser.client, "document.querySelector('#live-text-motion').textContent"), literal);
    const report = { nativeTextLiteralPatch: "passed", controlledHtmlTreeProtected: "passed", browserPath: browser.browserPath, changes: sequence, iframeNavigationsAfterEdits: 0, preservesVideoElement: true, unchangedVideoRequests: 0, patchDurationMs: durations };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
