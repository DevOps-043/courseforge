import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { RenderInternals } from "@remotion/renderer";
import sharp from "sharp";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildCompositionPreviewScenePatch } from "../composition-preview-scene-patch";
import { launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";

const assetId = "55555555-5555-4555-8555-555555555558";
const documentHash = "a".repeat(64);

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return (result.result as { value: T }).value;
}

async function main() {
  const output = resolve(process.cwd(), ".tmp/composition-video-loop-qa");
  await mkdir(output, { recursive: true });
  for (let frame = 0; frame < 20; frame += 1) {
    await sharp({ create: { width: 160, height: 90, channels: 3, background: frame < 10 ? "#ff0000" : "#00ff00" } })
      .png().toFile(resolve(output, `frame-${String(frame).padStart(2, "0")}.png`));
  }
  const videoPath = resolve(output, "video.mp4");
  const ffmpeg = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  await promisify(execFile)(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "10", "-i",
    resolve(output, "frame-%02d.png"), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-movflags", "+faststart", videoPath],
  { timeout: 20_000, windowsHide: true });
  const videoBytes = await readFile(videoPath);
  let html = "";
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.url !== "/video.mp4") {
      response.setHeader("Content-Type", "text/html"); response.end(html); return;
    }
    response.setHeader("Content-Type", "video/mp4");
    response.setHeader("Accept-Ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1;
    if (start > end || start >= videoBytes.length) { response.writeHead(416).end(); return; }
    if (range) { response.statusCode = 206; response.setHeader("Content-Range", `bytes ${start}-${end}/${videoBytes.length}`); }
    response.setHeader("Content-Length", end - start + 1);
    response.end(videoBytes.subarray(start, end + 1));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let browser: Awaited<ReturnType<typeof launchCompositionQaBrowser>> | undefined;
  try {
    const before = createInitialCompositionDocument({ animatedDeck: null,
      assets: [{ checksum: "b".repeat(64), durationSeconds: 2, fileSizeBytes: videoBytes.length, hasAudio: false, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "qa-loop.mp4", timelineRole: "BROLL" }],
      plan: { accentColor: "#38BDF8", durationSeconds: 6, subtitle: "", title: "Prueba de bucle" } });
    before.canvas.durationSeconds = 6;
    const document = applyCompositionEditorPatches(before, [{ type: "clip.duration", clipId: before.clips[0]!.id, durationSeconds: 6 }]);
    const assetUrls = new Map([[assetId, `${origin}/video.mp4`]]);
    const scene = buildCompositionPreviewScenePatch({ beforeDocument: before, document, assetUrls, audioMetersEnabled: false });
    assert.ok(scene);
    html = await compileCompositionPreview({ document: before, documentHash, assetUrls });
    browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-video-loop-" });
    const client = browser.client;
    await client.send("Page.navigate", { url: origin });
    await evaluate(client, `new Promise((resolve,reject)=>{
      const deadline=Date.now()+10000;const poll=()=>{
        if(document.getElementById('composition-root')?.dataset.previewReady==='true' && document.querySelector('video')?.readyState>=2)resolve(true);
        else if(Date.now()>deadline)reject(new Error('PREVIEW_READY_TIMEOUT'));else setTimeout(poll,50);
      };poll();})`);
    const patch = { type: "courseforge-composition-visual-patch", baseDocumentHash: documentHash, sequence: 1, protocolVersion: 1, patch: { changes: [], scene } };
    const ack = await evaluate<{ applied: boolean }>(client, `new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('PATCH_TIMEOUT')),3000);
      const listener=e=>{if(e.data?.type!=='courseforge-composition-visual-patch-result'||e.data.sequence!==1)return;
        removeEventListener('message',listener);clearTimeout(timer);resolve(e.data)};
      addEventListener('message',listener);postMessage(${JSON.stringify(patch)},'*');})`);
    assert.equal(ack.applied, true);
    const samples = [];
    for (const time of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
      const sample = await evaluate<{ source: number; pixel: number[] }>(client, `new Promise(resolve=>{
        postMessage({type:'courseforge-composition-seek',seconds:${time},protocolVersion:1},'*');
        setTimeout(()=>{const v=document.querySelector('video');const c=document.createElement('canvas');c.width=c.height=1;
          const ctx=c.getContext('2d');ctx.drawImage(v,0,0,1,1);resolve({source:v.currentTime,pixel:[...ctx.getImageData(0,0,1,1).data]})},250);})`);
      assert.ok(Math.abs(sample.source - time % 2) < 0.06, `Tiempo fuente incorrecto en ${time}s.`);
      assert.ok(time % 2 < 1 ? sample.pixel[0]! > 150 && sample.pixel[1]! < 80 : sample.pixel[1]! > 150 && sample.pixel[0]! < 80,
        `Fotograma incorrecto en ${time}s.`);
      samples.push({ time, ...sample });
    }
    const playback = await evaluate<{ time: number; source: number; paused: boolean }[]>(client, `new Promise((resolve,reject)=>{
      let time=0;const points=[];const listener=e=>{if(e.data?.type==='courseforge-composition-time')time=e.data.seconds};
      addEventListener('message',listener);
      postMessage({type:'courseforge-composition-seek',seconds:0},'*');postMessage({type:'courseforge-composition-play'},'*');
      const deadline=Date.now()+15000;const timer=setInterval(()=>{
        const v=document.querySelector('video');points.push({time,source:v.currentTime,paused:v.paused});
        if(time>=5.4||Date.now()>deadline){clearInterval(timer);removeEventListener('message',listener);
          if(time<5.4)reject(new Error('El video quedó detenido antes del tercer ciclo.'));else resolve(points)}
      },150);})`);
    for (const cycle of [1, 2]) {
      const points = playback.filter((point) => point.time >= cycle * 2 + 0.2 && point.time < cycle * 2 + 1.4);
      assert.ok(points.length >= 2 && points.some((point) => !point.paused), `El ciclo ${cycle + 1} debe reproducirse.`);
      assert.ok(points.some((point) => point.source < 1.5), "Debe volver al inicio, sin sostener el último fotograma.");
    }
    const report = { liveExtension: { sourceSeconds: 2, clipSeconds: 6 }, samples, playback };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Bucle validado: extensión en vivo, seis fotogramas y tres ciclos; ${playback.length} muestras.`);
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
