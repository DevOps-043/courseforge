import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], "playwright/index.mjs")).href);
const compiled = path.join(webRoot, ".tmp/remotion-tests/domains/production/slides");
const { prepareImportedSlideFile } = require(path.join(compiled, "import/imported-slide-file-preparation.service.js"));
const { analyzeImportedSlideHtml, withImportedSlidePreviews } = require(path.join(compiled, "import/imported-slide-design.service.js"));
const { saveImportedSlidePackage } = require(path.join(compiled, "import/imported-slide-catalog.service.js"));
const { loadImportedTemplateBase } = require(path.join(compiled, "import/imported-template-base.service.js"));
const { createImportedTemplateStudioSpec } = require(path.join(compiled, "import/imported-template-studio.service.js"));
const { hydrateImportedDesignForOrganization } = require(path.join(compiled, "import/imported-slide-bundle-assets.server.js"));
const { buildSlideTemplatePackageZip } = require(path.join(webRoot, ".tmp/remotion-tests/domains/production/bundle-agent/slide-template-package.service.js"));
const { createImportCatalogFixture } = require(path.join(compiled, "__tests__/imported-slide-catalog.fixture.js"));
const output = path.join(webRoot, ".tmp/imported-template-studio-qa");
await mkdir(output, { recursive: true });
const source = '<style>body{margin:0;color:white}.slide{width:1920px;height:1080px;padding:100px;background:#123456;box-sizing:border-box}h1{font-size:100px}p{font-size:50px}</style><section class="slide"><h1>Base importada</h1><p>October 2026</p></section><section class="slide"><h1>Diseño secundario</h1><p>Contenido original</p></section>';
const prepared = await prepareImportedSlideFile(new Blob([source]), () => {}, true);
const design = analyzeImportedSlideHtml(prepared.html, prepared).design;
const fixture = createImportCatalogFixture();
const context = { admin: fixture.admin, organizationId: "organizacion-qa", userId: "actor", platformRole: "ADMIN" };
const saved = await saveImportedSlidePackage(context, "Base reutilizable QA", design);
const sourceSnapshot = JSON.stringify([...fixture.tables.get("soflia_bundle_specs").values()]);
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ImportedTemplateStudio} from './src/domains/production/slides/import/components/ImportedTemplateStudio';createRoot(document.getElementById('root')).render(<ImportedTemplateStudio/>);`, resolveDir: webRoot, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "navegacion-del-fixture", setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.endsWith("link")
      ? 'export default function Link(props){return window.React.createElement("a",props)}'
      : 'export const useParams=()=>({empresaSlug:"empresa-qa"});export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({replace(url){history.replaceState(null,"",url)}});' }));
  } }] });
// El fixture usa el Link real de React a través de este global, sin servicios Next.
const reactBundle = await build({ stdin: { contents: 'import React from "react";window.React=React;', resolveDir: webRoot }, bundle: true, write: false, platform: "browser", format: "iife" });
const css = await require("postcss")([require("@tailwindcss/postcss")()]).process('@import "tailwindcss" source(none);@import "../../src/app/engine-design-system.css";@source "../../src/domains/production/slides/import/components";body{margin:0;background:var(--engine-canvas)}', { from: path.join(webRoot, "tools/qa/studio-qa.css") });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const checks = [], failures = [];
try {
  for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const label = `${theme}-${width}`;
    page.on("pageerror", error => failures.push(error.message));
    let state = null, aiCalls = 0;
    const testRecovery = theme === "light" && width === 1440;
    let failNextRevision = testRecovery;
    const conversationId = "12345678-1234-4234-8234-123456789012";
    await page.route("http://courseforge.test/**", async route => {
      const url = new URL(route.request().url()), method = route.request().method();
      const body = method === "POST" || method === "PATCH" ? route.request().postDataJSON() : null;
      const respond = payload => route.fulfill({ json: { success: true, ...payload } });
      try {
        if (url.pathname.includes("/design-bases/")) return respond(withImportedSlidePreviews(await loadImportedTemplateBase(context, saved.generationRunId)));
        if (url.pathname === "/api/admin/remotion/bundle-agent/conversations") {
          state = { conversation: { id: conversationId, title: body.title }, specs: [], messages: [], generationRuns: [] };
          return respond({ conversation: state.conversation });
        }
        if (url.pathname.endsWith("/messages")) { state.messages.push({ role: body.role, content_redacted: body.content }); return respond({}); }
        if (url.pathname.endsWith("/specs")) {
          const edited = await createImportedTemplateStudioSpec({ context, title: state.conversation.title, latestSpec: state.specs[0]?.spec_json,
            options: body.importedBase, messages: state.messages }, async () => {
            aiCalls++;
            if (failNextRevision) { failNextRevision = false; throw new Error("Fallo IA simulado"); }
            return { model: "simulado", proposal: { summary: "Portada adaptada", cssAppend: '.cf-import-root h1{color:#fedcba}',
              fields: [{ layoutId: "design-1", fieldId: "field-1", text: "Liderazgo" }, { layoutId: "design-1", fieldId: "field-2", clear: true }] } };
          });
          const spec = { id: `revision-${state.specs.length + 1}`, spec_json: edited.spec };
          state.specs.unshift(spec); state.messages.push({ role: "TOOL", content_redacted: edited.spec.changeSummary });
          return respond({ spec });
        }
        if (url.pathname.endsWith("/generate")) {
          const spec = state.specs[0].spec_json;
          const full = await hydrateImportedDesignForOrganization(spec.importedDesign, context);
          await buildSlideTemplatePackageZip({ ...spec, importedDesign: full });
          state.generationRuns.unshift({ id: "run-nuevo", status: "PACKAGED" }); return respond({});
        }
        if (url.pathname === "/api/admin/slides/templates/import") {
          const spec = state.specs[0].spec_json;
          const full = await hydrateImportedDesignForOrganization(spec.importedDesign, context);
          return respond(withImportedSlidePreviews({ design: full, title: spec.title }));
        }
        if (url.pathname.includes("/api/admin/remotion/bundle-agent/conversations/")) {
          if (method === "PATCH") state.conversation.title = body.title;
          return respond(state);
        }
        await route.fulfill({ contentType: "text/html", body: `<html class="${theme === "dark" ? "dark" : ""}"><head><style>${css.css}</style></head><body><div id="root"></div><script>${reactBundle.outputFiles[0].text}</script><script>${bundle.outputFiles[0].text}</script></body></html>` });
      } catch (error) { if (error.message !== "Fallo IA simulado") failures.push(error.message); await route.fulfill({ status: 422, json: { success: false, error: error.message } }); }
    });
    await page.goto(`http://courseforge.test/admin/slides/templates?baseRunId=${saved.generationRunId}`);
    const frame = page.frameLocator("iframe");
    await frame.getByRole("heading", { name: "Base importada" }).waitFor();
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
    assert.equal(await frame.locator("script").count(), 0);
    assert.equal(await frame.locator(".od-slide").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(18, 52, 86)");
    await page.getByLabel("Nombre de la nueva plantilla").fill("Variante de liderazgo");
    await page.getByRole("checkbox", { name: "Diseño secundario" }).uncheck();
    await page.getByLabel("Instrucción para la IA").fill("Adapta la portada a liderazgo y elimina la fecha.");
    await page.getByRole("button", { name: "Aplicar cambios con IA" }).click();
    if (testRecovery) {
      await page.getByRole("alert").filter({ hasText: "Fallo IA simulado" }).waitFor();
      assert.equal(state.specs.length, 1);
      await page.reload();
      await page.frameLocator("iframe").getByRole("heading", { name: "Base importada" }).waitFor();
      await page.getByLabel("Instrucción para la IA").fill("Adapta la portada a liderazgo y elimina la fecha.");
      await page.getByRole("button", { name: "Aplicar cambios con IA" }).click();
      checks.push("Fallo IA simulado: borrador inicial persistido, recargado y revisado sin mutar la fuente.");
    }
    await frame.getByRole("heading", { name: "Liderazgo" }).waitFor();
    assert.equal(await frame.getByText("October 2026").count(), 0);
    assert.equal(await page.getByRole("checkbox").count(), 1);
    await page.getByRole("button", { name: "Guardar como plantilla nueva" }).click();
    await page.getByText("Plantilla nueva guardada en la biblioteca.", { exact: false }).waitFor();
    assert.equal(aiCalls, testRecovery ? 2 : 1);
    assert.equal(state.specs[0].spec_json.importedDesign.layouts.length, 1);
    assert.equal(state.specs[0].spec_json.designBase.runId, saved.generationRunId);
    const buttonContrast = await page.getByRole("button", { name: "Guardar como plantilla nueva" }).evaluate(node => {
      const luminance = color => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const style = getComputedStyle(node), first = luminance(style.color), second = luminance(style.backgroundColor);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    });
    assert.ok(buttonContrast >= 4.5);
    await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
    assert.ok(await page.locator("main").evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.reload();
    await page.frameLocator("iframe").getByRole("heading", { name: "Liderazgo" }).waitFor();
    assert.equal(await page.getByLabel("Nombre de la nueva plantilla").inputValue(), "Variante de liderazgo");
    checks.push(`${label}: HTML real, selección individual, revisión IA simulada, guardado ZIP, recarga, sandbox y sin desbordamiento.`);
    await page.close();
  }
  assert.equal(JSON.stringify([...fixture.tables.get("soflia_bundle_specs").values()]), sourceSnapshot);
  assert.deepEqual(failures, []);
  const report = { checks, failures, persistence: "Simulada; servicios de base, edición, recursos y ZIP reales; proveedor IA simulado. No se prueba HTTP Next ni Supabase remoto." };
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
