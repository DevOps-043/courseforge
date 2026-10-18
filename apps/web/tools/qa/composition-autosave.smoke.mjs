import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const runtimeModules = process.argv[2];
const { chromium } = runtimeModules
  ? await import(pathToFileURL(path.join(runtimeModules, "playwright/index.mjs")).href)
  : await import("playwright");
const webRoot = path.resolve(import.meta.dirname, "../..");
const output = path.join(webRoot, ".tmp/autosave-qa");
await mkdir(output, { recursive: true });
const { createHtmlEditingRevisionFixture } = await import(pathToFileURL(path.join(webRoot, ".tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-test-fixtures.js")).href);
const { createHtmlEditingInspectorView } = await import(pathToFileURL(path.join(webRoot, ".tmp/hyperframes-tests/domains/production/composition-editor/html-editing/html-editing-inspector.server.js")).href);
const fixture = createHtmlEditingRevisionFixture();
const htmlView = createHtmlEditingInspectorView({ ...fixture.authority, encodedRevision: JSON.stringify(fixture.current.revision), compositionDocumentHash: fixture.row.compositionDocumentHash });
const source = `
import React, {useState, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {CompositionAutosaveBoundary, CompositionAutosaveContext} from './src/domains/materials/components/composition-editor/CompositionAutosaveBoundary';
import {CompositionAutosaveCoordinator} from './src/domains/production/composition-editor/composition-interaction-autosave';
import {CompositionInspector} from './src/domains/materials/components/composition-editor/CompositionInspector';
import {CompositionHtmlEditableFields} from './src/domains/materials/components/composition-editor/CompositionHtmlEditableFields';
window.qa = {calls: [], patches: [], htmlCalls: [], fail: false};
function Demo() {
 const [text,setText]=useState('original'), [signal,setSignal]=useState(null), [shown,setShown]=useState(true);
 const [saving,setSaving]=useState(false);
 const [doc,setDoc]=useState({clips:[{id:'clip-1', hfId:'hf-1', label:'Video de prueba', kind:'VIDEO', trackId:'visual', startSeconds:0, durationSeconds:4, sourceDurationSeconds:10,
 source:{type:'PRODUCTION_ASSET',productionAssetId:'40000000-0000-4000-8000-000000000001',hasAudio:true},
 layout:{x:0,y:0,width:960,height:540,rotation:0,opacity:1,zIndex:1}}],tracks:[{id:'visual',label:'Video',kind:'VIDEO',semanticRole:'BROLL',volume:1}]});
 const current=useRef(doc); current.current=doc;
 const owner=useRef(new CompositionAutosaveCoordinator());
 const saveText=async()=>{ window.qa.calls.push(text); await new Promise(r=>setTimeout(r,40)); return !window.qa.fail; };
 const patch=async(ops)=>{ setSaving(true); await new Promise(r=>setTimeout(r,40)); const next=structuredClone(current.current);
   for(const op of ops) { const clip=next.clips.find(c=>c.id===op.clipId); if(!clip) continue;
    if(op.type==='clip.layout') Object.assign(clip.layout,op.layout);
    if(op.type==='clip.crop') clip.crop=op.crop;
    if(op.type==='clip.color-grading') clip.colorGrading=op.colorGrading;
    if(op.type==='clip.move') clip.startSeconds=op.startSeconds;
    if(op.type==='clip.duration') clip.durationSeconds=op.durationSeconds;
    if(op.type==='clip.volume') clip.volume=op.volume;
    if(op.type==='clip.audio-fades') {clip.fadeInSeconds=op.fadeInSeconds;clip.fadeOutSeconds=op.fadeOutSeconds;}
   }
   if(JSON.stringify(next)!==JSON.stringify(current.current)) { window.qa.patches.push(ops); current.current=next;setDoc(next); } setSaving(false); return true; };
 return <CompositionAutosaveContext.Provider value={owner.current}>
  {shown && <CompositionAutosaveBoundary value={text} onCommit={saveText} signal={signal}>
   <label>Texto de prueba<textarea aria-label="Texto de prueba" value={text} onChange={e=>setText(e.target.value)}/></label>
  </CompositionAutosaveBoundary>}
  <button onClick={()=>{setTimeout(()=>{setText('importado');setSignal('importación');},30)}}>Importar prueba</button>
  <button onClick={()=>setShown(false)}>Cerrar prueba</button>
  <main><CompositionInspector animations={[]} clip={doc.clips[0]} componentId={null} cropModeEnabled={true}
   colorGradingStatus={{state:'active'}} onAnimationSelect={()=>{}} onDetachAudio={async()=>{}} onPatch={patch}
   onPreviewCrop={()=>{}} onPreviewColorGrading={()=>{}} onRemove={async()=>{}} saving={saving} selectedAnimationId={null}
   separatingAudio={false} separatingAudioProgress={0} sourcePreviewUrl={null} track={doc.tracks.find(t=>t.id===doc.clips[0].trackId)}/></main>
  <aside id="html"><CompositionHtmlEditableFields view={${JSON.stringify(htmlView)}} busy={false} onCommit={async overrides=>{window.qa.htmlCalls.push(overrides); return true;}}/></aside>
 </CompositionAutosaveContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Demo/>);
`;
const bundle = await build({
  stdin: { contents: source, resolveDir: webRoot, loader: "tsx" }, tsconfig: path.join(webRoot, "tsconfig.json"),
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env": "{}" }, loader: { ".css": "text" }, logLevel: "silent",
  plugins: [{ name: "clases-css-del-fixture", setup(builder) { builder.onLoad({filter: /\.module\.css$/}, () => ({contents: "export default {};", loader: "js"})); } }],
});
const browser = await chromium.launch({ headless: true, channel: process.env.AUTOSAVE_QA_BROWSER_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const failures = [];
page.on("pageerror", error => failures.push(error.message));
const checks = [];
try {
  await page.setContent('<html lang="es"><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByLabel("Texto de prueba").waitFor();
  await page.getByLabel("Texto de prueba").fill("uno");
  await page.getByLabel("Texto de prueba").fill("último");
  await page.waitForFunction(() => window.qa.calls.length === 1);
  assert.deepEqual(await page.evaluate(() => window.qa.calls), ["último"]);
  await page.getByLabel("Texto de prueba").blur();
  await page.waitForTimeout(850);
  assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
  checks.push("Texto con pausa y blur: un solo guardado");

  await page.getByRole("button", { name: "Importar prueba" }).click();
  await page.waitForFunction(() => window.qa.calls.includes("importado"));
  checks.push("Cambio asincrónico: se guarda al completar importación");

  await page.evaluate(() => { window.qa.fail = true; });
  await page.getByLabel("Texto de prueba").fill("conservar tras error");
  await page.getByText("No se confirmó el cambio.", { exact: false }).waitFor();
  const attempts = await page.evaluate(() => window.qa.calls.length);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.qa.calls.length), attempts);
  await page.evaluate(() => { window.qa.fail = false; });
  await page.getByRole("button", { name: "Reintentar cambio pendiente" }).click();
  await page.waitForFunction(previous => window.qa.calls.length === previous + 1, attempts);
  checks.push("Error: sin reintento automático; recuperación explícita");
  await page.waitForTimeout(120);

  const x = page.getByLabel("Posición X", { exact: true });
  await x.fill("125"); await x.blur();
  await page.waitForFunction(() => window.qa.patches.some(ops => ops.some(op => op.type === 'clip.layout' && op.layout.x === 125)));
  assert.equal(await page.getByRole("button", { name: /Guardar (cambios|layout|recorte|audio|animación|texto|color|plano|curva|velocidad)/ }).count(), 0);
  checks.push("Inspector real: posición guardada sin botón Guardar");
  const beforeInvalid = await page.evaluate(() => window.qa.patches.length);
  await x.fill(""); await x.blur();
  await page.getByText("Completa o corrige los valores", {exact:false}).waitFor();
  assert.equal(await page.evaluate(() => window.qa.patches.length), beforeInvalid);
  await x.fill("126"); await x.blur();
  await page.waitForFunction(previous => window.qa.patches.length === previous + 1, beforeInvalid);
  checks.push("Campo vacío no se convierte en cero; corrección posterior automática");

  const beforeCrop = await page.evaluate(() => window.qa.patches.length);
  // El bloque de recorte identifica los bordes por su etiqueta visible.
  const topCrop = page.locator('label').filter({ hasText: 'Superior' }).locator('input[type="range"]');
  await topCrop.dispatchEvent("pointerdown");
  await topCrop.evaluate(element => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (let value = 1; value <= 25; value++) { set.call(element, String(value)); element.dispatchEvent(new Event("input", {bubbles:true})); } });
  await page.waitForTimeout(750);
  assert.equal(await page.evaluate(() => window.qa.patches.length), beforeCrop);
  await topCrop.dispatchEvent("pointerup");
  await page.waitForFunction(previous => window.qa.patches.length === previous + 1, beforeCrop);
  const last = await page.evaluate(() => window.qa.patches.at(-1));
  assert.equal(last[0].type, "clip.crop");
  checks.push("Recorte real: 25 eventos, un comando al soltar, sin guardar layout adicional");

  const beforeDepth = await page.evaluate(() => window.qa.patches.length);
  const depth = page.getByLabel("Profundidad visual de Video de prueba", {exact:true});
  await depth.fill("3"); await depth.press("Enter"); await depth.blur();
  await page.waitForFunction(previous => window.qa.patches.length === previous + 1, beforeDepth);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.qa.patches.length), beforeDepth + 1);
  checks.push("Profundidad: Enter más blur sin duplicar versión");

  const colorBefore = await page.evaluate(() => window.qa.patches.length);
  await page.getByLabel("Brillo (exposición), valor", {exact:true}).fill("20");
  await page.getByLabel("Brillo (exposición), valor", {exact:true}).blur();
  await page.waitForFunction(previous => window.qa.patches.length === previous + 1, colorBefore);
  assert.equal(await page.evaluate(() => window.qa.patches.at(-1)[0].type), "clip.color-grading");
  checks.push("Corrección de color real: un comando propio");

  const htmlText = page.locator('#html input[type="text"]').first();
  await htmlText.fill("HTML actualizado"); await htmlText.blur();
  await page.waitForFunction(() => window.qa.htmlCalls.length === 1);
  assert.equal(await page.evaluate(() => window.qa.htmlCalls[0][0].value), "HTML actualizado");
  checks.push("Campo HTML real: validación y commit por el puerto editorial, sin preparar/guardar");

  await page.getByLabel("Texto de prueba").fill("conservar al cerrar");
  await page.getByRole("button", {name:"Cerrar prueba"}).click();
  await page.waitForFunction(() => window.qa.calls.includes("conservar al cerrar"));
  checks.push("Cerrar un panel conserva y completa su cambio pendiente");

  assert.deepEqual(failures, []);
  await page.screenshot({ path: path.join(output, "inspector.png"), fullPage: true });
  await writeFile(path.join(output, "result.json"), JSON.stringify({ checks, errors: failures }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally { await browser.close(); }
