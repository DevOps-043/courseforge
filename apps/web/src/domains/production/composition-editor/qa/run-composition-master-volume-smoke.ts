import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createMasterVolumeFixture, MASTER_VOLUME_ASSET_IDS } from "../__tests__/composition-master-volume.fixtures";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS, readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { buildCompositionPreviewScenePatch } from "../composition-preview-scene-patch";
import { prepareCompositionPreviewScenePatch } from "../composition-preview-scene-runtime";
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
  const output = resolve(".tmp/master-volume-qa");
  await mkdir(join(output, "assets"), { recursive: true });
  await writeFile(join(output, "assets/gsap.min.js"), await readCompositionAnimationRuntime());
  const pcm = Buffer.alloc(8_000 * 4 * 8);
  const wavePath = join(output, "source.wav");
  await writeFile(wavePath, Buffer.concat([stereoFloatWavHeader(pcm.length, 8_000), pcm]));
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-master-volume-" });
  const reports: unknown[] = [];
  try {
    for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
      const initial = createMasterVolumeFixture();
      for (const clip of initial.clips) clip.fadeInSeconds = 0.5;
      const assetUrls = new Map(MASTER_VOLUME_ASSET_IDS.map(id => [id, pathToFileURL(wavePath).href]));
      const path = join(output, `${target}.html`);
      await writeFile(path, await compileCompositionPreview({ document: initial, target, assetUrls }));
      await browser.client.send("Page.navigate", { url: pathToFileURL(path).href });
      await waitFor(browser.client, `Boolean(window.__timelines?.["courseforge-composition"])`);
      const localUrls = new Map(MASTER_VOLUME_ASSET_IDS.map(id => [id, `https://fixture.local/${id}`]));
      for (const masterVolume of [0.5, 0, 1]) {
        const next = structuredClone(initial); next.audioMix.masterVolume = masterVolume;
        const scene = buildCompositionPreviewScenePatch({ document: next, beforeDocument: initial, assetUrls: localUrls, audioMetersEnabled: false });
        assert.ok(scene);
        const result = await evaluate<number[]>(browser.client, `(() => {
          const root = document.getElementById('composition-root');
          const scene = ${JSON.stringify(scene)};
          const commit = (${prepareCompositionPreviewScenePatch.toString()})(root, scene);
          window.__timelines['courseforge-composition'].revert(); commit();
          const timeline = window.__courseforgeInstallTimeline(scene.timeline);
          timeline.time(0.25,true);
          return [...document.querySelectorAll('audio')].map(media => media.volume);
        })()`);
        assert.equal(result.length, 3);
        assert.ok(result.every(volume => Math.abs(volume - 0.2 * masterVolume) < 1e-6), `${target}: ganancia duplicada o ausente.`);
        const repeated = await evaluate<number[]>(browser.client, `(() => {const timeline=window.__timelines['courseforge-composition']; timeline.time(1,true);timeline.time(0.25,true);return [...document.querySelectorAll('audio')].map(media=>media.volume)})()`);
        assert.deepEqual(repeated, result);
        reports.push({ target, masterVolume, mediaVolumes: result, liveSceneAndReverseSeek: "PASS" });
      }
    }

    await build({ entryPoints: [resolve("src/domains/production/composition-editor/qa/composition-master-volume-ui.fixture.tsx")],
      bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(output, "fixture.js"), tsconfig: resolve("tsconfig.json"), logLevel: "silent" });
    const uiPath = join(output, "ui.html");
    await writeFile(uiPath, '<!doctype html><html lang="es"><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
    await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 500, deviceScaleFactor: 1, mobile: false });
    await browser.client.send("Page.navigate", { url: pathToFileURL(uiPath).href });
    const range = `document.querySelector('[aria-label="Volumen maestro de la composición"]')`;
    await waitFor(browser.client, `Boolean(${range})`);
    const setVolume = async (value: number) => {
      await evaluate(browser.client, `(() => {const range=${range};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(range,${JSON.stringify(String(value))});range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));return true})()`);
    };
    await setVolume(0.35);
    await waitFor(browser.client, `window.masterVolumeFixture.saved === 0.35`);
    assert.deepEqual(await evaluate(browser.client, "window.masterVolumeFixture.calls"), [{ masterVolume: 0.35 }]);
    await evaluate(browser.client, `[...document.querySelectorAll('button')].find(button=>button.textContent==='Restablecer 100%').click(); true`);
    await waitFor(browser.client, `window.masterVolumeFixture.saved === 1 && window.masterVolumeFixture.calls.length === 2`);
    await evaluate(browser.client, "window.masterVolumeFixture.failNext=true; true");
    await setVolume(0.2);
    await waitFor(browser.client, `Boolean(document.querySelector('[role="alert"]'))`);
    assert.equal(await evaluate(browser.client, `${range}.value`), "0.2");
    assert.equal(await evaluate(browser.client, "window.masterVolumeFixture.saved"), 1);
    await setVolume(0.3);
    await waitFor(browser.client, `${range}.getAttribute('aria-valuetext') === '30%'`);
    await evaluate(browser.client, `[...document.querySelectorAll('button')].find(button=>button.textContent==='Reintentar cambio pendiente').click(); true`);
    await waitFor(browser.client, "window.masterVolumeFixture.saved === 0.3");
    await writeFile(join(output, "controls.png"), await captureCompositionQaScreenshot(browser.client));
    await evaluate(browser.client, "window.masterVolumeFixture.disable(true); true");
    await waitFor(browser.client, `${range}.disabled`);
    reports.push({ controls: "PASS", autosave: "PASS", failureRetainsDraft: "PASS", reset: "PASS", disabled: "PASS" });
    await writeFile(join(output, "report.json"), JSON.stringify(reports, null, 2));
    process.stdout.write("OK: maestro en elementos de audio, preview/render, actualización, seek inverso y controles con autosave.\n");
  } finally { await browser.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
