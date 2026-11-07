import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { launchCompositionQaBrowser, compositionQaDelay, captureCompositionQaScreenshot, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}

async function waitFor(client: CompositionQaCdpClient, expression: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(client, expression)) return;
    await compositionQaDelay(50);
  }
  throw new Error(`No se cumplió la condición de QA: ${expression}`);
}

async function fill(client: CompositionQaCdpClient, selector: string, value: string) {
  await evaluate(client, `(() => { const input = document.querySelector(${JSON.stringify(selector)});
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
}

async function main() {
  const directory = resolve(".tmp/composition-preset-capture-qa");
  await mkdir(directory, { recursive: true });
  await build({ entryPoints: [resolve("src/domains/production/composition-editor/qa/composition-preset-capture.fixture.tsx")],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    outfile: resolve(directory, "fixture.js"), tsconfig: resolve("tsconfig.json"), logLevel: "silent" });
  await writeFile(resolve(directory, "index.html"), '<!doctype html><html lang="es"><meta charset="utf-8"><title>QA presets</title><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>');
  console.log("QA presets: abriendo Chromium aislado.");
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-preset-capture-", signal: AbortSignal.timeout(30_000) });
  const timeout = setTimeout(() => browser.client.close(), 30_000);
  try {
    const client = browser.client;
    await client.send("Page.navigate", { url: pathToFileURL(resolve(directory, "index.html")).href });
    await waitFor(client, "document.querySelector('input') !== null");
    console.log("QA presets: formulario disponible.");
    const create = "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Crear preset')";
    await fill(client, "input", "Preset manual de prueba");
    await waitFor(client, `${create}.disabled === false`);
    await evaluate(client, `${create}.click()`);
    await waitFor(client, "document.querySelector('#error').textContent.includes('Fallo simulado')");
    assert.equal(await evaluate(client, "document.querySelector('input').value"), "Preset manual de prueba");
    await evaluate(client, "window.presetQa.fail = false");
    await evaluate(client, `${create}.click()`);
    await waitFor(client, "document.querySelector('[role=status]')?.textContent.includes('Preset guardado')");
    assert.equal(await evaluate(client, "document.querySelector('input').value"), "");
    assert.equal(await evaluate(client, "document.querySelector('[role=status]').textContent.includes('recortes de fuente')"), true);
    await evaluate(client, "[...document.querySelectorAll('button')].find(button => button.textContent.trim().startsWith('Con ')).click()");
    await fill(client, "input", "Preset por instrucciones");
    await fill(client, "textarea", "Conservar configuración visual");
    await waitFor(client, `${create}.disabled === false`);
    await evaluate(client, `${create}.click()`);
    await waitFor(client, "window.presetQa.calls.length === 3 && document.querySelector('input').value === ''");
    const calls = await evaluate<Array<{ body: { mode: string }; hash: string }>>(client, "window.presetQa.calls");
    assert.deepEqual(calls.map(call => call.body.mode), ["MANUAL", "MANUAL", "INSTRUCTIONS"]);
    assert.ok(calls.every(call => call.hash === `"${"b".repeat(64)}"`));
    await writeFile(resolve(directory, "preset-guardado.png"), await captureCompositionQaScreenshot(client));
    await writeFile(resolve(directory, "report.json"), JSON.stringify({ passed: true,
      scenarios: ["error conserva formulario", "éxito muestra diagnósticos", "manual y agente envían hash confirmado"],
      limitation: "Fixture con HTTP simulado; no ejecuta el editor completo ni llama al proveedor IA." }, null, 2));
    console.log("QA Chromium de presets aprobada: manual, instrucciones, error y diagnósticos.");
  } finally { clearTimeout(timeout); await browser.close(); }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
