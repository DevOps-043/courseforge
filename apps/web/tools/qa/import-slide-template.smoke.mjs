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
const { analyzeImportedSlideHtml, importedDesignPreview } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-design.service.js"));
const { prepareImportedSlidePackage } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-catalog.service.js"));
const fixture = `<!doctype html><html><head><style>
body{background:#102f45;color:#fff;margin:0}.slide{width:1920px;height:1080px;padding:100px;box-sizing:border-box;display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center}
h1{font-size:96px;line-height:1.05;margin:0}p{font-size:38px;line-height:1.3}.card{border:2px solid #47d8c1;padding:40px;border-radius:24px}
</style></head><body><section class="slide active"><h1>Diseño educativo</h1><div class="card"><p>Aprende con ejemplos concretos</p><p>Aplica lo aprendido en tu trabajo</p></div></section>
<script>window.injected=true;fetch('https://example.test/private')</script></body></html>`;
const output = path.join(webRoot, ".tmp/html-template-import-qa");
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {ImportSlideTemplateDialog} from './src/domains/production/slides/import/components/ImportSlideTemplateDialog';
createRoot(document.getElementById('root')).render(<ImportSlideTemplateDialog/>);`, resolveDir: webRoot, loader: "tsx" },
  tsconfig: path.join(webRoot, "tsconfig.json"), bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env": "{}" }, plugins: [{ name: "navegacion-local-del-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter=()=>({refresh(){window.refreshed=true}})", loader: "js" }));
  } }] });
const css = await require("postcss")([require("@tailwindcss/postcss")()]).process(
  '@import "tailwindcss" source(none); @source "../../src/domains/production/slides/import/components"; :root{--engine-primary:#0a2540} body{font-family:Arial;background:#edf2f7;padding:24px}',
  { from: path.join(webRoot, "tools/qa/import-qa.css") });
const browser = await chromium.launch({ headless: true, channel: process.env.SLIDE_IMPORT_QA_BROWSER_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
const checks = [];
let saved = 0;
page.on("pageerror", error => failures.push(error.message));
await page.route("http://courseforge.test/**", async route => {
  if (route.request().method() === "POST") {
    const payload = route.request().postDataJSON();
    if (payload.action === "analyze") {
      const analyzed = analyzeImportedSlideHtml(payload.html);
      await route.fulfill({ json: { success: true, ...analyzed, previews: analyzed.design.layouts.map((_layout, index) => importedDesignPreview(analyzed.design, index)) } });
    } else {
      assert.equal(payload.reviewed, true); prepareImportedSlidePackage(payload.title, payload.design); saved++;
      await route.fulfill({ json: { success: true, generationRunId: "fixture-local" } });
    }
  } else await route.fulfill({ contentType: "text/html", body: `<html lang="es"><head><style>${css.css}</style></head><body><div id="root"></div></body></html>` });
});
try {
  await page.goto("http://courseforge.test");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Importar HTML" }).click();
  await page.getByLabel("Archivo HTML").setInputFiles({ name: "diseno-educativo.html", mimeType: "text/html", buffer: Buffer.from(fixture) });
  await page.getByRole("heading", { name: "Campos reutilizables" }).waitFor();
  const save = page.getByRole("button", { name: "Guardar en plantillas" });
  assert.equal(await save.isDisabled(), true);
  checks.push("La carga muestra reporte, preview y campos; el guardado exige revisión.");
  const frame = page.frameLocator("iframe");
  await frame.getByText("Diseño educativo", { exact: true }).waitFor();
  const geometry = await frame.locator(".od-slide").evaluate(element => {
    const bounds = element.getBoundingClientRect(); return { width: bounds.width, height: bounds.height, layout: getComputedStyle(element).display };
  });
  assert.deepEqual(geometry, { width: 1920, height: 1080, layout: "grid" });
  assert.equal(await frame.locator("script").count(), 0);
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
  checks.push("Preview aislado a 1920×1080: conserva grid y elimina el script externo.");
  await page.getByRole("checkbox").check();
  await page.getByLabel("Capacidad de field-2").fill("280");
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  checks.push("Cambiar la capacidad invalida la revisión anterior.");
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: path.join(output, "import-dialog.png"), fullPage: true });
  await save.click();
  await page.getByText("Plantilla guardada.", { exact: false }).waitFor();
  assert.equal(saved, 1); assert.equal(await save.isDisabled(), true);
  checks.push("Guardado confirmado con preflight editorial y protección contra doble envío.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("dialog").evaluate(element => { element.scrollTop = 0; });
  assert.ok(await page.getByRole("dialog").evaluate(element => element.getBoundingClientRect().width <= window.innerWidth));
  await page.screenshot({ path: path.join(output, "import-dialog-mobile.png"), fullPage: true });
  assert.deepEqual(failures, []);
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, geometry, failures, persistence: "simulada; sin servicios externos" }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally { await browser.close(); }
