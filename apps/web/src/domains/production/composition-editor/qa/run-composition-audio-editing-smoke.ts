import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createAudioEditingFixture, createAudioTransition } from "../__tests__/composition-audio-editing.fixtures";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS, readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { stereoFloatWavHeader } from "./composition-pcm-wav";
import { launchCompositionQaBrowser, captureCompositionQaScreenshot, compositionQaDelay, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}
async function waitFor(client: CompositionQaCdpClient, expression: string) {
  const deadline = Date.now() + 10_000;
  while (!await evaluate(client, expression)) {
    if (Date.now() > deadline) throw new Error(`No se cumplió: ${expression}`);
    await compositionQaDelay(50);
  }
}
async function main() {
  const output = resolve(".tmp/audio-editing-qa");
  await mkdir(join(output, "assets"), { recursive: true });
  await writeFile(join(output, "assets/gsap.min.js"), await readCompositionAnimationRuntime());
  const pcm = Buffer.alloc(8_000 * 10 * 8);
  const wav = join(output, "source.wav");
  await writeFile(wav, Buffer.concat([stereoFloatWavHeader(pcm.length, 8_000), pcm]));
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-audio-editing-" });
  const reports: unknown[] = [];
  try {
    for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
      const document = createAudioEditingFixture();
      document.transitions = { schemaVersion: 1, items: [createAudioTransition(document)] };
      const assetUrls = new Map(document.clips.flatMap(clip => clip.source.type === "PRODUCTION_ASSET" ? [[clip.source.productionAssetId, pathToFileURL(wav).href]] : []));
      const path = join(output, `${target}.html`);
      await writeFile(path, await compileCompositionPreview({ document, assetUrls, target }));
      await browser.client.send("Page.navigate", { url: pathToFileURL(path).href });
      await waitFor(browser.client, `Boolean(window.__timelines?.['courseforge-composition'])`);
      const read = (seconds: number) => evaluate<number[]>(browser.client, `(() => {window.__timelines['courseforge-composition'].time(${seconds},true);return [...document.querySelectorAll('audio')].map(media=>media.volume)})()`);
      const middle = await read(4);
      assert.ok(Math.abs(middle[0]! - 0.4) < 1e-6 && Math.abs(middle[1]! - 0.3) < 1e-6);
      await read(4.15);
      assert.deepEqual(await read(4), middle);
      const windows = await evaluate(browser.client, `[...document.querySelectorAll('audio')].map(media=>({start:media.dataset.start,offset:media.dataset.sourceOffset,track:media.dataset.trackIndex,opacity:media.style.opacity}))`);
      reports.push({ target, middleVolumes: middle, windows, reverseSeek: "PASS" });
    }

    await build({ entryPoints: [resolve("src/domains/production/composition-editor/qa/composition-audio-editing-ui.fixture.tsx")], bundle: true,
      platform: "browser", format: "iife", jsx: "automatic", outfile: join(output, "fixture.js"), tsconfig: resolve("tsconfig.json"), logLevel: "silent" });
    const path = join(output, "ui.html");
    await writeFile(path, `<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>
      body{font:14px Arial;margin:20px}button,input,select{margin:4px}#state{display:none}.relative{position:relative}.absolute{position:absolute}.overflow-x-auto{overflow-x:auto}.overflow-hidden{overflow:hidden}
      [data-composition-timeline-viewport]{width:960px}.grid{display:grid;grid-template-columns:160px minmax(0,1fr);gap:8px}.h-9{height:70px}.h-8{height:32px}
      [data-clip-id]{position:absolute;top:4px;bottom:4px;background:#d5f5ee;border:1px solid #138b80;overflow:hidden}[data-clip-id]>span[aria-hidden]{position:absolute;left:0;right:0;top:12px;bottom:4px;pointer-events:none}
      [data-clip-id] svg{height:100%;width:100%}button:disabled{opacity:.4}
      </style></head><body><div id="root"></div><script>window.audioEditingDocument=${JSON.stringify(createAudioEditingFixture()).replaceAll("<", "\\u003c")};</script><script src="fixture.js"></script></body></html>`);
    await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
    await browser.client.send("Page.navigate", { url: pathToFileURL(path).href });
    const state = `JSON.parse(document.getElementById('state').textContent)`;
    await waitFor(browser.client, `Boolean(document.querySelector('[data-clip-id] svg path'))`);
    const click = (label: string) => evaluate(browser.client, `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click();true`);
    await click("Añadir transición");
    await waitFor(browser.client, `${state}.document.transitions?.items.length===1`);
    assert.equal(await evaluate(browser.client, `${state}.document.transitions.items[0].audioMode`), "CROSSFADE");
    assert.equal(await evaluate(browser.client, `${state}.error`), "");
    await click("Quitar");
    await waitFor(browser.client, `${state}.document.transitions.items.length===0`);
    const beforeWidth = await evaluate<number>(browser.client, `document.querySelector('[data-clip-id]').getBoundingClientRect().width`);
    await click("Ampliar audio");
    await waitFor(browser.client, `Number(document.querySelector('[aria-label="Zoom del timeline"]').value)>1`);
    await waitFor(browser.client, `document.querySelector('[data-clip-id]').getBoundingClientRect().width>${beforeWidth}`);
    const waveformPoint = await evaluate<{ x: number; y: number; expected: number }>(browser.client, `(() => {
      const clip=document.querySelector('[data-clip-id]'), box=clip.getBoundingClientRect();
      const viewport=document.querySelector('[data-composition-timeline-viewport]').getBoundingClientRect();
      const x=Math.min(viewport.right-20,Math.max(viewport.left+180,box.left+box.width*.4));
      return {x,y:box.top+35,expected:Math.round((x-box.left)/box.width*4*30)/30};})()`);
    await browser.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: waveformPoint.x, y: waveformPoint.y, button: "left", clickCount: 2, modifiers: 0 });
    await browser.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: waveformPoint.x, y: waveformPoint.y, button: "left", clickCount: 2, modifiers: 0 });
    await waitFor(browser.client, `Math.abs(${state}.seconds-${waveformPoint.expected})<.001`);
    await writeFile(join(output, "waveform-zoom.png"), await captureCompositionQaScreenshot(browser.client));
    await click("Dividir audio");
    await waitFor(browser.client, `${state}.document.clips.length===3`);
    assert.equal(await evaluate(browser.client, `${state}.error`), "");
    const right = await evaluate<{ sourceOffsetSeconds: number; startSeconds: number }>(browser.client, `${state}.document.clips.find(clip=>clip.id==='split-right')`);
    assert.ok(Math.abs(right.sourceOffsetSeconds - (1 + waveformPoint.expected)) < 0.001);
    reports.push({ controls: "PASS", addAndRemoveCrossfade: "PASS", waveformZoom: "PASS", pointerAndSplit: "PASS", splitAtSeconds: waveformPoint.expected });
    await writeFile(join(output, "report.json"), JSON.stringify(reports, null, 2));
    process.stdout.write("OK: crossfade audio preview/render, ventanas, seek inverso, zoom de onda y corte por cursor.\n");
  } finally { await browser.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
