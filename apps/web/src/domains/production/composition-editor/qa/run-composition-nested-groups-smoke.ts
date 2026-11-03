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
    assert.equal(await evaluate(client, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Anidar selección').disabled"), true);
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
    // Agrupar mantiene cuatro botones; anidar los reemplaza por un solo bloque.
    assert.equal(await evaluate(client, "document.querySelectorAll('button[data-clip-id]').length"), 4);
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-0\"]').click()");
    await evaluate(client, "document.querySelector('[data-clip-id=\"clip-2\"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))");
    await waitFor(client, `${state}.selected.length === 4`);
    await evaluate(client, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Anidar selección').click()");
    await waitFor(client, "document.querySelectorAll('button[data-nested-group-id]').length === 1 && document.querySelectorAll('button[data-clip-id]').length === 1");
    const originalStarts = await evaluate<number[]>(client, `${state}.starts`);
    await evaluate(client, "document.querySelector('button[data-nested-group-id]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    await waitFor(client, `${state}.starts[0] > ${originalStarts[0]}`);
    const movedStarts = await evaluate<number[]>(client, `${state}.starts`);
    movedStarts.forEach((start, index) => assert.ok(Math.abs(start - originalStarts[index] - (movedStarts[0] - originalStarts[0])) < 0.00001));
    const point = await evaluate<{ x: number; y: number }>(client, "(() => { const box = document.querySelector('button[data-nested-group-id]').getBoundingClientRect(); return {x:box.left + box.width / 2,y:box.top + box.height / 2}; })()");
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 50, y: point.y, button: "left", buttons: 1 });
    await compositionQaDelay(50);
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 50, y: point.y, button: "left", clickCount: 1 });
    await waitFor(client, `${state}.starts[0] > ${movedStarts[0]}`);
    const draggedStarts = await evaluate<number[]>(client, `${state}.starts`);
    draggedStarts.forEach((start, index) => assert.ok(Math.abs(start - movedStarts[index] - (draggedStarts[0] - movedStarts[0])) < 0.00001));
    await writeFile(resolve(directory, "nested-screenshot.png"), await captureCompositionQaScreenshot(client));
    await evaluate(client, "document.querySelector('button[data-nested-group-id]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await waitFor(client, `${state}.editingGroupId === 'nested-parent' && document.querySelectorAll('button[data-clip-id]').length === 4`);
    await evaluate(client, "document.querySelector('[data-composition-timeline]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await waitFor(client, `${state}.editingGroupId === null && document.querySelectorAll('button[data-clip-id]').length === 1`);
    await evaluate(client, "document.querySelector('button[data-nested-group-id]').click()");
    await evaluate(client, "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Desanidar').click()");
    await waitFor(client, `${state}.groups.length === 2 && document.querySelectorAll('button[data-clip-id]').length === 4`);
    await writeFile(resolve(directory, "screenshot.png"), await captureCompositionQaScreenshot(client));
    process.stdout.write("QA Chromium: agrupación visible, anidación en un bloque, movimiento conjunto, apertura con Enter, Escape y desanidación correctas.\n");
  } finally { await browser.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
