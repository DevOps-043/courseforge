import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const runtimeModules = process.argv[2];
const { chromium } = runtimeModules
  ? await import(pathToFileURL(path.join(runtimeModules, "playwright/index.mjs")).href) : await import("playwright");
const { analyzeImportedSlideHtml, withImportedSlidePreviews } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-design.service.js"));
const { parseImportedSlideRequest } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-request.service.js"));
const { HTML_SLIDE_FILE_LIMITS } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-file.contract.js"));
const { prepareImportedSlidePackage } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-catalog.service.js"));
const fixture = `<!doctype html><html><head><style>
body{background:#102f45;color:#fff;margin:0}.slide{width:1920px;height:1080px;padding:100px;box-sizing:border-box;display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center}
h1{font-size:96px;line-height:1.05;margin:0}p{font-size:38px;line-height:1.3}.card{border:2px solid #47d8c1;padding:40px;border-radius:24px}
</style></head><body><section class="slide active"><h1>Diseño educativo</h1><div class="card"><p>Aprende con ejemplos concretos</p><p>Aplica lo aprendido en tu trabajo</p></div></section>
<script>window.injected=true;fetch('https://example.test/private')</script></body></html>`;
const output = path.join(webRoot, ".tmp/html-template-import-theme-qa");
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {ImportSlideTemplateDialog} from './src/domains/production/slides/import/components/ImportSlideTemplateDialog';
import {prepareImportedSlideFileInWorker} from './src/domains/production/slides/import/imported-slide-file.client';
window.prepareSlideFileForQA=prepareImportedSlideFileInWorker;
createRoot(document.getElementById('root')).render(<div className="soflia-engine-shell"><main className="engine-content"><header className="engine-page-hero"><h1>Plantillas de diapositivas</h1><p>Biblioteca de diseños de esta empresa</p><ImportSlideTemplateDialog/></header></main></div>);`, resolveDir: webRoot, loader: "tsx" },
  tsconfig: path.join(webRoot, "tsconfig.json"), bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  outfile: path.join(output, "fixture.js"),
  define: { "process.env": "{}", "import.meta.url": JSON.stringify("http://courseforge.test/fixture.js") }, plugins: [{ name: "navegacion-local-del-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter=()=>({refresh(){window.refreshed=true}})", loader: "js" }));
  } }] });
const workerBundle = await build({ entryPoints: [path.join(webRoot, "src/domains/production/slides/import/imported-slide-file.worker.ts")],
  bundle: true, write: false, format: "iife", platform: "browser" });
const css = await require("postcss")([require("@tailwindcss/postcss")()]).process(
  '@import "tailwindcss" source(none); @import "../../src/app/engine-design-system.css"; @source "../../src/domains/production/slides/import/components"; :root{--font-newsreader:Georgia;--font-inter-tight:Arial;--font-ibm-plex:Arial} body{padding:24px}',
  { from: path.join(webRoot, "tools/qa/import-qa.css") });
const browser = await chromium.launch({ headless: true, channel: process.env.SLIDE_IMPORT_QA_BROWSER_CHANNEL || undefined });
const failures = [];
const checks = [];
const transferredBytes = [];
let saved = 0;
let analyzedFiles = 0;
const bundleScript = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const moduleStyles = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;

async function contrast(page, selector) {
  return page.locator(selector).first().evaluate(element => {
    const context = document.createElement("canvas").getContext("2d");
    const luminance = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(document.documentElement).getPropertyValue("--engine-surface-solid"));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

try {
for (const theme of ["light", "dark"]) {
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
const page = await browser.newPage({ viewport });
const label = `${theme}-${viewport.width}`;
page.on("pageerror", error => failures.push(error.message));
await page.addInitScript(() => {
  window.workerLifecycle = { created: 0, terminated: 0 };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...arguments_) { super(...arguments_); window.workerLifecycle.created++; }
    terminate() { window.workerLifecycle.terminated++; super.terminate(); }
  };
});
await page.route("http://courseforge.test/**", async route => {
  if (route.request().url().endsWith("/imported-slide-file.worker.ts")) {
    await route.fulfill({ contentType: "text/javascript", body: workerBundle.outputFiles[0].text }); return;
  }
  if (route.request().method() === "POST") {
    const parsed = await parseImportedSlideRequest(new Request(route.request().url(), { method: "POST", body: route.request().postData() }));
    assert.equal(parsed.success, true);
    const payload = parsed.data;
    if (payload.action === "analyze") {
      analyzedFiles++;
      transferredBytes.push(Buffer.byteLength(payload.html));
      assert.ok(Buffer.byteLength(payload.html) < 2000);
      const analyzed = analyzeImportedSlideHtml(payload.html);
      await route.fulfill({ json: { success: true, ...withImportedSlidePreviews(analyzed) } });
    } else {
      assert.equal(payload.reviewed, true); prepareImportedSlidePackage(payload.title, payload.design); saved++;
      await route.fulfill({ json: { success: true, generationRunId: "fixture-local" } });
    }
  } else await route.fulfill({ contentType: "text/html", body: `<html lang="es" class="${theme === "dark" ? "dark" : ""}"><head><style>${css.css}\n${moduleStyles}</style></head><body><div id="root"></div></body></html>` });
});
  await page.goto("http://courseforge.test");
  await page.addScriptTag({ content: bundleScript });
  await page.evaluate(async () => {
    const controller = new AbortController();
    const pending = window.prepareSlideFileForQA(new File(['<section class="slide"><h1>Cancelar</h1></section>'], "cancelar.html"), controller.signal, () => {});
    controller.abort();
    try { await pending; throw new Error("La preparación no se canceló"); }
    catch (error) { if (error.message !== "Preparación cancelada.") throw error; }
    if (window.workerLifecycle.created !== 1 || window.workerLifecycle.terminated !== 1) throw new Error("Worker cancelado sin terminar");
  });
  await page.getByRole("button", { name: "Importar HTML" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(element => element.closest(".engine-page-hero")), null);
  assert.ok(await contrast(page, '[role="dialog"] h2') >= 4.5);
  assert.ok(await contrast(page, '[role="dialog"] label') >= 4.5);
  if (viewport.width > 768) assert.ok(await contrast(page, '[role="dialog"] header p:last-child') >= 4.5);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[role="dialog"]')).opacity) === 1);
  await page.screenshot({ path: path.join(output, `empty-${label}.png`), fullPage: true });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await page.getByRole("button", { name: "Importar HTML" }).evaluate(element => element === document.activeElement));
  await page.getByRole("button", { name: "Importar HTML" }).click();
  await page.getByLabel("Archivo HTML").setInputFiles({ name: "no-compatible.txt", mimeType: "text/plain", buffer: Buffer.from("archivo no compatible") });
  await page.getByRole("alert").waitFor();
  assert.ok(await contrast(page, '[role="dialog"] [role="alert"]') >= 4.5);
  // Construir File en el navegador evita transferir 100 MB de base64 por CDP.
  const selectLargeFile = async (bytes, name) => page.getByLabel("Archivo HTML").evaluate((input, { bytes, name, fixture }) => {
    const head = fixture.replace("</body></html>", '<img src="data:image/png;base64,');
    const tail = '"></body></html>';
    const padding = new Uint8Array(bytes - new TextEncoder().encode(head + tail).byteLength).fill(65);
    const file = new File([head, padding, tail], name, { type: "text/html" });
    const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { bytes, name, fixture });
  await selectLargeFile(HTML_SLIDE_FILE_LIMITS.bytes + 1, "demasiado-grande.html");
  await page.getByRole("alert").filter({ hasText: "100 MB" }).waitFor();
  const checkTransportExpansion = theme === "light" && viewport.width === 1440;
  if (checkTransportExpansion) {
    await page.getByLabel("Archivo HTML").setInputFiles({ name: "expansion-json.html", mimeType: "text/html", buffer: Buffer.concat([Buffer.from('<section class="slide"><h1>Control</h1><p>'), Buffer.alloc(900_000, 1), Buffer.from('</p></section>')]) });
    await page.getByRole("alert").filter({ hasText: "tamaño de transporte" }).waitFor();
    checks.push("JSON expandido rechazado en cliente antes de enviarlo a la API.");
  }
  const bytes = theme === "dark" && viewport.width === 1440 ? 100_000_000 : viewport.width === 390 ? 50_000_000 : 21_700_000;
  await selectLargeFile(bytes, "diseno-educativo.html");
  await page.getByRole("heading", { name: "Campos reutilizables" }).waitFor();
  const workers = checkTransportExpansion ? 3 : 2;
  assert.deepEqual(await page.evaluate(() => window.workerLifecycle), { created: workers, terminated: workers });
  const save = page.getByRole("button", { name: "Guardar en plantillas" });
  assert.equal(await save.isDisabled(), true);
  checks.push(`${label}: original de ${bytes} bytes preparado en Worker y reducido antes del HTTP; cancelación termina el Worker; archivo mayor de 100 MB rechazado; contraste, portal fuera del hero, Escape, foco y revisión obligatoria.`);
  const frame = page.frameLocator("iframe");
  await frame.getByText("Diseño educativo", { exact: true }).waitFor();
  const geometry = await frame.locator(".od-slide").evaluate(element => {
    const bounds = element.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, layout: getComputedStyle(element).display };
  });
  assert.deepEqual(geometry, { width: 1920, height: 1080, layout: "grid" });
  assert.equal(await frame.locator("script").count(), 0);
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
  assert.ok(await contrast(page, '[role="dialog"] select') >= 4.5);
  assert.ok(await contrast(page, '[role="dialog"] input[type="number"]') >= 4.5);
  checks.push(`${label}: preview aislado 1920×1080 y controles con contraste.`);
  await page.getByRole("checkbox").check();
  await page.getByLabel("Capacidad de field-2").fill("280");
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  await page.getByRole("checkbox").check();
  const bounds = await save.boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
  const scrollBody = dialog.locator(":scope > header + div");
  await scrollBody.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, `loaded-${label}.png`), fullPage: true });
  await save.click();
  await page.getByText("Plantilla guardada.", { exact: false }).waitFor();
  assert.equal(await save.isDisabled(), true);
  assert.ok(await contrast(page, '[role="dialog"] [role="status"]') >= 4.5);
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().width <= window.innerWidth));
  await scrollBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await dialog.locator("header").evaluate(element => element.getBoundingClientRect().top >= 0));
  checks.push(`${label}: acciones visibles, guardado simulado y cuerpo desplazable sin desbordamiento.`);
  await page.close();
}
}
  assert.equal(saved, 4);
  assert.equal(analyzedFiles, 4);
  assert.deepEqual(failures, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, failures, transferredBytes, persistence: "simulada; sin servicios externos" }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally { await browser.close(); }
