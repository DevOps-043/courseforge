import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const runtimeModules = process.argv[2];
const { chromium } = runtimeModules
  ? await import(pathToFileURL(path.join(runtimeModules, "playwright/index.mjs")).href)
  : await import("playwright");
const webRoot = path.resolve(import.meta.dirname, "../..");
const { createInitialCompositionDocument } = await import(pathToFileURL(path.join(webRoot, ".tmp/hyperframes-tests/domains/production/composition-editor/composition-document.factory.js")).href);
const { reconcileProductionIntroDocument } = await import(pathToFileURL(path.join(webRoot, ".tmp/hyperframes-tests/domains/production/composition-editor/composition-production-intro.service.js")).href);
const base = createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: "a".repeat(64), durationSeconds: 12, fileSizeBytes: 1, mimeType: "video/mp4", productionAssetId: "11111111-1111-4111-8111-111111111111", publicUrl: null, storageBucket: "production-assets", storagePath: "content.mp4", timelineRole: "AVATAR" }], plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Branding" } });
const productionIntro = reconcileProductionIntroDocument(base, { durationSeconds: 3, hasAudio: true, id: "44444444-4444-4444-8444-444444444444", label: "Apertura de Producción", mimeType: "video/mp4" });
const bundle = await build({
  stdin: { resolveDir: webRoot, loader: "tsx", contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CompositionTimelineWorkspace} from './src/domains/materials/components/composition-editor/CompositionTimelineWorkspace';
import {CompositionInspector} from './src/domains/materials/components/composition-editor/CompositionInspector';
import {reconcileAssemblyBrandingDocument} from './src/domains/production/composition-editor/composition-branding.service';
import {applyCompositionEditorPatches} from './src/domains/production/composition-editor/editor-patch.service';
const base = ${JSON.stringify(base)};
const asset=(id,kind)=>({id,kind,checksum:'b'.repeat(64),durationMilliseconds:3000,hasAudio:true,mimeType:'video/mp4',name:kind,sourceHeight:1080,sourceWidth:1920,storageBucket:'production-assets',storagePath:'branding.mp4'});
const branding={intro:asset('22222222-2222-4222-8222-222222222222','INTRO'),outro:asset('33333333-3333-4333-8333-333333333333','OUTRO'),introSource:'ORG_DEFAULT'};
const noop=()=>{};
const handlers=Object.fromEntries(['onAnimationSelect','onAnimationTimingChange','onAudioMixUpdate','onClearSelection','onDurationChange','onEditingGroupChange','onInspectSelection','onMove','onMoveGroup','onRoll','onOrganize','onOutroChange','onRecalculateDuration','onRecoverHistoricalAssets','onRefreshProductionAssets','onSlide','onSelectedGroupChange','onTrackUpdate','onTransitionSelect','onTrim'].map(name=>[name,noop]));
window.qa={doc:null,selected:[],seconds:0};
function Demo(){
 const [doc,setDoc]=useState(()=>reconcileAssemblyBrandingDocument(base,branding));
 const [hfId,setHfId]=useState(null), [ids,setIds]=useState(new Set()), [seconds,setSeconds]=useState(0);
 const clip=doc.clips.find(clip=>clip.hfId===hfId)||null;
 window.qa={doc,selected:[...ids],seconds};
 const patch=async(operations)=>{setDoc(current=>applyCompositionEditorPatches(current,operations));return true;};
 return <><CompositionTimelineWorkspace {...handlers} assetLabels={{}} assets={[]} brandingAvailability={null} currentTime={seconds} componentId={null} document={doc} durationSourceLabel='Prueba' editingGroupId={null} estimatedClipCount={0} onSeek={setSeconds} onSelect={setHfId} onSelectedClipIdsChange={setIds} recoveringHistoricalAssets={false} refreshingProductionAssets={false} saving={false} selectedAnimationId={null} selectedClipIds={ids} selectedGroupId={null} selectedHfId={hfId} selectedTransitionId={null} snapEnabled={false} trimToolEnabled={false}/>
 <aside><CompositionInspector animations={doc.motion.animations.filter(animation=>animation.target.clipId===clip?.id)} clip={clip} componentId='55555555-5555-4555-8555-555555555555' cropModeEnabled={false} colorGradingStatus={null} onAnimationSelect={noop} onDetachAudio={async()=>{}} onPatch={patch} onPreviewCrop={noop} onPreviewColorGrading={noop} onRemove={async()=>{}} saving={false} selectedAnimationId={null} separatingAudio={false} separatingAudioProgress={0} sourcePreviewUrl={null} track={doc.tracks.find(track=>track.id===clip?.trackId)||null}/></aside>
 <button onClick={()=>setDoc(current=>reconcileAssemblyBrandingDocument(current,branding))}>Reaplicar branding</button>
 <button onClick={()=>setDoc(base)}>Retirar branding de prueba</button>
 <button onClick={()=>setDoc(${JSON.stringify(productionIntro)})}>Intro de Producción de prueba</button></>;
}
createRoot(document.getElementById('root')).render(<Demo/>);
` },
  tsconfig: path.join(webRoot, "tsconfig.json"), bundle: true, write: false,
  format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
  logLevel: "silent", plugins: [{ name: "css-del-fixture", setup(builder) {
    builder.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default {};", loader: "js" }));
  } }],
});
const browser = await chromium.launch({ headless: true, channel: process.env.BRANDING_QA_BROWSER_CHANNEL || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.route("https://branding.example.test/**", route => route.fulfill({ contentType: "text/html", body: '<html lang="es"><body><div id="root"></div></body></html>' }));
  await page.goto("https://branding.example.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const placement of ["intro", "outro"]) {
    await page.getByRole("button", { name: `Editar ${placement}`, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.qa.selected), [`assembly-${placement}`]);
    const clip = await page.evaluate(id => window.qa.doc.clips.find(clip => clip.id === id), `assembly-${placement}`);
    assert.equal(await page.evaluate(() => window.qa.seconds), clip.startSeconds);
    assert.equal(await page.getByRole("button", { name: "Separar audio del video", exact: true }).count(), 0);
    await page.getByRole("button", { name: `Enviar ${clip.label} un plano hacia atrás`, exact: true }).click();
    await page.waitForFunction(id => window.qa.doc.clips.find(clip => clip.id === id).layout.zIndex === 9, clip.id);
    await page.getByRole("button", { name: `Traer ${clip.label} un plano hacia delante`, exact: true }).click();
    await page.waitForFunction(id => window.qa.doc.clips.find(clip => clip.id === id).layout.zIndex === 10, clip.id);
    await page.getByRole("button", { name: `Enviar ${clip.label} un plano hacia atrás`, exact: true }).click();
    await page.getByRole("button", { name: /^Aparecer/ }).click();
    await page.waitForFunction(id => window.qa.doc.motion.animations.some(animation => animation.target.clipId === id), clip.id);
  }
  const edited = await page.evaluate(() => window.qa.doc);
  await page.getByRole("button", { name: "Reaplicar branding", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.qa.doc), edited);
  await page.getByRole("button", { name: "Retirar branding de prueba", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^Editar (intro|outro)$/ }).count(), 0);
  await page.getByRole("button", { name: "Intro de Producción de prueba", exact: true }).click();
  await page.getByRole("button", { name: "Editar intro", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.qa.selected), ["production-intro"]);
  assert.equal(await page.getByRole("button", { name: "Separar audio del video", exact: true }).count(), 1);
  await page.getByRole("button", { name: /^Aparecer/ }).click();
  await page.waitForFunction(() => window.qa.doc.motion.animations.some(animation => animation.target.clipId === "production-intro"));
  assert.deepEqual(errors, []);
  console.log("QA aprobada: accesos intro/outro, selección individual, cursor, capas, animación, reaplicación y ausencia de branding. Fixture local sin servidor ni render cloud.");
} finally {
  await browser.close();
}
