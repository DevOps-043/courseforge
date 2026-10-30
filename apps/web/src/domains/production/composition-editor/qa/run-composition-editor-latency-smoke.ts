import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";
import { compositionQaDelay, launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}

async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`LATENCY_SMOKE_TIMEOUT: ${label}`);
    await compositionQaDelay(50);
  }
}

async function main() {
  const output = resolve(process.cwd(), ".tmp/composition-editor-latency-qa");
  await mkdir(output, { recursive: true });
  await build({
    bundle: true, entryPoints: [resolve(process.cwd(), "src/domains/production/composition-editor/qa/composition-editor-latency-smoke.fixture.tsx")],
    format: "iife", logLevel: "silent", outfile: resolve(output, "fixture.js"), platform: "browser", target: ["chrome120"],
    tsconfig: resolve(process.cwd(), "tsconfig.json"), define: { "process.env": "{}" },
    // Next replaces Server Actions with RPC proxies; esbuild needs an explicit test boundary.
    // This fixture must never upload to Storage or mutate an authenticated session.
    plugins: [{ name: "isolate-external-services", setup(builder) {
      builder.onLoad({ filter: /utils[\\/]supabase[\\/]client\.ts$/ }, () => ({
        contents: 'export function createClient() { throw new Error("UNEXPECTED_STORAGE_ACCESS_IN_LATENCY_TEST"); }', loader: "ts",
      }));
      builder.onLoad({ filter: /app[\\/]login[\\/]actions\.ts$/ }, () => ({
        contents: 'async function unexpectedAuthAction() { throw new Error("UNEXPECTED_AUTH_ACTION_IN_LATENCY_TEST"); } export { unexpectedAuthAction as loginAction, unexpectedAuthAction as logoutAction };', loader: "ts",
      }));
    } }],
  });
  const [bundle, css] = await Promise.all([readFile(resolve(output, "fixture.js")), readFile(resolve(output, "fixture.css"))]);
  let persisted = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "d".repeat(64), durationSeconds: 5, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "44444444-4444-4444-8444-444444444444", publicUrl: null, storageBucket: "production-assets", storagePath: "seed.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "", title: "Latency smoke" },
  });
  persisted.clips = [];
  let documentHash = "a".repeat(64);
  let version = 1;
  let previewRequests = 0;
  let documentRequests = 0;
  const pendingSaves: Array<(status: number) => void> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const json = (body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    try {
      if (url.pathname.endsWith("/document")) {
        documentRequests++;
        if (request.method === "PUT") {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString()) as { operations: CompositionEditorPatchOperation[] };
          assert.equal(request.headers["if-match"], `"${documentHash}"`);
          pendingSaves.push((status) => {
            if (status === 200) {
              persisted = applyCompositionEditorPatches(persisted, body.operations);
              version += 1; documentHash = version.toString(16).padStart(64, "0");
              json({ data: { document: persisted, documentHash, version } });
            } else if (status === 409) {
              documentHash = "c".repeat(64);
              json({ data: { document: persisted, documentHash, version }, error: "Conflicto simulado QA" }, 409);
            } else json({ error: "Fallo simulado QA" }, 500);
          });
        } else json({ data: { document: persisted, documentHash, version } });
      } else if (url.pathname.endsWith("/preview")) {
        previewRequests += 1;
        const html = await compileCompositionPreview({ document: persisted, documentHash, previewGeneration: Number(url.searchParams.get("r") || "0"), assetUrls: new Map() });
        const reporter = `<script>(() => {
          const report = () => parent.postMessage({ type: "qa-scene-state", layers: document.querySelectorAll('[data-hf-id]').length, texts: [...document.querySelectorAll('.composition-native-text')].map(node => node.textContent), boot: performance.timeOrigin }, '*');
          addEventListener('message', (event) => { if (event.data?.type === 'courseforge-composition-visual-patch') setTimeout(report, 0); });
          setTimeout(report, 100);
        })();</script>`;
        response.writeHead(200, { "Content-Type": "text/html" }); response.end(html.replace("</body>", `${reporter}</body>`));
      } else if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); }
      else if (url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
      else if (url.pathname.endsWith("/revisions")) json({ data: { snapshots: [], activeRevisionId: null } });
      else if (url.pathname.endsWith("/branding")) json({ data: { hasIntro: false, hasOutro: false, outros: [], selectedOutroAssetId: null } });
      else if (url.pathname.startsWith("/api/")) json({ data: [], success: true });
      else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><link rel="stylesheet" href="/fixture.css"><output id="scene-state"></output><div id="root"></div><script src="/fixture.js"></script>'); }
    } catch (error) { json({ error: String(error) }, 500); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-editor-latency-" }).catch((error) => { server.close(); throw error; });
  const exceptions: unknown[] = [];
  browser.client.onEvent?.("Runtime.exceptionThrown", (event) => { if (exceptions.length < 5) exceptions.push(event.exceptionDetails); });
  try {
    await browser.client.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    const state = () => evaluate<{ layers: number; boot: number; texts: string[] }>(browser.client, "JSON.parse(document.querySelector('#scene-state').textContent || '{}')");
    await waitFor(async () => (await state()).layers === 0, "initial preview");
    await evaluate(browser.client, `Array.from(document.querySelectorAll('[role=tab]')).find((button) => button.textContent.trim() === 'Texto').click(); true`);
    await waitFor(() => evaluate(browser.client, `Array.from(document.querySelectorAll('button')).some((button) => button.textContent.includes('Capa de texto'))`), "text library tab");
    const addText = () => evaluate(browser.client, `Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Capa de texto')).click(); true`);
    const initialBoot = (await state()).boot;
    const initialRequests = previewRequests;
    await addText();
    await waitFor(async () => pendingSaves.length === 1 && (await state()).layers === 1, "local preview before slow save");
    assert.equal(persisted.clips.length, 0);
    assert.equal((await state()).boot, initialBoot);
    assert.equal(previewRequests, initialRequests);
    assert.equal(await evaluate(browser.client, 'document.querySelector(\'[aria-label="Posición del preview"]\').disabled'), false, "El guardado no debe bloquear el scrub local.");
    await evaluate(browser.client, "document.querySelector('[data-clip-id]').click(); true");
    await waitFor(() => evaluate(browser.client, "Boolean(document.querySelector('[aria-label=\"Contenido de la capa de texto\"]'))"), "inspector disponible durante PUT");
    assert.equal(await evaluate(browser.client, "document.querySelector('[aria-label=\"Contenido de la capa de texto\"]').disabled"), false);
    await evaluate(browser.client, `(() => { const field = document.querySelector('[aria-label="Contenido de la capa de texto"]'); field.focus(); field.select(); return true; })()`);
    await browser.client.send("Input.insertText", { text: "Segundo cambio durante guardado" });
    await evaluate(browser.client, `document.querySelector('[aria-label="Contenido de la capa de texto"]').blur(); true`);
    await waitFor(async () => (await state()).texts.includes("Segundo cambio durante guardado"), "segundo cambio visible antes de confirmar el primero");
    assert.equal(pendingSaves.length, 1, "La segunda edición no inicia otro PUT concurrente.");
    assert.equal(persisted.clips.length, 0);
    assert.equal(previewRequests, initialRequests);
    await evaluate(browser.client, `(() => { const field = document.querySelector('[aria-label="Contenido de la capa de texto"]'); field.focus(); field.select(); return true; })()`);
    await browser.client.send("Input.insertText", { text: "Tercer cambio de la misma herramienta" });
    await evaluate(browser.client, `document.querySelector('[aria-label="Contenido de la capa de texto"]').blur(); true`);
    await waitFor(async () => (await state()).texts.includes("Tercer cambio de la misma herramienta"), "tercera intención del control en vuelo");
    assert.equal(pendingSaves.length, 1);
    pendingSaves.shift()!(200);
    await waitFor(async () => pendingSaves.length === 1, "PUT del segundo comando tras confirmar el primero");
    assert.ok((await state()).texts.includes("Tercer cambio de la misma herramienta"), "La respuesta anterior no borra el nuevo borrador.");
    pendingSaves.shift()!(200);
    await waitFor(async () => pendingSaves.length === 1, "tercer PUT serial");
    assert.equal(persisted.clips[0]!.source.type === "NATIVE_TEXT" && persisted.clips[0]!.source.text, "Segundo cambio durante guardado");
    assert.ok((await state()).texts.includes("Tercer cambio de la misma herramienta"));
    pendingSaves.shift()!(200);
    await waitFor(async () => await evaluate(browser.client, "!document.body.textContent.includes('Guardando')"), "save acknowledgement");
    assert.equal(previewRequests, initialRequests, "El ACK del guardado no debe navegar el iframe.");
    await addText();
    await waitFor(async () => pendingSaves.length === 1 && (await state()).layers === 2, "second optimistic edit");
    pendingSaves.shift()!(500);
    await waitFor(async () => (await state()).layers === 1 && previewRequests > initialRequests, "rollback after save failure");
    assert.equal(persisted.clips.length, 1);
    assert.equal(await evaluate(browser.client, "document.body.textContent.includes('Fallo simulado QA')"), true);
    assert.equal(pendingSaves.length, 0, "El journal no debe reintentar un error de esta sesión.");
    await addText();
    await compositionQaDelay(100);
    assert.equal(pendingSaves.length, 0, "No se admiten nuevas escrituras con recuperación pendiente.");
    await evaluate(browser.client, `Array.from(document.querySelectorAll('[role="alert"] button')).find(button => button.textContent.trim() === "Reintentar").click(); true`);
    await waitFor(async () => pendingSaves.length === 1, "recuperación explícita tras recargar");
    const beforeConflict = previewRequests;
    pendingSaves.shift()!(409);
    await waitFor(async () => (await state()).layers === 1 && previewRequests > beforeConflict, "conflict recovery");
    assert.equal(await evaluate(browser.client, "document.body.textContent.includes('Conflicto simulado QA')"), true);
    const report = { concurrentEditingBeforePersistence: "passed", repeatedControlWhileSaving: "passed", lateResponsePreservesDraft: "passed", serialWrites: "passed", slowSavePreviewBeforePersistence: "passed", reloadAfterSuccess: false, saveFailureRollback: "passed", conflictRecovery: "passed" };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ previewRequests, exceptions, documentRequests, pendingSaves: pendingSaves.length }, null, 2)}\n`);
    throw error;
  } finally {
    pendingSaves.splice(0).forEach((finish) => finish(500));
    await browser.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
