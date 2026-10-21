import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const [runtimeModules, sourcePath] = process.argv.slice(2);
if (!sourcePath) throw new Error("Indica el directorio de módulos del runtime y un archivo HTML local.");
const maximumPixelDifferencePercent = Number(process.env.SLIDE_IMPORT_QA_MAX_PIXEL_DIFFERENCE ?? "0.1");
assert.ok(Number.isFinite(maximumPixelDifferencePercent) && maximumPixelDifferencePercent >= 0 && maximumPixelDifferencePercent <= 100);
const { chromium } = await import(pathToFileURL(path.join(runtimeModules, "playwright/index.mjs")).href);
const compiled = path.join(webRoot, ".tmp/remotion-tests/domains/production/slides");
const { prepareImportedSlideFile } = require(path.join(compiled, "import/imported-slide-file-preparation.service.js"));
const { analyzeImportedSlideHtml, withImportedSlidePreviews, importedDesignDigest } = require(path.join(compiled, "import/imported-slide-design.service.js"));
const { saveImportedSlidePackage } = require(path.join(compiled, "import/imported-slide-catalog.service.js"));
const { hydrateImportedDesignForOrganization } = require(path.join(compiled, "import/imported-slide-bundle-assets.server.js"));
const { createImportCatalogFixture } = require(path.join(compiled, "__tests__/imported-slide-catalog.fixture.js"));
const { load } = require("cheerio");
const sharp = require("sharp");
const output = path.join(webRoot, ".tmp/html-template-fidelity-qa");
await mkdir(output, { recursive: true });
const raw = await readFile(sourcePath);
const prepared = await prepareImportedSlideFile(new Blob([raw]), () => {}, true);
console.log("Original preparado y recursos deduplicados.");
const analyzed = analyzeImportedSlideHtml(prepared.html, prepared);
console.log("Contrato HTML y recursos validados.");
const catalog = createImportCatalogFixture();
const context = { admin: catalog.admin, organizationId: "organizacion-qa", userId: "actor-qa", platformRole: "ADMIN" };
const saved = await saveImportedSlidePackage(context, "Diseño HTML QA", analyzed.design);
console.log("Paquete guardado en almacenamiento simulado.");
const record = [...catalog.tables.get("soflia_bundle_specs").values()][0].spec_json;
assert.doesNotMatch(JSON.stringify(record), /"base64"/);
const hydrated = await hydrateImportedDesignForOrganization(record.importedDesign, context);
console.log("Recursos recuperados del ZIP y hashes verificados.");
assert.equal(importedDesignDigest(hydrated), importedDesignDigest(analyzed.design));
assert.ok(hydrated.assets.every(asset => asset.base64));
const response = withImportedSlidePreviews({ ...analyzed, design: hydrated });
assert.ok(Buffer.byteLength(JSON.stringify(response)) < 5_000_000);

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {ImportedSlidePreview} from './src/domains/production/slides/import/components/ImportedSlidePreview';
const root=createRoot(document.getElementById('root'));window.renderPreview=(html,assets)=>root.render(<ImportedSlidePreview html={html} assets={assets} title="Diseño"/>);`,
  resolveDir: webRoot, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic" });
const browser = await chromium.launch({ headless: true, channel: process.env.SLIDE_IMPORT_QA_BROWSER_CHANNEL || "chrome" });
const results = [];
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.setContent(`<style>body{margin:0}#root>div{position:relative;width:960px;height:540px;overflow:hidden}iframe{position:absolute;left:0;top:0;border:0}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  async function capture(html, assets, file) {
    const marker = file.replace(/\.png$/, "");
    html = html.replace("</head>", `<meta name="qa-capture" content="${marker}"></head>`);
    await page.evaluate(({ html, assets }) => window.renderPreview(html, assets), { html, assets });
    const frame = page.frameLocator("iframe");
    await frame.locator(`meta[name="qa-capture"][content="${marker}"]`).waitFor({ state: "attached" });
    await frame.locator("h1,h2").first().waitFor({ state: "attached" });
    await frame.locator("body").evaluate(async () => { await document.fonts.ready; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(output, file) });
    return frame;
  }
  for (let index = 0; index < hydrated.layouts.length; index++) {
    const original = load(raw.toString("utf8"));
    original("script,iframe,object,embed,link,meta,base").remove();
    original("*").each((_index, node) => { for (const key of Object.keys(node.attribs ?? {})) if (/^on/i.test(key)) original(node).removeAttr(key); });
    original(".slide").removeClass("active").eq(index).addClass("active");
    original("head").prepend(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;">`);
    const referenceFile = `original-${index + 1}.png`;
    const preparedFile = `importada-${index + 1}.png`;
    await capture(original.html(), [], referenceFile);
    const frame = await capture(response.previews[index], hydrated.assets, preparedFile);
    assert.equal(await frame.locator("script").count(), 0);
    const text = await frame.locator("h1,h2").first().textContent();
    assert.ok(text.trim());
    const first = await sharp(path.join(output, referenceFile)).ensureAlpha().raw().toBuffer();
    const second = await sharp(path.join(output, preparedFile)).ensureAlpha().raw().toBuffer();
    assert.equal(first.length, second.length);
    let changed = 0;
    for (let pixel = 0; pixel < first.length; pixel += 4) if (Math.max(...[0, 1, 2].map(channel => Math.abs(first[pixel + channel] - second[pixel + channel]))) > 12) changed++;
    results.push({ layout: index + 1, changedPixelPercent: Number((changed / (first.length / 4) * 100).toFixed(3)), referenceFile, preparedFile });
  }
  assert.deepEqual(errors, []);
  const report = { originalBytes: raw.length, preparedBytes: prepared.preparedBytes, uniqueAssets: hydrated.assets.length,
    resourceBytes: hydrated.assets.reduce((sum, asset) => sum + asset.byteLength, 0), responseBytes: Buffer.byteLength(JSON.stringify(response)),
    savedRun: saved.generationRunId, persistence: "BD/storage simulados, ZIP y recarga reales", maximumPixelDifferencePercent, results, errors };
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.ok(results.every(result => result.changedPixelPercent <= maximumPixelDifferencePercent), "La comparación visual supera el umbral de diferencia permitido.");
} finally { await browser.close(); }
