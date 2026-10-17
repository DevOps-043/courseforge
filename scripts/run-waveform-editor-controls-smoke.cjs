// Real React controls in a local browser; API fixtures never access tenant data.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { build } = require('esbuild');
const puppeteer = createRequire(resolve('apps/web/tools/controlled-hyperframes/package.json'))('puppeteer');

async function main() {
  const requests = [];
  let analyzed = false;
  const component = '00000000-0000-4000-8000-000000000002';
  const asset = '00000000-0000-4000-8000-000000000003';
  const job = '00000000-0000-4000-8000-000000000004';
  const waveform = { checksum: 'b'.repeat(64), bucketSizeSamples: 1, durationSeconds: 10, sampleRateHz: 1,
    min: [-0.1,-0.2,-0.5,-1,-0.6,-0.5,-0.4,-0.3,-0.2,-0.1], max: [0.1,0.2,0.5,1,0.6,0.5,0.4,0.3,0.2,0.1] };
  waveform.channels = [{ min: waveform.min, max: waveform.max }, { min: waveform.min, max: waveform.max }];
  const sourceRoot = resolve('apps/web/src/domains/materials/components/composition-editor').replaceAll('\\', '/');
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NEXT_PUBLIC_COMPOSITION_VOLUME_ENVELOPE_ENABLED': '"true"' },
    tsconfig: resolve('apps/web/tsconfig.json'), stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {useCompositionWaveforms} from '${sourceRoot}/useCompositionWaveforms';
      import {CompositionClipWaveform} from '${sourceRoot}/CompositionClipWaveform';
      import {CompositionVolumeEnvelopeControls} from '${sourceRoot}/CompositionVolumeEnvelopeControls';
      const assets=[{id:'${asset}',mimeType:'video/mp4',valid:true,hasAudio:true}];
      const initial={id:'clip',hfId:'clip',kind:'VIDEO',trackId:'avatar',startSeconds:0,durationSeconds:10,sourceOffsetSeconds:0,source:{type:'PRODUCTION_ASSET',productionAssetId:'${asset}',hasAudio:true}};
      function App(){ const [clip,setClip]=useState(initial);const [width,setWidth]=useState(320);const [locked,setLocked]=useState(false);
        const {waveforms,pendingAssetIds,failedAssetIds}=useCompositionWaveforms('${component}',assets,{clips:[clip]});
        window.setLocked=setLocked;window.patches=window.patches||[];
        return <main><div id='pending'>{pendingAssetIds.length}</div><div id='failed'>{failedAssetIds.length}</div>
          <button id='zoom' onClick={()=>setWidth(640)}>Zoom</button><button id='trim' onClick={()=>setClip(c=>({...c,sourceOffsetSeconds:2,durationSeconds:8}))}>Trim</button>
          <div id='viewport' data-composition-timeline-viewport style={{width:320,overflowX:'auto'}}><div id='wave' style={{position:'relative',width,height:80}}>{waveforms['${asset}']&&<CompositionClipWaveform componentId='${component}' assetId='${asset}' clipDurationSeconds={clip.durationSeconds} sourceOffsetSeconds={clip.sourceOffsetSeconds} envelope={clip.volumeEnvelope} waveform={waveforms['${asset}']}/>}</div></div>
          <CompositionVolumeEnvelopeControls clip={clip} disabled={locked} onPatch={async(operations)=>{window.patches.push(operations);setClip(c=>({...c,volumeEnvelope:operations[0].points}));return true;}}/>
        </main>;
      }createRoot(document.getElementById('root')).render(<App/>);` } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (url.pathname.startsWith('/api/')) {
      requests.push({ method: request.method, query: Object.fromEntries(url.searchParams) });
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST') { analyzed = true; response.statusCode = 202; response.end(JSON.stringify({ data: { jobId: job } })); return; }
      if (!analyzed) { response.statusCode = 404; response.end('{}'); return; }
      response.end(JSON.stringify({ data: waveform })); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<html><head><style>#wave>span{position:absolute;inset:0}#wave svg{width:100%;height:100%}button[aria-label="Añadir punto a la curva de volumen"]{width:320px;height:100px;display:block}button[aria-label="Añadir punto a la curva de volumen"] svg{width:100%;height:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  let browser;
  try {
    const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    if (!chrome) throw new Error('Chrome required for waveform controls smoke.');
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'], timeout: 20000 });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('#wave svg path');
    await page.waitForFunction(() => document.querySelector('#pending').textContent === '0');
    assert.ok(requests.some((request) => request.method === 'POST'));
    assert.ok(requests.some((request) => request.query.jobId === job));
    assert.equal(await page.$$eval('#wave svg g', (groups) => groups.length), 2);
    await page.click('#zoom');
    await page.waitForFunction(() => document.querySelector('#wave').clientWidth === 640);
    await new Promise((done) => setTimeout(done, 400));
    assert.ok(requests.some((request) => request.query.end === '5' && request.query.width === '320'));
    await page.evaluate(() => { document.querySelector('#viewport').scrollLeft = 160; });
    await new Promise((done) => setTimeout(done, 400));
    assert.ok(requests.some((request) => request.query.start === '2.5'));
    await page.click('#trim');
    await new Promise((done) => setTimeout(done, 400));
    assert.ok(requests.some((request) => request.query.start === '4' && request.query.width === '320'));
    await page.click('button[aria-label="Añadir punto a la curva de volumen"]');
    await page.waitForSelector('input[aria-label="Nivel del punto 1 en decibelios"]');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Guardar curva').click());
    await page.waitForFunction(() => window.patches.length === 1);
    const operation = await page.evaluate(() => window.patches[0][0]);
    assert.equal(operation.type, 'clip.volume-envelope'); assert.equal(operation.points.length, 1);
    assert.ok(operation.points[0].sourceTimeSeconds >= 2 && operation.points[0].sourceTimeSeconds <= 10);
    assert.ok(Math.abs(operation.points[0].gain - 0.5) < 0.05);
    await page.evaluate(() => window.setLocked(true));
    await page.waitForFunction(() => document.querySelector('button[aria-label="Añadir punto a la curva de volumen"]').disabled);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ analysisQueued: true, jobPolling: true, stereo: true, visibleWindowZoomScrollAndTrim: true, persistedCurve: true, lockedControls: true }));
  } finally { if (browser) await browser.close(); await new Promise((done) => server.close(done)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
