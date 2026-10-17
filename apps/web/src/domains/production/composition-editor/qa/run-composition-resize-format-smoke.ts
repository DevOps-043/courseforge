import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildCompositionPreviewScenePatch } from "../composition-preview-scene-patch";
import { launchCompositionQaBrowser, compositionQaDelay, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}

async function main() {
  let document = createInitialCompositionDocument({ animatedDeck: null, assets: [{
    checksum: "b".repeat(64), durationSeconds: 4, fileSizeBytes: 100, hasAudio: false,
    mimeType: "video/mp4", productionAssetId: "55555555-5555-4555-8555-555555555558",
    publicUrl: null, storageBucket: "production-assets", storagePath: "fixture.mp4", timelineRole: "BROLL",
  }],
    plan: { accentColor: "#38BDF8", durationSeconds: 4, subtitle: "", title: "Prueba de formato y tamaño" } });
  document.clips = [];
  const overlay = createCompositionNativeOverlay({ document, id: "resize-text", kind: "TEXT", playheadSeconds: 0 });
  document = applyCompositionEditorPatches(document, [{ type: "clip.add", clipId: overlay.clip.id, clip: overlay.clip, track: overlay.track },
    { type: "clip.layout", clipId: overlay.clip.id, layout: { x: 100, y: 100, width: 400, height: 200 } }]);
  const hash = "a".repeat(64);
  const html = await compileCompositionPreview({ document, documentHash: hash, assetUrls: new Map() });
  const server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end(html); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-resize-format-" }).catch((error) => { server.close(); throw error; });
  try {
    const errors: unknown[] = [];
    await browser.client.send("Runtime.enable");
    // CDP evaluation reports thrown exceptions directly; also retain asynchronous errors in-page.
    await browser.client.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    const deadline = Date.now() + 10_000;
    while (!await evaluate(browser.client, "Boolean(window.__timelines?.['courseforge-composition'])")) {
      if (Date.now() > deadline) throw new Error("El preview no estuvo listo a tiempo.");
      await compositionQaDelay(50);
    }
    await evaluate(browser.client, `window.qaErrors = []; addEventListener('error', event => qaErrors.push(event.message)); true`);
    let sequence = 0;
    for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1920, height: 1080 }] as const) {
      const next = applyCompositionEditorPatches(document, [{ type: "composition.canvas-size", ...canvas }]);
      const scene = buildCompositionPreviewScenePatch({ beforeDocument: document, document: next, assetUrls: new Map(), audioMetersEnabled: false });
      assert.ok(scene);
      const message = { type: "courseforge-composition-visual-patch", baseDocumentHash: hash, sequence: ++sequence, patch: { changes: [], scene } };
      const ack = await evaluate<{ applied: boolean; code: string }>(browser.client, `new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Sin respuesta al cambiar formato')), 2000);
        const listener = event => { if (event.data?.type !== 'courseforge-composition-visual-patch-result') return;
          removeEventListener('message', listener); clearTimeout(timeout); resolve(event.data); };
        addEventListener('message', listener); postMessage(${JSON.stringify(message)}, '*'); })`);
      assert.equal(ack.applied, true, ack.code);
      document = next;
      await evaluate(browser.client, `postMessage({type:'courseforge-composition-select', hfId:'resize-text'}, '*'); true`);
      await compositionQaDelay(50);
      for (const gesture of [{ dx: 60, dy: 30 }, { dx: -60, dy: -30 }, { dx: 0, dy: 30 }, { dx: 0, dy: -30 }]) {
        const delta = gesture.dx || gesture.dy * 2;
        const before = await evaluate<{ width: number; x: number; y: number; scale: number }>(browser.client, `(() => {
          const target = document.querySelector('[data-hf-id="resize-text"]'); const handle = target.querySelector('.composition-resize-handle').getBoundingClientRect();
          return {width: parseFloat(target.style.width), x: handle.x + handle.width/2, y: handle.y + handle.height/2,
            scale: document.querySelector('#composition-root').getBoundingClientRect().width / ${canvas.width}}; })()`);
        await browser.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: before.x, y: before.y, button: "left", clickCount: 1 });
        await browser.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: before.x + gesture.dx, y: before.y + gesture.dy, button: "left", buttons: 1 });
        await browser.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: before.x + gesture.dx, y: before.y + gesture.dy, button: "left", clickCount: 1 });
        const width = await evaluate<number>(browser.client, `parseFloat(document.querySelector('[data-hf-id="resize-text"]').style.width)`);
        errors.push(...await evaluate<unknown[]>(browser.client, "qaErrors.splice(0)"));
        assert.deepEqual(errors, [], "El gesto no debe lanzar errores del runtime.");
        assert.ok(Math.abs(width - (before.width + delta / before.scale)) <= 24, `Formato ${canvas.width}x${canvas.height}: ancho ${width}, esperado ${before.width + delta / before.scale}`);
      }
    }
    process.stdout.write("OK: agrandar y reducir en horizontal, vertical y regreso a horizontal, sin errores de runtime.\n");
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

void main().catch((error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
