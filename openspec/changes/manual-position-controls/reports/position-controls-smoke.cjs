// Ejecutar desde la raíz después de compilar tsconfig.hyperframes-test.json.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { build } = require('esbuild');
const { launchCompositionQaBrowser } = require('../../../../apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/qa/composition-qa-browser.js');

async function main() {
  const domain = '../../../../apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/';
  const {createInitialCompositionDocument} = require(domain + 'composition-document.factory.js');
  const {createCompositionNativeOverlay} = require(domain + 'composition-native-overlay.factory.js');
  const {compileCompositionPreview} = require(domain + 'composition-preview-compiler.service.js');
  const {applyCompositionEditorPatches} = require(domain + 'editor-patch.service.js');
  let document = createInitialCompositionDocument({animatedDeck:null, assets:[{
    checksum:'b'.repeat(64),durationSeconds:4,fileSizeBytes:100,hasAudio:false,mimeType:'video/mp4',
    productionAssetId:'55555555-5555-4555-8555-555555555558',publicUrl:null,
    storageBucket:'production-assets',storagePath:'fixture.mp4',timelineRole:'BROLL',
  }], plan:{accentColor:'#38BDF8',durationSeconds:4,subtitle:'',title:'Posición en tiempo real'}});
  const videoClip = structuredClone(document.clips[0]);
  const deckDocument = createInitialCompositionDocument({animatedDeck:{css:'',fonts:[],width:1920,height:1080,
    slides:[{index:0,label:'Diapositiva',classes:'slide',html:'<section>Prueba</section>',animationCount:0}]},assets:[],
    plan:{accentColor:'#38BDF8',durationSeconds:4,subtitle:'',title:'Inspector'}});
  const inspectorClips = [videoClip, {...videoClip,id:'image-test',hfId:'image-test',kind:'IMAGE',source:{...videoClip.source,hasAudio:false}},
    deckDocument.clips[0], ...['TEXT','CAPTION'].map(kind => createCompositionNativeOverlay({document,id:`inspector-${kind.toLowerCase()}`,kind,playheadSeconds:0}).clip)];
  document.clips=[];
  const overlay=createCompositionNativeOverlay({document,id:'position-target',kind:'TEXT',playheadSeconds:0});
  document=applyCompositionEditorPatches(document,[{type:'clip.add',clipId:overlay.clip.id,clip:overlay.clip,track:overlay.track},{type:'clip.layout',clipId:overlay.clip.id,layout:{x:-100,y:50,width:400,height:200}}]);
  const previewHtml=await compileCompositionPreview({document,documentHash:'a'.repeat(64),assetUrls:new Map()});
  const bundle = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CompositionPositionControls} from '@/domains/materials/components/composition-editor/CompositionPositionControls';
      import {CompositionInspector} from '@/domains/materials/components/composition-editor/CompositionInspector';
      import {CompositionAutosaveBoundary} from '@/domains/materials/components/composition-editor/CompositionAutosaveBoundary';
      import {compositionLayoutSchema} from '@/domains/production/composition-editor/composition-document.types';
      import {useCompositionPositionPreview} from '@/domains/materials/components/composition-editor/useCompositionPositionPreview';
      import {createCompositionPreviewParentCommand} from '@/domains/production/composition-editor/composition-preview-protocol';
      window.commits = [];
      function Harness() {
        const [x, setX] = useState('-100'), [y, setY] = useState('50');
        const [disabled, setDisabled] = useState(false);
        const [hfId, setHfId] = useState('position-target');
        const [width, setWidth] = useState(1920);
        const preview = useCompositionPositionPreview(hfId, disabled, (hfId, position) => {
          const command=createCompositionPreviewParentCommand({type:'courseforge-composition-preview-position',hfId,position});
          if(command) document.querySelector('iframe').contentWindow.postMessage(command, location.origin);
        });
        window.configure = (locked, width) => {setDisabled(locked); setWidth(width);};
        window.selectTarget = setHfId;
        return <CompositionAutosaveBoundary value={{x,y}} disabled={disabled} onCommit={() => {
          if (!x.trim() || !y.trim() || !compositionLayoutSchema.shape.x.safeParse(Number(x)).success || !compositionLayoutSchema.shape.y.safeParse(Number(y)).success) return;
          window.commits.push({x:Number(x), y:Number(y)}); return true;
        }}><CompositionPositionControls canvasWidth={width} canvasHeight={1080} disabled={disabled} x={x} y={y} onXChange={value=>{setX(value);preview("x",value)}} onYChange={value=>{setY(value);preview("y",value)}}/></CompositionAutosaveBoundary>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
      const inspectorRoot = createRoot(document.getElementById('inspector-root'));
      window.inspectorPreviews = []; window.inspectorCommits = [];
      window.mountInspector = (clip, locked = false) => inspectorRoot.render(<CompositionInspector key={clip.id + locked}
        canvasWidth={1920} canvasHeight={1080} animations={[]} clip={clip} componentId={null} cropModeEnabled={false}
        colorGradingStatus={null} onAnimationSelect={()=>{}} onDetachAudio={async()=>{}} onPatch={async operations=>{window.inspectorCommits.push(operations);return true}}
        onPreviewPosition={(hfId,position)=>window.inspectorPreviews.push({hfId,position})} onPreviewMask={()=>{}} onPreviewCrop={()=>{}}
        onPreviewColorGrading={()=>{}} onRemove={async()=>{}} saving={false} selectedAnimationId={null}
        separatingAudio={false} separatingAudioProgress={0} sourcePreviewUrl={null}
        track={{id:clip.trackId,label:'Pista de prueba',kind:clip.kind === 'TEXT' || clip.kind === 'CAPTION' ? 'OVERLAY' : 'VISUAL',semanticRole:'BROLL',locked,order:0}}/>);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    tsconfig: 'apps/web/tsconfig.json', bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: {'process.env':'{}'},
    plugins:[{name:'css-del-inspector-en-fixture',setup(builder){builder.onLoad({filter:/\.module\.css$/},()=>({contents:'export default {};',loader:'js'}))}}],
  });
  console.log('Bundle del componente listo.');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if(request.url === '/preview') {response.end(previewHtml);return;}
    response.end(`<html lang="es"><div id="root"></div><iframe src="/preview" style="width:960px;height:540px"></iframe><div id="inspector-root"></div><script>${bundle.outputFiles[0].text}</script></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    console.log('Iniciando navegador de QA.');
    browser = await launchCompositionQaBrowser({profilePrefix: 'courseforge-position-'});
    console.log('Navegador listo.');
    const evaluate = async expression => {
      const result = await browser.client.send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await browser.client.send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}`});
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 100 && !await evaluate('Boolean(document.querySelector("input"))'); attempt++) await pause(50);
    for (let attempt=0; attempt<200 && !await evaluate('Boolean(document.querySelector("iframe").contentWindow.__timelines?.["courseforge-composition"])'); attempt++) await pause(50);
    assert.equal(await evaluate('Boolean(document.querySelector("iframe").contentWindow.__timelines?.["courseforge-composition"])'),true,'Preview compilado listo');
    await evaluate(`window.previewPosition=()=>{const target=document.querySelector("iframe").contentDocument.querySelector('[data-hf-id="position-target"]');return {x:parseFloat(target.style.left),y:parseFloat(target.style.top)}}`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('input[type=range]')).map(i => [i.value,i.min,i.max])`), [['-100','-1920','1920'],['50','-1080','1080']]);
    await evaluate(`window.change = (selector, value) => { const input = document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); }; document.querySelector('input[type=range]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); change('input[type=range]','240');`);
    await pause(750);
    assert.equal(await evaluate('commits.length'), 0, 'No guardar durante el arrastre');
    assert.deepEqual(await evaluate('previewPosition()'), {x:240,y:50}, 'El monitor se mueve antes de guardar');
    assert.equal(await evaluate(`document.querySelector('input[type=number]').value`), '240');
    await evaluate(`document.querySelector('input[type=range]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));`);
    await pause(100);
    assert.deepEqual(await evaluate('commits'), [{x:240,y:50}]);
    await evaluate(`change('input[type=number]','-320.5')`);
    await pause(750);
    assert.deepEqual(await evaluate('commits.at(-1)'), {x:-320.5,y:50});
    assert.deepEqual(await evaluate('previewPosition()'), {x:-320.5,y:50});
    await evaluate(`change('input[type=number]','9000')`);
    await pause(750);
    assert.equal(await evaluate('commits.length'), 2, 'No guardar posición fuera del esquema');
    await evaluate(`change('input[type=number]','')`);
    await pause(750);
    assert.equal(await evaluate('commits.length'), 2, 'No convertir vacío a cero');
    assert.deepEqual(await evaluate('previewPosition()'), {x:-320.5,y:50},'Inválidos conservan último preview válido');
    await evaluate(`change('input[type=number]','-320.5'); configure(true,1080)`);
    await pause(100);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('input')).every(i=>i.matches(':disabled'))`), true);
    assert.equal(await evaluate(`document.querySelector('input[type=range]').min`), '-1080');
    assert.deepEqual(await evaluate('previewPosition()'), {x:-100,y:50},'Bloquear restaura base canónica');
    await evaluate(`configure(false,1080)`);
    await pause(100);
    await evaluate(`document.querySelectorAll('input[type=range]')[1].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));`);
    // Cambiar Y por su campo mientras el gesto está abierto no debe persistir aún.
    await evaluate(`const field=document.querySelectorAll('input[type=number]')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'180'); field.dispatchEvent(new Event('input',{bubbles:true}));`);
    await pause(100);
    assert.deepEqual(await evaluate('previewPosition()'), {x:-100,y:180},'Y también se refleja durante la interacción');
    await evaluate(`selectTarget(null)`);
    await pause(100);
    assert.deepEqual(await evaluate('previewPosition()'), {x:-100,y:50},'Cambiar selección retira preview anterior');
    console.log('PASS: movimiento X/Y en iframe antes del guardado, limpieza por selección/bloqueo, negativos, sincronización, guardado al soltar, precisión decimal, entradas inválidas y formato.');
    for (const clip of inspectorClips) {
      await evaluate(`mountInspector(${JSON.stringify(clip)})`); await pause(150);
      assert.equal(await evaluate(`document.querySelectorAll('#inspector-root input[aria-label="Posición X, deslizador"]').length`),1,clip.kind);
      assert.equal(await evaluate(`document.querySelectorAll('#inspector-root input[aria-label="Posición X (px)"]').length`),1,clip.kind);
      assert.equal(await evaluate(`document.querySelector('#inspector-root fieldset').textContent.includes('Horizontal (X)')`),true,clip.kind);
      assert.equal(await evaluate(`document.querySelector('#inspector-root fieldset').compareDocumentPosition([...document.querySelectorAll('#inspector-root label')].find(label=>label.textContent.includes('Inicio (mm:ss)'))) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false`),true,clip.kind);
      const before = await evaluate('inspectorCommits.length');
      await evaluate(`document.querySelector('#inspector-root input[aria-label="Posición X, deslizador"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));change('#inspector-root input[aria-label="Posición X, deslizador"]','333');`);
      await pause(750);
      assert.equal(await evaluate('inspectorPreviews.at(-1).position.x'),333,`${clip.kind}: preview inmediato`);
      assert.equal(await evaluate('inspectorCommits.length'),before,`${clip.kind}: sin guardado durante gesto`);
      await evaluate(`document.querySelector('#inspector-root input[aria-label="Posición X, deslizador"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));`);
      await pause(150);
      assert.equal(await evaluate('inspectorCommits.at(-1).some(op=>op.type==="clip.layout" && op.layout.x===333)'),true,clip.kind);
      await evaluate(`mountInspector(${JSON.stringify(clip)},true)`); await pause(100);
      assert.equal(await evaluate(`document.querySelector('#inspector-root input[aria-label="Posición X, deslizador"]').matches(':disabled')`),true,clip.kind);
    }
    console.log('PASS: inspector completo VIDEO/IMAGE/DECK_SLIDE/TEXT/CAPTION con selector horizontal único antes de tiempo/audio, preview antes del guardado, commit al soltar y bloqueo de pista.');
  } finally {
    console.log('Cerrando QA.');
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error); process.exitCode=1;});
