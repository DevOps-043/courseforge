// Fixtures locales con CSS/componentes reales. Compara contra 5aed69dc, anterior a este cambio.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createServer}=require('node:http');
const {build}=require('esbuild');
const compiled='../../../../apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/';
const {createInitialCompositionDocument}=require(compiled+'composition-document.factory.js');
const {compileCompositionPreview}=require(compiled+'composition-preview-compiler.service.js');
const {launchCompositionQaBrowser}=require(compiled+'qa/composition-qa-browser.js');

const fixture=`
import React,{useEffect,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {CompositionPreviewToolbar} from '@/domains/materials/components/composition-editor/CompositionPreviewToolbar';
import {CompositionPreviewViewport} from '@/domains/materials/components/composition-editor/CompositionPreviewViewport';
import {useCompositionStudioControls} from '@/domains/materials/components/composition-editor/useCompositionStudioControls';
import styles from '@/domains/materials/components/composition-editor/CompositionStudio.module.css';
function Fixture(){
  const controls=useCompositionStudioControls(),frame=useRef(null),baseline=useRef(null);const [inspector,setInspector]=useState(true),[format,setFormat]=useState('16:9');
  const canvas=format==='9:16'?{width:1080,height:1920}:format==='1:1'?{width:1080,height:1080}:{width:1920,height:1080};
  window.view={zoom:controls.previewZoom,expanded:controls.monitorExpanded,top:controls.studioTopPanePercent};window.format=setFormat;
  const noop=()=>{};
  const postZoom=()=>frame.current?.contentWindow.postMessage({type:'courseforge-composition-preview-zoom',scale:controls.previewZoom,protocolVersion:1},'*');
  useEffect(postZoom,[controls.previewZoom]);
  useEffect(()=>{const sync=()=>controls.setPreviewFullscreen(document.fullscreenElement===controls.previewShellRef.current);document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync)},[]);
  const props={canvas,currentVersion:1,duration:8,agentProposalActive:false,comparisonActive:false,directEditingEnabled:true,gridVisible:false,history:null,
    libraryOpen:!controls.monitorExpanded,inspectorOpen:inspector&&!controls.monitorExpanded,onCloseHistory:noop,onHistoryOpen:noop,onOpenReferenceGuides:noop,
    monitorExpanded:controls.monitorExpanded,onToggleMonitorExpanded:controls.toggleMonitorExpanded,onContinueToPublication:noop,
    onOpenLibrary:()=>{if(controls.monitorExpanded)controls.toggleMonitorExpanded()},onInspectorToggle:()=>{if(controls.monitorExpanded){controls.toggleMonitorExpanded();setInspector(true)}else setInspector(value=>!value)},
    onIntervalAction:noop,onOpenAssistant:noop,onOpenCommandPalette:noop,onOpenPresets:noop,onReload:noop,onRedo:noop,onRestoreHistory:noop,onSplit:noop,onToggleComparison:noop,
    onToggleDirectEditing:noop,onToggleFullscreen:controls.togglePreviewFullscreen,onToggleGrid:noop,onToggleSafeAreas:noop,onToggleSnap:noop,onToggleToolMenu:()=>controls.setToolMenuOpen(value=>!value),
    onToggleTrim:noop,onToggleVisualCrop:noop,onUndo:noop,onZoom:controls.changePreviewZoom,previewFullscreen:controls.previewFullscreen,previewStatusLabel:null,previewZoom:controls.previewZoom,redoLabel:null,
    removalRangeStartSeconds:null,safeAreasVisible:true,saveError:null,saving:false,pendingEdits:false,snapEnabled:true,toolMenuOpen:controls.toolMenuOpen,toolMenuRef:controls.toolMenuRef,trimToolEnabled:false,visualCropEnabled:false,canRedo:true,canUndo:true,undoLabel:null,
    onCanvasFormatChange:setFormat};
  return <div className={styles.studio} style={{height:'100vh'}}><header className={styles.studioHeader}>Editor de prueba</header>
    <div ref={controls.studioGridRef} className={styles.editorGrid+' '+(inspector?styles.editorGridWithInspector:'')+' '+(controls.monitorExpanded?styles.editorGridMonitorExpanded:'')}
      style={{'--studio-preview-row':controls.studioTopPanePercent+'fr','--studio-timeline-row':(100-controls.studioTopPanePercent)+'fr'}}>
      <aside data-library className={styles.library}><input aria-label="Borrador de biblioteca" defaultValue="Texto conservado"/></aside>
      <section ref={controls.previewShellRef} data-preview className={styles.previewPanel+' '+(controls.previewFullscreen?styles.previewFullscreen:'')}>
        <CompositionPreviewToolbar {...props}/>
        <CompositionPreviewViewport canvasHeight={canvas.height} canvasWidth={canvas.width} comparisonActive={false} comparisonBaselineFrameRef={baseline} comparisonBaselineLoading={false} comparisonBaselineUrl={null}
          agentProposalActive={false} duration={8} fps={30} frameRef={frame} onBeginScrub={noop} onFrameError={noop} onFrameLoad={postZoom} onPlaySelectedAnimation={noop} onRefreshDocument={noop} onRefreshMedia={noop}
          onSceneSelect={noop} onSeek={noop} onTogglePlayback={noop} pendingMediaCount={0} playbackError={null} previewErrorActionLabel={null} presetPreviewActive={false} previewDirty={false} previewMediaState="READY" previewReady={true}
          previewUrl={'/preview?format='+format} previewZoom={controls.previewZoom} safeAreasVisible={true} saving={false} scenes={[]} seconds={0} selectedAnimationId={null} transportActive={false}/>
      </section>
      <aside data-inspector className={styles.inspector} style={{display:inspector?undefined:'none'}}>Inspector</aside>
      <div className={styles.resizer}>↕</div><div className={styles.timelinePanel}><div className={styles.timelineScroll}>Timeline accesible</div></div>
    </div></div>;
}createRoot(document.getElementById('root')).render(<Fixture/>);
`;
async function main(){
  const htmlByFormat=new Map();
  for(const format of ['16:9','9:16','1:1']){
    const [width,height]=format==='9:16'?[1080,1920]:format==='1:1'?[1080,1080]:[1920,1080];
    const document=createInitialCompositionDocument({animatedDeck:{css:'.slide{background:#176b86;color:white}',fonts:[],width,height,
      slides:[{animationCount:0,classes:'slide',html:'<h1>Monitor de composición</h1>',index:0,label:'Ejemplo'}]},assets:[],plan:{accentColor:'#38BDF8',durationSeconds:8,subtitle:'',title:'Vista del monitor'}});
    htmlByFormat.set(format,await compileCompositionPreview({document,documentHash:'a'.repeat(64),assetUrls:new Map()}));
  }
  const bundles=new Map();
  for(const version of ['before','after']){
    const result=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},outfile:'.tmp/monitor-space-qa/fixture.js',tsconfig:'apps/web/tsconfig.json',bundle:true,write:false,platform:'browser',jsx:'automatic',
      plugins:version==='before'?[{name:'baseline',setup(build){build.onLoad({filter:/CompositionStudio\.module\.css$|CompositionPreviewToolbar\.tsx$|useCompositionStudioControls\.ts$/},args=>{
        const relative=path.relative(process.cwd(),args.path).split(path.sep).join('/');
        return {contents:execFileSync('git',['show','5aed69dc:'+relative],{encoding:'utf8'}),loader:args.path.endsWith('.css')?'local-css':'tsx',resolveDir:path.dirname(args.path)};
      });}}]:[]});
    bundles.set(version,{js:result.outputFiles.find(file=>file.path.endsWith('.js')).text,css:result.outputFiles.find(file=>file.path.endsWith('.css')).text});
  }
  const server=createServer((request,response)=>{const url=new URL(request.url,'http://localhost');
    if(url.pathname==='/preview'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(htmlByFormat.get(url.searchParams.get('format')));return;}
    const version=url.searchParams.get('version')||'after',bundle=bundles.get(version);
    response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<html lang="es"><head><style>'+bundle.css+'\n*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}</style></head><body><div id="root"></div><script>'+bundle.js+'</script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await launchCompositionQaBrowser({profilePrefix:'courseforge-monitor-'});
    const evaluate=async expression=>{const result=await browser.client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const url=`http://127.0.0.1:${server.address().port}`;
    let frameSession,frameTarget,requestSequence=0;
    const pending=new Map();
    browser.client.onEvent('Target.receivedMessageFromTarget',event=>{
      const message=JSON.parse(event.message),request=pending.get(message.id);if(!request)return;
      pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
    });
    const evaluateFrame=async expression=>{
      const id=++requestSequence;
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Sin respuesta CDP del iframe aislado'));},5000);
        pending.set(id,{resolve,reject,timer});
        browser.client.send('Target.sendMessageToTarget',{sessionId:frameSession,message:JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);
      });
      if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
    };
    const ready=async()=>{
      await pause(300);
      for(let i=0;i<200;i++){
        const targets=await browser.client.send('Target.getTargets');
        const expected=await evaluate('document.querySelector("iframe")?.src');
        const child=targets.targetInfos.find(target=>target.type==='iframe'&&target.url===expected);
        if(child){
          if(frameTarget!==child.targetId){frameTarget=child.targetId;frameSession=(await browser.client.send('Target.attachToTarget',{targetId:frameTarget,flatten:false})).sessionId;}
          if(await evaluateFrame(`Boolean(document.getElementById('composition-root')?.style.getPropertyValue('--preview-user-scale'))`)){await pause(100);return;}
        }
        await pause(50);
      }
      console.log(JSON.stringify(await browser.client.send('Page.getFrameTree')));
      console.log(await evaluate(`({frames:document.querySelectorAll('iframe').length,html:document.querySelector('[data-preview]')?.outerHTML.slice(-700)})`));
      throw new Error('El iframe no completó el ajuste inicial.');
    };
    const click=async label=>{await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')).find(element=>element.getClientRects().length);if(button){button.focus();button.click();}})()`);await pause(100);};
    const metrics=async()=>({...await evaluateFrame(`(()=>{const canvas=document.getElementById('composition-root').getBoundingClientRect();return {width:canvas.width,height:canvas.height};})()`),
      ...await evaluate(`(()=>{const panel=document.querySelector('[data-preview]').getBoundingClientRect();return {panelWidth:panel.width,panelHeight:panel.height,zoom:window.view.zoom,top:window.view.top};})()`)});
    const measurements=[];
    for(const {width,height} of [{width:1365,height:768},{width:1365,height:900},{width:1920,height:1080}]){
      await browser.client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await browser.client.send('Page.navigate',{url:url+'?version=before'});await ready();const before=await metrics();
      await browser.client.send('Page.navigate',{url});await ready();const after=await metrics();
      assert.ok(after.width*after.height>before.width*before.height*1.05,`El video debe crecer en vista normal: ${width}`);
      await click('Ampliar monitor');const expanded=await metrics();
      assert.ok(expanded.width*expanded.height>after.width*after.height*1.15,'Ampliar aumenta área útil');
      assert.equal(await evaluate('Boolean(document.fullscreenElement)'),false);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-library]')).display`),'none');
      await click('Restaurar distribución del editor');assert.equal((await metrics()).top,after.top);
      assert.equal(await evaluate(`document.querySelector('[aria-label="Borrador de biblioteca"]').value`),'Texto conservado');
      measurements.push({viewport:{width,height},before,after,expanded});
    }
    await click('Ajustar zoom del monitor');
    assert.equal(await evaluate(`document.querySelector('[aria-label="Zoom del monitor"][role=dialog]').matches(':popover-open')`),true);
    await evaluate(`const range=document.querySelector('input[type=range][aria-label="Zoom del monitor"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(range,'4');range.dispatchEvent(new Event('input',{bubbles:true}));`);await pause(100);
    assert.equal(await evaluate('view.zoom'),4);assert.equal(await evaluateFrame(`document.getElementById('composition-root').style.getPropertyValue('--preview-user-scale')`),'4');
    const overlayWidth=await evaluate(`document.querySelector('[aria-hidden=true][class*="safeAreaOverlay"]').getBoundingClientRect().width`);
    assert.ok(Math.abs(overlayWidth-(await metrics()).width)<=1,'Áreas seguras siguen el zoom');
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Porcentaje de zoom"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'137');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);
    assert.equal(await evaluate('view.zoom'),1.37);
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Porcentaje de zoom"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'500');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);
    assert.equal(await evaluate('view.zoom'),1.37,'Porcentaje fuera de rango no cambia la vista válida');
    await click('Cerrar zoom');await click('Ajustar zoom del monitor');
    await evaluate(`document.querySelector('[role=dialog] button[aria-pressed]')?.click()`);await pause(100);assert.equal(await evaluate('view.zoom'),0.25);
    await evaluate(`Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='Encajar lienzo').click()`);await pause(100);assert.equal(await evaluate('view.zoom'),1);
    await browser.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(100);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Ajustar zoom del monitor');
    for(const format of ['9:16','1:1','16:9']){await evaluate(`window.format(${JSON.stringify(format)})`);await ready();const m=await metrics();
      const expected=format==='9:16'?1080/1920:format==='1:1'?1:1920/1080;assert.ok(Math.abs(m.width/m.height-expected)<0.001);}
    const fullscreenButton=await evaluate(`(()=>{const b=document.querySelector('[aria-label="Abrir preview en pantalla completa"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};})()`);
    await browser.client.send('Input.dispatchMouseEvent',{type:'mousePressed',...fullscreenButton,button:'left',clickCount:1});
    await browser.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...fullscreenButton,button:'left',clickCount:1});await pause(200);
    assert.equal(await evaluate('Boolean(document.fullscreenElement)'),true,'Fullscreen real sigue operativo');
    await evaluate('document.exitFullscreen()');await pause(100);
    for(const width of [1280,1100,1024,768,390]){
      await browser.client.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await pause(100);
      assert.equal(await evaluate(`(()=>{const panel=document.querySelector('[data-preview]').getBoundingClientRect(),buttons=Array.from(document.querySelectorAll('[data-preview] > :first-child button,[data-preview] > :first-child select')).filter(e=>e.getClientRects().length);return buttons.every(e=>{const b=e.getBoundingClientRect();return b.left>=panel.left-1&&b.right<=panel.right+1})})()`),true,`Toolbar sin desborde a ${width}`);
      await click('Ajustar zoom del monitor');
      assert.equal(await evaluate(`(()=>{const p=document.querySelector('[role=dialog][aria-label="Zoom del monitor"]')?.getBoundingClientRect();return p&&p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight})()`),true);
      await click('Cerrar zoom');
    }
    fs.writeFileSync(path.join(__dirname,'measurements.json'),JSON.stringify(measurements,null,2)+'\n');
    console.log('PASS: área antes/después, ampliar/restaurar, fullscreen real, 25/100/137/400%, áreas seguras, entradas inválidas, formas y toolbar/popover responsive.');
    console.log(JSON.stringify(measurements,null,2));
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
