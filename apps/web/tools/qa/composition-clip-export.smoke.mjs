import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(import.meta.dirname, "../..");
const outputDirectory = path.join(webRoot, ".tmp/clip-export-qa");
await mkdir(outputDirectory, { recursive: true });
const downloadDirectory = await mkdtemp(path.join(outputDirectory, "download-"));
const compiledDomain = path.join(webRoot, ".tmp/hyperframes-tests/domains/production/composition-editor");
const { createInitialCompositionDocument } = await import(pathToFileURL(path.join(compiledDomain, "composition-document.factory.js")).href);
const { applyCompositionEditorPatches } = await import(pathToFileURL(path.join(compiledDomain, "editor-patch.service.js")).href);
const baseDocument = createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: "a".repeat(64), durationSeconds: 4, fileSizeBytes: 42,
  hasAudio: true, mimeType: "video/mp4", productionAssetId: "11111111-1111-4111-8111-111111111111", publicUrl: null,
  storageBucket: "production-assets", storagePath: "fixture.mp4", timelineRole: "BROLL" }],
  plan: { accentColor: "#38BDF8", durationSeconds: 4, subtitle: "", title: "Recorte" } });
const cases = [["inicio", 0, 2], ["centro", 1, 2], ["final", 2, 4]].map(([label, start, end]) => ({ label,
  document: applyCompositionEditorPatches(baseDocument, [{ type: "clip.remove-range", clipId: baseDocument.clips[0].id,
    startSeconds: start, endSeconds: end, ripple: true, newClipId: "right", newHfId: "right-hf" }]) }));
