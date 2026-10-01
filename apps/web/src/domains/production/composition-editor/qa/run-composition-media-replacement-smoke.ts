import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compositionQaDelay, launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";

const ORIGINAL_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";
const SHORT_ID = "33333333-3333-4333-8333-333333333333";
const AUDIO_ID = "44444444-4444-4444-8444-444444444444";
const TIMEOUT_MS = 10_000;

async function main() {
  const workspaceRoot = process.cwd();
  const outputDirectory = resolve(workspaceRoot, ".tmp/composition-media-replacement-qa");
  const bundlePath = resolve(outputDirectory, "fixture.js");
  const htmlPath = resolve(outputDirectory, "index.html");
  await mkdir(outputDirectory, { recursive: true });
  await build({
    bundle: true,
    entryPoints: [resolve(workspaceRoot, "src/domains/production/composition-editor/qa/composition-media-replacement-smoke.fixture.tsx")],
    format: "iife",
    logLevel: "silent",
    outfile: bundlePath,
    platform: "browser",
    target: ["chrome120"],
    tsconfig: resolve(workspaceRoot, "tsconfig.json"),
  });
  await writeFile(htmlPath, "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Media replacement smoke</title></head><body><div id=\"root\"></div><script src=\"./fixture.js\"></script></body></html>", "utf8");

  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-media-replacement-smoke-" });
  try {
    await browser.client.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await waitFor(browser.client, "document.querySelector('[role=tab][aria-selected=true]') !== null", "render inicial");
    await evaluate(browser.client, "Array.from(document.querySelectorAll('[role=tab]')).find((tab) => tab.textContent.includes('Medios')).click()");
    await waitFor(browser.client, "document.querySelectorAll('[data-asset-id]').length === 4", "biblioteca de medios");
    await assertValue(browser.client, "document.querySelector('#source-id').textContent", ORIGINAL_ID, "fuente original");
    const originalTimingLayout = await evaluate<string>(browser.client, "document.querySelector('#timing-layout').textContent");

    await evaluate(browser.client, `setInputValue('input[placeholder="Buscar medios…"]', 'nuevo')`);
    await waitFor(browser.client, "document.querySelectorAll('[data-asset-id]').length === 2", "búsqueda de medios");
    await evaluate(browser.client, `setInputValue('input[placeholder="Buscar medios…"]', '')`);
    await evaluate(browser.client, `setSelectValue('select[aria-label="Tipo de medio"]', 'AUDIO')`);
    await waitFor(browser.client, "document.querySelectorAll('[data-asset-id]').length === 1", "filtro de audio");
    await assertValue(browser.client, "document.querySelector('[data-asset-id]')?.getAttribute('data-asset-id')", AUDIO_ID, "medio filtrado");
    await evaluate(browser.client, `setSelectValue('select[aria-label="Tipo de medio"]', 'VIDEO')`);
    await waitFor(browser.client, "document.querySelectorAll('[data-asset-id]').length === 3", "filtro de video");

    for (const assetId of [ORIGINAL_ID, SHORT_ID]) {
      await assertValue(browser.client, `Boolean(replaceButton(${JSON.stringify(assetId)})?.disabled)`, true, `reemplazo prohibido ${assetId}`);
    }
    await assertValue(browser.client, `Boolean(replaceButton(${JSON.stringify(REPLACEMENT_ID)})?.disabled)`, false, "reemplazo compatible");
    await evaluate(browser.client, `replaceButton(${JSON.stringify(REPLACEMENT_ID)}).click()`);
    await waitFor(browser.client, `document.querySelector('#source-id')?.textContent === ${JSON.stringify(REPLACEMENT_ID)}`, "reemplazo aplicado");
    await assertValue(browser.client, "document.querySelector('#timing-layout').textContent", originalTimingLayout, "timing y layout conservados");
    await assertValue(browser.client, "document.querySelector('#preview-strategy').textContent", "FULL_RELOAD", "recarga de preview");
    await assertValue(browser.client, "document.querySelector('#preview-revision').textContent", "1", "revisión de preview");
    await assertValue(browser.client, "document.querySelector('#replacement-error').textContent", "", "sin error de dominio");
    await evaluate(browser.client, `document.querySelector('[data-asset-id="${REPLACEMENT_ID}"] button').click()`);
    await assertValue(browser.client, "document.querySelector('#last-selected-hf-id').textContent", "asset-original", "selección del clip reemplazado");

    await evaluate(browser.client, "document.querySelector('#undo-replacement').click()");
    await waitFor(browser.client, `document.querySelector('#source-id')?.textContent === ${JSON.stringify(ORIGINAL_ID)}`, "undo");
    await assertValue(browser.client, "document.querySelector('#timing-layout').textContent", originalTimingLayout, "undo conserva edición");
    await evaluate(browser.client, "document.querySelector('#redo-replacement').click()");
    await waitFor(browser.client, `document.querySelector('#source-id')?.textContent === ${JSON.stringify(REPLACEMENT_ID)}`, "redo");
    await assertValue(browser.client, "document.querySelector('#preview-revision').textContent", "3", "revisión después de redo");

    await evaluate(browser.client, "document.querySelector('#simulate-missing-source').click()");
    await waitFor(browser.client, "document.querySelector('[role=status]')?.textContent.includes('fuente de este clip no está disponible')", "aviso de fuente ausente");
    await assertValue(browser.client, `Boolean(Array.from(document.querySelectorAll('[data-asset-id="${ORIGINAL_ID}"] button')).find((button) => button.textContent.includes('Revincular'))?.disabled)`, false, "relink compatible disponible");

    process.stdout.write(`${JSON.stringify({ browserPath: browser.browserPath, librarySearchAndFilter: "passed", replacementGuards: "passed", relinkAffordance: "passed", sourceAndEdits: "passed", selectionAfterReplacement: "passed", previewReload: "passed", undoRedo: "passed" }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

async function waitFor(client: CompositionQaCdpClient, expression: string, label: string) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(client, expression)) return;
    await compositionQaDelay(50);
  }
  throw new Error(`El smoke no completó: ${label}.`);
}

async function assertValue<T>(client: CompositionQaCdpClient, expression: string, expected: T, label: string) {
  const actual = await evaluate<T>(client, expression);
  if (actual !== expected) throw new Error(`${label}: esperado ${JSON.stringify(expected)}, recibido ${JSON.stringify(actual)}.`);
}

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const script = `(() => {
    window.setInputValue = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.setSelectValue = (selector, value) => {
      const select = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.replaceButton = (assetId) => Array.from(document.querySelectorAll('[data-asset-id="' + assetId + '"] button')).find((button) => button.textContent.includes('Reemplazar'));
    return (${expression});
  })()`;
  const evaluation = await client.send("Runtime.evaluate", { expression: script, returnByValue: true });
  const exception = evaluation.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
  if (exception) throw new Error(exception.exception?.description || exception.text || "Falló una evaluación CDP.");
  return (evaluation.result as { value?: T } | undefined)?.value as T;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
