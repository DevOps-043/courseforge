import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createNestedGroupsQaDocument } from "./composition-nested-groups-data";
import { launchCompositionQaBrowser, compositionQaDelay, captureCompositionQaScreenshot, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value: T }).value;
}
async function waitFor(client: CompositionQaCdpClient, expression: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await evaluate<boolean>(client, expression)) return; await compositionQaDelay(50); }
  throw new Error(`No se cumplió: ${expression}`);
}
async function main() {
  const directory = resolve(".tmp/composition-nested-groups-qa"); await mkdir(directory, { recursive: true });
  await build({ entryPoints: [resolve("src/domains/production/composition-editor/qa/composition-nested-groups.fixture.tsx")], bundle: true, platform: "browser",
    format: "iife", jsx: "automatic", outfile: resolve(directory, "fixture.js"), tsconfig: resolve("tsconfig.json"), logLevel: "silent" });
  const fixtureJson = JSON.stringify(createNestedGroupsQaDocument()).replaceAll("<", "\\u003c");
  await writeFile(resolve(directory, "index.html"), `<!doctype html><html lang="es"><meta charset="utf-8"><title>QA agrupaciones</title><link rel="stylesheet" href="fixture.css"><style>body{font:14px sans-serif}output{display:block;max-width:1200px;overflow-wrap:anywhere}button{margin:4px;padding:6px}</style><div id="root"></div><script>window.nestedGroupsQaDocument=${fixtureJson};</script><script src="fixture.js"></script></html>`);
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-nested-groups-" });
  try {
    const client = browser.client;
    await client.send("Page.navigate", { url: pathToFileURL(resolve(directory, "index.html")).href });
    await waitFor(client, "document.querySelector('[data-clip-id=\"clip-0\"]') !== null");
    const state = "JSON.parse(document.querySelector('#state').textContent)";
    const groupButton = "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Agrupar selección')";
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-0\"]').click()");
    await waitFor(client, `${state}.selected.length === 2`);
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-2\"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))");
    await waitFor(client, `${state}.selected.length === 4`);
    assert.equal(await evaluate(client, `${groupButton}.disabled`), true);
    await evaluate(client, "document.querySelector('#enable').click()");
    await waitFor(client, `${groupButton}.disabled === false`);
    await evaluate(client, `${groupButton}.click()`);
    await waitFor(client, `${state}.groups.length === 3 && ${state}.selectedGroupId === 'group-parent'`);
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-0\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    await waitFor(client, `${state}.editingGroupId === 'group-parent'`);
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-0\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    await waitFor(client, `${state}.editingGroupId === 'group-a'`);
    assert.equal(await evaluate(client, "document.querySelector('[aria-label=\"Ruta de agrupaciones\"]').textContent.includes('Principal')"), true);
    await evaluate(client, "document.querySelector('[data-composition-timeline]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await waitFor(client, `${state}.editingGroupId === 'group-parent'`);
    await evaluate(client, "[...document.querySelector('[aria-label=\"Ruta de agrupaciones\"]').querySelectorAll('button')].find(button => button.textContent === 'Raíz').click()");
    await waitFor(client, `${state}.editingGroupId === null`);
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-0\"]').click()");
    await waitFor(client, `${state}.selectedGroupId === 'group-parent'`);
    await evaluate(client, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Desagrupar').click()");
    await waitFor(client, `${state}.groups.length === 2`);
    await writeFile(resolve(directory, "screenshot.png"), await captureCompositionQaScreenshot(client));
    process.stdout.write("QA Chromium: selección aditiva, capacidad, agrupación, navegación de dos niveles, Escape y desagrupación correctas.\n");
  } finally { await browser.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
