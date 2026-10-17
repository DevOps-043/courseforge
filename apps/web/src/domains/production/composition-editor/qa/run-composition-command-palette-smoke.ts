import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  compositionQaDelay,
  launchCompositionQaBrowser,
  type CompositionQaCdpClient,
} from "./composition-qa-browser";

const FIXTURE_TIMEOUT_MS = 10_000;

async function main() {
  const workspaceRoot = process.cwd();
  const outputDirectory = resolve(workspaceRoot, ".tmp/composition-command-palette-qa");
  const bundlePath = resolve(outputDirectory, "fixture.js");
  const htmlPath = resolve(outputDirectory, "index.html");
  await mkdir(outputDirectory, { recursive: true });
  await build({
    bundle: true,
    entryPoints: [resolve(workspaceRoot, "src/domains/production/composition-editor/qa/composition-command-palette-smoke.fixture.tsx")],
    format: "iife",
    logLevel: "silent",
    outfile: bundlePath,
    platform: "browser",
    target: ["chrome120"],
    tsconfig: resolve(workspaceRoot, "tsconfig.json"),
  });
  await writeFile(htmlPath, "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Command palette smoke</title></head><body><div id=\"root\"></div><script src=\"./fixture.js\"></script></body></html>", "utf8");

  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-command-palette-smoke-" });
  try {
    await browser.client.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await waitFor(browser.client, "document.querySelector('#command-palette-opener') !== null", "render inicial");
    await evaluate(browser.client, "document.querySelector('#command-palette-opener').focus()");
    await dispatchKey(browser.client, "k", "KeyK", 2);
    await waitFor(browser.client, "document.querySelector('[role=dialog]') !== null", "apertura con Ctrl+K");
    await assertRuntimeValue(browser.client, "document.activeElement?.getAttribute('aria-label')", "Buscar comandos del editor", "autofocus del buscador");
    await assertRuntimeValue(browser.client, "document.getElementById(document.activeElement?.getAttribute('aria-activedescendant'))?.dataset?.commandId", "edit.copy", "referencia accesible al resultado activo");
    await dispatchKey(browser.client, "ArrowDown", "ArrowDown", 0);
    await waitFor(browser.client, "document.getElementById(document.activeElement?.getAttribute('aria-activedescendant'))?.dataset?.commandId === 'view.grid'", "resultado habilitado activo antes de IME");
    await evaluate(browser.client, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));`);
    await assertRuntimeValue(browser.client, "document.querySelector('[role=dialog]') !== null", true, "Enter IME no ejecuta ni cierra");
    await assertRuntimeValue(browser.client, "document.querySelector('#last-command').textContent", "none", "Enter IME no despacha comando habilitado");

    await evaluate(browser.client, "document.querySelector('[data-command-id=\"edit.copy\"]').click()");
    await assertRuntimeValue(browser.client, "document.querySelector('[role=dialog]') !== null", true, "comando deshabilitado mantiene la paleta");
    await assertRuntimeValue(browser.client, "document.querySelector('#last-command').textContent", "none", "comando deshabilitado no despacha");

    await dispatchKey(browser.client, "Tab", "Tab", 8);
    await assertRuntimeValue(browser.client, "document.activeElement?.dataset?.commandId", "view.safe-areas", "focus trap inverso");
    await dispatchKey(browser.client, "Tab", "Tab", 0);
    await assertRuntimeValue(browser.client, "document.activeElement?.getAttribute('aria-label')", "Buscar comandos del editor", "focus trap directo");

    await browser.client.send("Input.insertText", { text: "rejilla" });
    await waitFor(browser.client, "document.querySelectorAll('[data-command-id]').length === 1", "filtro de búsqueda");
    await assertRuntimeValue(browser.client, "document.querySelector('[data-command-id]')?.dataset?.commandId", "view.grid", "resultado filtrado");
    await dispatchKey(browser.client, "Enter", "Enter", 0);
    await waitFor(browser.client, "document.querySelector('[role=dialog]') === null", "cierre tras ejecutar");
    await assertRuntimeValue(browser.client, "document.querySelector('#last-command').textContent", "view.grid", "despacho del comando");
    await assertRuntimeValue(browser.client, "document.activeElement?.id", "command-palette-opener", "restauración del foco");

    await evaluate(browser.client, "document.querySelector('#command-palette-opener').click()");
    await waitFor(browser.client, "document.querySelector('[role=dialog]') !== null", "reapertura por botón");
    await dispatchKey(browser.client, "Escape", "Escape", 0);
    await waitFor(browser.client, "document.querySelector('[role=dialog]') === null", "cierre con Escape");
    await assertRuntimeValue(browser.client, "document.activeElement?.id", "command-palette-opener", "foco tras Escape");

    await evaluate(browser.client, "document.querySelector('#command-palette-opener').click()");
    await waitFor(browser.client, "document.querySelector('[role=dialog]') !== null", "reapertura para botón de cierre");
    await evaluate(browser.client, "document.querySelector('[aria-label=\"Cerrar paleta de comandos\"]').focus()");
    await dispatchKey(browser.client, "Enter", "Enter", 0);
    await waitFor(browser.client, "document.querySelector('[role=dialog]') === null", "Enter activa el botón cerrar");
    await assertRuntimeValue(browser.client, "document.querySelector('#last-command').textContent", "view.grid", "cerrar no despacha otro comando");

    await evaluate(browser.client, "document.querySelector('#command-palette-opener').click()");
    await waitFor(browser.client, "document.querySelector('[role=dialog]') !== null", "reapertura para aislamiento modal");
    await evaluate(browser.client, "document.querySelector('[data-command-id=\"view.safe-areas\"]').focus()");
    await dispatchKey(browser.client, "k", "KeyK", 2);
    await waitFor(browser.client, "document.querySelector('[role=dialog]') === null", "Ctrl+K cierra sin reabrir desde el listener global");

    process.stdout.write(`${JSON.stringify({
      browserPath: browser.browserPath,
      commandDispatch: "passed",
      disabledCommand: "passed",
      focusRestoration: "passed",
      focusTrap: "passed",
      keyboardOpenClose: "passed",
      nativeCloseButtonEnter: "passed",
      modalKeyboardIsolation: "passed",
      composingEnter: "passed",
      activeDescendant: "passed",
      search: "passed",
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

async function dispatchKey(client: CompositionQaCdpClient, key: string, code: string, modifiers: number) {
  await client.send("Input.dispatchKeyEvent", { code, key, modifiers, type: "rawKeyDown", windowsVirtualKeyCode: virtualKeyCode(key) });
  await client.send("Input.dispatchKeyEvent", { code, key, modifiers, type: "keyUp", windowsVirtualKeyCode: virtualKeyCode(key) });
}

async function assertRuntimeValue<T>(
  client: CompositionQaCdpClient,
  expression: string,
  expected: T,
  label: string,
) {
  const actual = await evaluate<T>(client, expression);
  if (actual !== expected) throw new Error(`${label}: esperado ${JSON.stringify(expected)}, recibido ${JSON.stringify(actual)}.`);
}

async function waitFor(client: CompositionQaCdpClient, expression: string, label: string) {
  const deadline = Date.now() + FIXTURE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(client, expression)) return;
    await compositionQaDelay(50);
  }
  throw new Error(`El smoke no completó: ${label}.`);
}

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const evaluation = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  const exception = evaluation.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
  if (exception) throw new Error(exception.exception?.description || exception.text || "Falló una evaluación CDP.");
  return (evaluation.result as { value?: T } | undefined)?.value as T;
}

function virtualKeyCode(key: string) {
  if (key === "Tab") return 9;
  if (key === "Enter") return 13;
  if (key === "Escape") return 27;
  return key.toUpperCase().charCodeAt(0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
