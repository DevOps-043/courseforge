// Desde raíz tras compilar tsconfig.hyperframes-test.json. Sólo fixtures y servidor local.
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {build}=require('esbuild');
const root='../../../../apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/';
const {createInitialCompositionDocument}=require(root+'composition-document.factory.js');
const {createCompositionNativeOverlay}=require(root+'composition-native-overlay.factory.js');
const {applyCompositionEditorPatches}=require(root+'editor-patch.service.js');
const {compileCompositionPreview}=require(root+'composition-preview-compiler.service.js');
const {buildCompositionPreviewScenePatch}=require(root+'composition-preview-scene-patch.js');
const {launchCompositionQaBrowser}=require(root+'qa/composition-qa-browser.js');

async function main(){
  let document=createInitialCompositionDocument({animatedDeck:{css:'',fonts:[],height:1080,width:1920,
    slides:[{animationCount:0,classes:'slide',html:'<p>Referencia</p>',index:0,label:'Ejemplo'}]},assets:[],
    plan:{accentColor:'#38BDF8',durationSeconds:8,subtitle:'',title:'Guías editoriales'}});
  document.clips=[];
  const overlay=createCompositionNativeOverlay({document,id:'guide-target',kind:'TEXT',playheadSeconds:0});
  document=applyCompositionEditorPatches(document,[{type:'clip.add',clipId:overlay.clip.id,clip:overlay.clip,track:overlay.track},
    {type:'clip.layout',clipId:overlay.clip.id,layout:{x:100,y:100,width:200,height:100}}]);
  const preview=await compileCompositionPreview({document,documentHash:'a'.repeat(64),assetUrls:new Map(),previewGeneration:1});
  const portrait=applyCompositionEditorPatches(document,[{type:'composition.canvas-size',width:1080,height:1920}]);
  const scene=buildCompositionPreviewScenePatch({beforeDocument:document,document:portrait,assetUrls:new Map(),audioMetersEnabled:false});
  assert.ok(scene);
  const bundle=await build({stdin:{contents:`
    import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {CompositionReferenceGuidesPanel} from '@/domains/materials/components/composition-editor/CompositionReferenceGuidesPanel';
    import {useCompositionReferenceGuides} from '@/domains/materials/components/composition-editor/useCompositionReferenceGuides';
    import {createCompositionPreviewParentCommand,parseCompositionPreviewIframeMessage} from '@/domains/production/composition-editor/composition-preview-protocol';
    function Harness(){
      const {state,setState,storageError}=useCompositionReferenceGuides('qa-draft');const [ready,setReady]=useState(false);
      const [canvas,setCanvas]=useState({width:1920,height:1080});
      window.changeFormat=()=>{setCanvas({width:1080,height:1920});document.querySelector('iframe').contentWindow.postMessage(createCompositionPreviewParentCommand({type:'courseforge-composition-visual-patch',baseDocumentHash:'${'a'.repeat(64)}',sequence:1,patch:{changes:[],scene:${JSON.stringify(scene)}}}),location.origin);};
      window.guides=state;window.clipCommits=[];
      useEffect(()=>{const timer=setInterval(()=>{if(document.querySelector('iframe')?.contentWindow.__timelines?.['courseforge-composition'])setReady(true);},50);return()=>clearInterval(timer);},[]);
      useEffect(()=>{const receive=event=>{if(event.source!==document.querySelector('iframe').contentWindow)return;
        const message=parseCompositionPreviewIframeMessage(event.data);if(!message)return;
        if(message.type==='courseforge-composition-ready')setReady(true);
        if(message.type==='courseforge-composition-guide-move')setState(current=>({...current,guides:current.guides.map(guide=>guide.id===message.id?{...guide,ratio:message.ratio}:guide)}));
        if(message.type==='courseforge-composition-layout-commit')window.clipCommits.push(message);
      };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
      useEffect(()=>{if(ready)document.querySelector('iframe').contentWindow.postMessage(createCompositionPreviewParentCommand({type:'courseforge-composition-editor-guides',state}),location.origin);},[state,ready]);
      return <CompositionReferenceGuidesPanel state={state} canvas={canvas} onChange={setState} storageError={storageError} onClose={()=>{}}/>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `,resolveDir:process.cwd(),loader:'tsx'},tsconfig:'apps/web/tsconfig.json',bundle:true,write:false,platform:'browser',jsx:'automatic'});
  const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(request.url==='/preview'?preview:
    `<html lang="es"><div id="root"></div><iframe src="/preview" style="width:960px;height:540px"></iframe><script>${bundle.outputFiles[0].text}</script></html>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await launchCompositionQaBrowser({profilePrefix:'courseforge-guides-'});
    await browser.client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
    const evaluate=async expression=>{const result=await browser.client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const url=`http://127.0.0.1:${server.address().port}`;
    const waitReady=async()=>{for(let i=0;i<200&&!await evaluate('Boolean(document.querySelector("iframe")?.contentWindow.__timelines?.["courseforge-composition"]&&document.querySelector("section"))');i++)await pause(50);await pause(100);};
    const initialize=()=>evaluate(`window.frame=()=>document.querySelector('iframe');window.doc=()=>frame().contentDocument;
      window.guideNodes=()=>Array.from(doc().querySelectorAll('.composition-reference-guide'));
      window.input=(label,value)=>{const input=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};`);
    await browser.client.send('Page.navigate',{url});await waitReady();await initialize();
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Añadir vertical').click();`);await pause(100);
    await evaluate(`input('Posición de guía 1 en píxeles','600')`);await pause(100);
    assert.equal(await evaluate('guideNodes().length'),1);
    assert.equal(await evaluate('guides.guides[0].ratio'),600/1920);
    await evaluate(`input('Color de guía 1','#ff00ff')`);await pause(100);
    assert.match(await evaluate('guideNodes()[0].firstElementChild.style.borderLeft'),/rgb\(255, 0, 255\)/);
    await evaluate(`frame().contentWindow.postMessage({type:'courseforge-composition-editor-guides',protocolVersion:1,state:{visible:true,guides:[{...guides.guides[0],color:'url(https://example.test)'}]}},location.origin)`);await pause(100);
    assert.equal(await evaluate('guideNodes().length'),1,'Configuración inválida no reemplaza la vigente');
    assert.match(await evaluate('guideNodes()[0].firstElementChild.style.borderLeft'),/rgb\(255, 0, 255\)/);
    // Arrastre real dentro del iframe a X=720, con captura del puntero.
    const drag=await evaluate(`(()=>{const f=frame().getBoundingClientRect(),r=doc().getElementById('composition-root').getBoundingClientRect(),g=guideNodes()[0].getBoundingClientRect();return {x:f.left+frame().clientLeft+g.left+g.width/2,y:f.top+frame().clientTop+r.top+r.height*.85,endX:f.left+frame().clientLeft+r.left+r.width*720/1920};})()`);
    await browser.client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.x,y:drag.y,button:'left',clickCount:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.endX,y:drag.y,button:'left',buttons:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.endX,y:drag.y,button:'left',clickCount:1});await pause(150);
    assert.ok(Math.abs(await evaluate('guides.guides[0].ratio*1920')-720)<1);
    assert.equal(await evaluate('clipCommits.length'),0,'Mover guía no modifica clips');
    await evaluate(`guideNodes()[0].focus();guideNodes()[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));`);await pause(150);
    assert.ok(Math.abs(await evaluate('guides.guides[0].ratio*1920')-730)<1);
    assert.equal(await evaluate('doc().activeElement.className'),'composition-reference-guide','Foco se conserva tras sincronizar teclado');
    // Referencia fuera de la rejilla de 16 px: distinguir snap propio de snap de rejilla.
    await evaluate(`input('Posición de guía 1 en píxeles','613');`);
    await evaluate(`frame().contentWindow.postMessage({type:'courseforge-composition-select',protocolVersion:1,hfId:'guide-target'},location.origin);`);await pause(100);
    const move=await evaluate(`(()=>{const f=frame().getBoundingClientRect(),r=doc().getElementById('composition-root').getBoundingClientRect(),h=doc().querySelector('[data-hf-id="guide-target"] .composition-move-handle').getBoundingClientRect();return {x:f.left+frame().clientLeft+h.left+h.width/2,y:f.top+frame().clientTop+h.top+h.height/2,dx:310*r.width/1920};})()`);
    await browser.client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:move.x,y:move.y,button:'left',clickCount:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:move.x+move.dx,y:move.y,button:'left',buttons:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:move.x+move.dx,y:move.y,button:'left',clickCount:1});await pause(100);
    assert.equal(await evaluate(`parseFloat(doc().querySelector('[data-hf-id="guide-target"]').style.left)`),413,'Snap usa guía personalizada fuera de rejilla');
    await evaluate(`document.querySelector('input[type=checkbox]').click()`);await pause(100);assert.equal(await evaluate('guideNodes().length'),0);
    const hiddenMove=await evaluate(`(()=>{const f=frame().getBoundingClientRect(),r=doc().getElementById('composition-root').getBoundingClientRect(),h=doc().querySelector('[data-hf-id="guide-target"] .composition-move-handle').getBoundingClientRect();return {x:f.left+frame().clientLeft+h.left+h.width/2,y:f.top+frame().clientTop+h.top+h.height/2,dx:-3*r.width/1920};})()`);
    await browser.client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hiddenMove.x,y:hiddenMove.y,button:'left',clickCount:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hiddenMove.x+hiddenMove.dx,y:hiddenMove.y,button:'left',buttons:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hiddenMove.x+hiddenMove.dx,y:hiddenMove.y,button:'left',clickCount:1});await pause(100);
    assert.equal(await evaluate(`parseFloat(doc().querySelector('[data-hf-id="guide-target"]').style.left)`),416,'Ocultar guía deja únicamente snap de rejilla');
    await browser.client.send('Page.navigate',{url});await waitReady();await initialize();
    assert.equal(await evaluate('guides.visible'),false);assert.equal(await evaluate('guides.guides.length'),1);assert.equal(await evaluate('guides.guides[0].color'),'#ff00ff');
    await evaluate(`document.querySelector('input[type=checkbox]').click()`);await pause(100);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Añadir horizontal').click();`);await pause(100);
    assert.equal(await evaluate('guideNodes().length'),2);assert.equal(await evaluate('guideNodes()[1].dataset.axis'),'y');
    await evaluate(`document.querySelector('[aria-label="Eliminar guía 1"]').click()`);await pause(100);assert.equal(await evaluate('guideNodes().length'),1);
    await evaluate('changeFormat()');await pause(200);
    assert.equal(await evaluate(`doc().getElementById('composition-root').style.height`),'1920px');
    assert.equal(await evaluate('guideNodes().length'),1,'Guía sobrevive al patch de escena');
    assert.equal(await evaluate(`document.querySelector('input[type=number]').value`),'960','Coordenadas siguen el formato nuevo');
    assert.equal(await evaluate('guideNodes()[0].style.top'),'50%');
    console.log('PASS: panel, color, datos inválidos, arrastre, teclado/foco, sin cambios de clip, snap personalizado, ocultar, recarga local, horizontal, eliminar y cambio de formato.');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
