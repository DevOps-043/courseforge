import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { launchCompositionQaBrowser, compositionQaDelay, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value: T }).value;
}

async function waitFor(client: CompositionQaCdpClient, expression: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(client, expression)) return;
    await compositionQaDelay(50);
  }
  throw new Error(`No se cumplió: ${expression}`);
}

async function main() {
  const directory = resolve(".tmp/composition-layers-qa");
  await mkdir(directory, { recursive: true });
  await build({ entryPoints: [resolve("src/domains/production/composition-editor/qa/composition-layers.fixture.tsx")], bundle: true, platform: "browser",
    format: "iife", jsx: "automatic", outfile: resolve(directory, "fixture.js"), tsconfig: resolve("tsconfig.json"), logLevel: "silent" });
  const initial = createInitialCompositionDocument({
    animatedDeck: { css: "", fonts: [], height: 1080, width: 1920, slides: [
      { animationCount: 0, classes: "slide", html: "<p>Prueba</p>", index: 0, label: "Prueba" },
      { animationCount: 0, classes: "slide", html: "<p>Otra</p>", index: 1, label: "Otra" },
    ] }, assets: [], plan: { title: "Capas", subtitle: "", accentColor: "#38BDF8", durationSeconds: 8 },
  });
  const fixtureJson = JSON.stringify(initial).replaceAll("<", "\\u003c");
  await writeFile(resolve(directory, "index.html"), `<!doctype html><html lang="es"><meta charset="utf-8"><title>QA capas</title><div id="root"></div><script>window.layersQaDocument=${fixtureJson};</script><script src="fixture.js"></script></html>`);
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-layers-" });
  try {
    const client = browser.client;
    await client.send("Page.navigate", { url: pathToFileURL(resolve(directory, "index.html")).href });
    await waitFor(client, "Boolean(document.querySelector('#state'))");
    const state = "JSON.parse(document.querySelector('#state').textContent)";
    const clickAdd = "[...document.querySelectorAll('button')].find(button => button.textContent.startsWith('Agregar capa')).click()";
    await evaluate(client, clickAdd);
    await waitFor(client, `${state}.extraLayerDepths.length === 1`);
    await evaluate(client, clickAdd);
    await waitFor(client, `${state}.extraLayerDepths.length === 2`);
    assert.equal(await evaluate(client, "[...document.querySelectorAll('select option')].some(option => option.value === '12')"), true);
    await evaluate(client, "document.querySelector('[aria-label=\"Quitar capa 11\"]').click()");
    await waitFor(client, `${state}.extraLayerDepths.join(',') === '12'`);
    await evaluate(client, "const selector = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(selector, '12'); selector.dispatchEvent(new Event('change', { bubbles: true })); true");
    await waitFor(client, `${state}.clips[0].layout.zIndex === 12`);
    await evaluate(client, "document.querySelector('button[title=\"Enviar un plano atrás\"]').click()");
    await waitFor(client, `${state}.clips[0].layout.zIndex === 10`);
    await evaluate(client, "document.querySelector('button[title=\"Traer un plano al frente\"]').click()");
    await waitFor(client, `${state}.clips[0].layout.zIndex === 12`);
    const originalCount = await evaluate<number>(client, `${state}.clips.length`);
    for (const responses of [[false], [true, false], [true, true]]) {
      await evaluate(client, `window.confirmCalls = 0; window.confirm = () => ${JSON.stringify(responses)}[window.confirmCalls++]; document.querySelector('[aria-label="Quitar capa 12"]').click()`);
      await waitFor(client, `${state}.clips.length === ${responses.every(Boolean) ? originalCount - 1 : originalCount}`);
      assert.equal(await evaluate(client, "window.confirmCalls"), responses.length);
    }
    assert.deepEqual(await evaluate(client, `${state}.extraLayerDepths`), []);
    await evaluate(client, clickAdd);
    await waitFor(client, `${state}.extraLayerDepths.join(',') === '11'`);
    await evaluate(client, clickAdd);
    await waitFor(client, `${state}.extraLayerDepths.join(',') === '11,12'`);
    await evaluate(client, "document.querySelector('#occupy').click()");
    await waitFor(client, `${state}.clips[0].layout.zIndex === 12`);
    await evaluate(client, "document.querySelector('#lock').click()");
    await waitFor(client, "document.querySelector('[aria-label=\"Quitar capa 12\"]').disabled");
    process.stdout.write("QA Chromium: altas 11/12, selector, baja vacía sin renumerar, cancelación en ambas confirmaciones, baja ocupada y bloqueo correctos.\n");
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