const fractionalDocument = structuredClone(baseDocument);
const fractionalClip = fractionalDocument.clips[0];
fractionalClip.durationSeconds = 3.99;
fractionalClip.sourceDurationSeconds = 3.99;
cases.push({ label: "fin entre fotogramas", document: applyCompositionEditorPatches(fractionalDocument, [{
  type: "clip.remove-range", clipId: fractionalClip.id, startSeconds: 0, endSeconds: 2, ripple: true,
}]) });
const source = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Input, ALL_FORMATS, BlobSource, BufferTarget, Output, Mp4OutputFormat, VideoSampleSource, AudioSampleSource, VideoSample, AudioSample, CanvasSink} from 'mediabunny';
import {exportCompositionClip} from './src/domains/production/composition-editor/composition-clip-export.client';
import {buildCompositionClipExportPlan} from './src/domains/production/composition-editor/composition-clip-export-plan';
import {CompositionClipIntervalControls} from './src/domains/materials/components/composition-editor/CompositionClipIntervalControls';
const base=()=>(${JSON.stringify(baseDocument)});
const cases=${JSON.stringify(cases)};
window.qa={};
async function createSource() {
 const target=new BufferTarget(), out=new Output({target,format:new Mp4OutputFormat({fastStart:'in-memory'})});
 const video=new VideoSampleSource({codec:'avc',bitrate:400000}), audio=new AudioSampleSource({codec:'aac',bitrate:128000});
 out.addVideoTrack(video,{frameRate:30}); out.addAudioTrack(audio); await out.start();
 const canvas=new OffscreenCanvas(160,90), ctx=canvas.getContext('2d');
 const videoWork=(async()=>{for(let frame=0;frame<120;frame++) { ctx.fillStyle=frame<60?'#ff0000':'#00ff00';ctx.fillRect(0,0,160,90);
  const sample=new VideoSample(canvas,{timestamp:frame/30,duration:1/30});try{await video.add(sample);}finally{sample.close();} }video.close();})();
 const pcm=Float32Array.from({length:192000},(_,i)=>0.2*Math.sin(2*Math.PI*440*i/48000));
 const sample=new AudioSample({data:pcm,format:'f32',numberOfChannels:1,sampleRate:48000,timestamp:0});
 try{await audio.add(sample);}finally{sample.close();}audio.close();await videoWork;await out.finalize();
 return new Blob([target.buffer],{type:'video/mp4'});
}
window.qa.ready=(async()=>{
 window.qa.source=await createSource();window.qa.sourceUrl=URL.createObjectURL(window.qa.source);
 function Demo(){const [doc,setDoc]=useState(base());const clip=doc.clips.at(-1);window.qa.doc=doc;
  return <CompositionClipIntervalControls key={clip.id+':'+clip.durationSeconds+':'+clip.sourceOffsetSeconds} clip={clip} disabled={false}
   onPrepareExport={async()=>({clip,sourceUrl:window.qa.sourceUrl})}
   onRemoveInterval={async(startSeconds,endSeconds)=>{window.qa.received=[startSeconds,endSeconds];setDoc(cases.find(item=>item.label==='centro').document);return true;}}/>;}
 createRoot(document.getElementById('root')).render(<Demo/>);return true;
})();
window.qa.run=async()=>{
 await window.qa.ready;const results=[];
 for(const {label,document:cut} of cases){
  for(const part of cut.clips){const plan=buildCompositionClipExportPlan(part), file=await exportCompositionClip({plan,sourceUrl:window.qa.sourceUrl,signal:new AbortController().signal,onProgress:()=>{}});
   const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});try{const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
    const first=await new CanvasSink(video).getCanvas(0);const color=Array.from(first.canvas.getContext('2d').getImageData(80,45,1,1).data);
    results.push({label,start:plan.start,expected:part.durationSeconds,duration:await input.computeDuration(),hasVideo:!!video,hasAudio:!!audio,color,size:file.size});
    window.qa.lastFile=file;
   }finally{input.dispose();}}
 }
 const clip={...base().clips[0],kind:'AUDIO',sourceOffsetSeconds:1,durationSeconds:1};
 const wav=await exportCompositionClip({plan:buildCompositionClipExportPlan(clip),sourceUrl:window.qa.sourceUrl,signal:new AbortController().signal,onProgress:()=>{}});
 const input=new Input({source:new BlobSource(wav),formats:ALL_FORMATS});try{results.push({label:'audio',duration:await input.computeDuration(),hasVideo:!!await input.getPrimaryVideoTrack(),hasAudio:!!await input.getPrimaryAudioTrack(),size:wav.size});}finally{input.dispose();}
 const abort=new AbortController();abort.abort();try{await exportCompositionClip({plan:buildCompositionClipExportPlan(base().clips[0]),sourceUrl:window.qa.sourceUrl,signal:abort.signal,onProgress:()=>{}});throw new Error('No canceló');}catch(error){if(error.name!=='AbortError')throw error;}
 const during=new AbortController();let cancelledDuring=false;
 try{await exportCompositionClip({plan:buildCompositionClipExportPlan(base().clips[0]),sourceUrl:window.qa.sourceUrl,signal:during.signal,onProgress:()=>during.abort()});}
 catch{cancelledDuring=during.signal.aborted;}if(!cancelledDuring)throw new Error('La conversión no se canceló durante el procesamiento');
 const configure=VideoEncoder.prototype.configure;let codecRejected=false;
 try{VideoEncoder.prototype.configure=function(){throw new Error('CODEC_NO_DISPONIBLE_EN_PRUEBA');};await exportCompositionClip({plan:buildCompositionClipExportPlan(base().clips[0]),sourceUrl:window.qa.sourceUrl,signal:new AbortController().signal,onProgress:()=>{}});}
 catch{codecRejected=true;}finally{VideoEncoder.prototype.configure=configure;}
 if(!codecRejected)throw new Error('Se descartó video sin informar un códec incompatible');
 return results;
};
`;
const bundle = await build({ stdin: { contents: source, loader: "tsx", resolveDir: webRoot },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(webRoot, "tsconfig.json") });
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].contents); }
  else { response.setHeader("Content-Type", "text/html"); response.end('<html lang="es"><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script></html>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { launchCompositionQaBrowser } = await import(pathToFileURL(path.join(webRoot, ".tmp/hyperframes-tests/domains/production/composition-editor/qa/composition-qa-browser.js")).href);
let browser;
try {
  console.log("QA: abriendo Chromium aislado.");
  browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-clip-export-" });
  console.log("QA: Chromium disponible.");
  const evaluate = async expression => {
    const result = await browser.client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await browser.client.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
  const deadline = Date.now() + 15_000;
  while (!await evaluate("Boolean(window.qa?.ready)")) {
    if (Date.now() > deadline) throw new Error("El fixture no cargó.");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const results = await evaluate("window.qa.run()");
  console.log("QA: archivos multimedia convertidos.");
  for (const result of results) {
    assert.ok(result.size > 100);
    assert.equal(result.hasAudio, true);
    assert.ok(Math.abs(result.duration - (result.expected ?? 1)) < 0.08, JSON.stringify(result));
    assert.equal(result.hasVideo, result.label !== "audio");
    if (result.color) assert.ok(result.start >= 2 ? result.color[1] > 220 && result.color[0] < 30 : result.color[0] > 220 && result.color[1] < 30, JSON.stringify(result));
  }
  await evaluate(`(()=>{const set=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set('Inicio del intervalo','00:01');set('Fin del intervalo','00:02');return true;})()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Eliminar intervalo del clip').click();true`);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await evaluate("window.qa.doc.clips.length"), 2);
  assert.deepEqual(await evaluate("window.qa.received"), [1, 2]);
  assert.equal(await evaluate("window.qa.doc.clips.at(-1).sourceOffsetSeconds"), 2);
  await browser.client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory });
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Descargar clip recortado').click();true`);
  const downloadDeadline = Date.now() + 15_000;
  while (!await evaluate(`Array.from(document.querySelectorAll('[role="status"]')).some(element=>element.textContent.includes('Descarga preparada:'))`)) {
    const error = await evaluate(`document.querySelector('[role="alert"]')?.textContent`);
    if (error) throw new Error(error);
    if (Date.now() > downloadDeadline) throw new Error("El botón no completó la exportación.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const downloadedName = await evaluate(`document.querySelector('[role="status"]').textContent.replace('Descarga preparada: ', '')`);
  let downloaded;
  while (!downloaded) {
    downloaded = await readFile(path.join(downloadDirectory, downloadedName)).catch(() => null);
    if (Date.now() > downloadDeadline) throw new Error("La descarga no creó el archivo.");
    if (!downloaded) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(downloaded.byteLength > 100);
  await browser.client.send("Page.captureScreenshot", { format: "png" }).then(result => writeFile(path.join(outputDirectory, "interval-controls.png"), Buffer.from(result.data, "base64")));
  const report = { results, ui: "Intervalo central aplicado desde controles React", download: { fileName: downloadedName, path: path.join(downloadDirectory, downloadedName), bytes: downloaded.byteLength }, cancellation: "Cancelación antes y durante la conversión observada", incompatibleCodec: "Fallo de codificador inducido: rechazo sin archivo parcial" };
  await writeFile(path.join(outputDirectory, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
