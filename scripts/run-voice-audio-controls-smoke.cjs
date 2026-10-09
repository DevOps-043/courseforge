// Browser integration for the actual controls, with local API responses and no user data.
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { existsSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const { build } = require("esbuild");
const toolRequire = createRequire(resolve("apps/web/tools/controlled-hyperframes/package.json"));
const puppeteer = toolRequire("puppeteer");
const originalId = "f81d4fae-7dec-4a08-bd4b-5d2b2b6d0c44";
const processedId = "18335cbe-52e0-4ef7-94e2-6a4e2cd4f296";
const jobId = "91ee2ece-eb0e-4273-a727-c8c731a83b89";

async function main() {
  let processed = false;
  const requests = [];
  const component = resolve("apps/web/src/domains/materials/components/composition-editor/AudioProcessingControls.tsx").replaceAll("\\", "/");
  const bundle = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AudioProcessingControls} from ${JSON.stringify(component)};
      const root=createRoot(document.getElementById('root')); window.replacements=[];
      window.selectFixture=(sourceAssetId)=>root.render(<AudioProcessingControls key={sourceAssetId} componentId="4fbcd2af-f3ea-42cd-95fe-f822d201273d" disabled={false} sourceAssetId={sourceAssetId} sourcePreviewUrl={null}
        onReplaceAudio={async(id,duration)=>{window.replacements.push({id,duration}); window.selectFixture(id); return true;}}/>);
      window.selectFixture('${originalId}');`, loader: "tsx", resolveDir: process.cwd() } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
    if (url.pathname !== "/api/production/audio-processing/jobs") { response.setHeader("Content-Type", "text/html"); response.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); return; }
    response.setHeader("Content-Type", "application/json");
    requests.push({ method: request.method, sourceAssetId: url.searchParams.get("sourceAssetId"), jobId: url.searchParams.get("jobId") });
    if (request.method === "POST") {
      let body = ""; for await (const chunk of request) body += chunk;
      requests.at(-1).body = JSON.parse(body);
      processed = true;
      response.statusCode = 202;
      response.end(JSON.stringify({ success: true, data: { jobId, status: "PENDING" } }));
      return;
    }
    const ineligible = url.searchParams.get("sourceAssetId") === "music";
    const data = { capability: ineligible ? { eligible: false, code: "AUDIO_SOURCE_INVALID", reason: "El recurso no está registrado como narración de voz." } : { eligible: true, code: null, reason: null },
      source: { assetId: originalId, publicUrl: null, durationSeconds: 6.375 },
      status: processed ? "SUCCEEDED" : "NOT_REQUESTED", job: processed ? { id: jobId, status: "SUCCEEDED" } : null,
      processedAudio: processed ? { assetId: processedId, publicUrl: null, durationSeconds: 6.375 } : null };
    response.end(JSON.stringify({ success: true, data }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profile = resolve(".tmp/voice-audio-browser-profile-" + Date.now());
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, userDataDir: profile, args: ["--no-sandbox"], ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const clickText = async (text) => {
      await page.waitForFunction((label) => [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === label && !button.disabled), {}, text);
      await page.evaluate((label) => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label).click(), text);
    };
    await clickText("Procesar voz");
    await clickText("Usar audio procesado");
    await clickText("Restaurar voz original conservando ediciones");
    const replacements = await page.evaluate(() => window.replacements);
    assert.deepEqual(replacements, [{ id: processedId, duration: 6.375 }, { id: originalId, duration: 6.375 }]);
    assert.ok(requests.some((request) => request.method === "GET" && request.jobId === jobId), "polling must use the POST jobId");
    assert.equal(requests.find((request) => request.method === "POST").body.sourceAssetId, originalId);
    await page.evaluate(() => window.selectFixture("music"));
    await page.waitForFunction(() => document.body.textContent.includes("no está registrado como narración"));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.includes("Procesar voz")).disabled), true);
    const outputDirectory = resolve(".tmp/voice-audio-compatibility");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(resolve(outputDirectory, "controls-evidence.json"), JSON.stringify({ controls: "passed", requests, replacements }, null, 2));
    console.log(JSON.stringify({ controls: "passed", applicationAndRestoration: "passed", ineligibleSource: "disabled", jobIdPolling: "passed" }));
  } finally { if (browser) await browser.close(); await new Promise((done) => server.close(done)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
