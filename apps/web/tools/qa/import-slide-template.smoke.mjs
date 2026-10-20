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
const { HTML_SLIDE_IMPORT_LIMITS } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/slides/import/imported-slide-design.contract.js"));
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
createRoot(document.getElementById('root')).render(<div className="soflia-engine-shell"><main className="engine-content"><header className="engine-page-hero"><h1>Plantillas de diapositivas</h1><p>Biblioteca de diseños de esta empresa</p><ImportSlideTemplateDialog/></header></main></div>);`, resolveDir: webRoot, loader: "tsx" },
  tsconfig: path.join(webRoot, "tsconfig.json"), bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  outfile: path.join(output, "fixture.js"),
  define: { "process.env": "{}" }, plugins: [{ name: "navegacion-local-del-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter=()=>({refresh(){window.refreshed=true}})", loader: "js" }));
  } }] });
const css = await require("postcss")([require("@tailwindcss/postcss")()]).process(
  '@import "tailwindcss" source(none); @import "../../src/app/engine-design-system.css"; @source "../../src/domains/production/slides/import/components"; :root{--font-newsreader:Georgia;--font-inter-tight:Arial;--font-ibm-plex:Arial} body{padding:24px}',
  { from: path.join(webRoot, "tools/qa/import-qa.css") });
const browser = await chromium.launch({ headless: true, channel: process.env.SLIDE_IMPORT_QA_BROWSER_CHANNEL || undefined });
const failures = [];
const checks = [];
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
await page.route("http://courseforge.test/**", async route => {
  if (route.request().method() === "POST") {
    const parsed = await parseImportedSlideRequest(new Request(route.request().url(), { method: "POST", body: route.request().postData() }));
    assert.equal(parsed.success, true);
    const payload = parsed.data;
    if (payload.action === "analyze") {
      analyzedFiles++;
      assert.ok(Buffer.byteLength(payload.html) > 500_000);
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
  await page.getByLabel("Archivo HTML").setInputFiles({ name: "demasiado-grande.html", mimeType: "text/html", buffer: Buffer.alloc(HTML_SLIDE_IMPORT_LIMITS.sourceBytes + 1, 32) });
  await page.getByRole("alert").filter({ hasText: "2 MB" }).waitFor();
  const largerFixture = fixture.replace("</script>", `${" ".repeat(600_000 - Buffer.byteLength(fixture))}</script>`);
  await page.getByLabel("Archivo HTML").setInputFiles({ name: "diseno-educativo.html", mimeType: "text/html", buffer: Buffer.from(largerFixture) });
  await page.getByRole("heading", { name: "Campos reutilizables" }).waitFor();
  const save = page.getByRole("button", { name: "Guardar en plantillas" });
  assert.equal(await save.isDisabled(), true);
  checks.push(`${label}: archivo de 600 KB admitido, archivo mayor de 2 MB rechazado; contraste, portal fuera del hero, Escape, retorno del foco y revisión obligatoria.`);
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
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, failures, persistence: "simulada; sin servicios externos" }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally { await browser.close(); }
