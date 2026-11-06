// Desde la raíz, tras compilar las pruebas HyperFrames. Sin servicios externos.
async function main() {
  const {default: assert} = await import('node:assert/strict');
  const {createServer} = await import('node:http');
  const {build} = await import('esbuild');
  const {mkdir, writeFile} = await import('node:fs/promises');
  const root = '../../.tmp/hyperframes-tests/domains/production/composition-editor/';
  const {createInitialCompositionDocument} = await import(root + 'composition-document.factory.js');
  const {compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS} = await import(root + 'composition-preview-compiler.service.js');
  const {launchCompositionQaBrowser} = await import(root + 'qa/composition-qa-browser.js');
  const initial = createInitialCompositionDocument({animatedDeck:{css:'',fonts:[],width:1920,height:1080,
    slides:[{index:0,label:'Base',classes:'slide',html:'<section>Base</section>',animationCount:0}]},assets:[],
    plan:{accentColor:'#38BDF8',durationSeconds:12,subtitle:'',title:'Subtítulos manuales'}});
  initial.canvas.durationSeconds = 12;
  console.info('QA de subtítulos: compilando fixture local.');
  const bundle = await build({stdin:{contents:`
    import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {CompositionStudioLibrary} from '@/domains/materials/components/composition-editor/CompositionStudioLibrary';
    import {CompositionInspector} from '@/domains/materials/components/composition-editor/CompositionInspector';
    import {createCompositionNativeOverlay} from '@/domains/production/composition-editor/composition-native-overlay.factory';
    import {applyCompositionEditorPatches} from '@/domains/production/composition-editor/editor-patch.service';
    import {compositionEditorDocumentSchema} from '@/domains/production/composition-editor/composition-document.types';
    import styles from '@/domains/materials/components/composition-editor/CompositionStudio.module.css';
    window.fetch=async url=>{if(String(url)==='/api/admin/fonts')return new Response(JSON.stringify({fonts:[]}),{status:200,headers:{'Content-Type':'application/json'}});throw new Error('Solicitud externa no permitida en este fixture');};
    window.qa={document:${JSON.stringify(initial)},manualCreations:0,generations:0,commits:[]};
    function Harness(){
      const [doc,setDoc]=useState(window.qa.document),[selectedId,setSelectedId]=useState(null);
      const current=useRef(doc);current.current=doc;window.qa.document=doc;
      const patch=async operations=>{const next=applyCompositionEditorPatches(current.current,operations);window.qa.commits.push(operations);current.current=next;setDoc(next);return true;};
      window.reload=()=>setDoc(compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(current.current))));
      window.lock=()=>setDoc({...current.current,tracks:current.current.tracks.map(track=>({...track,locked:true}))});
      const createManual=()=>{const overlay=createCompositionNativeOverlay({document:current.current,id:'manual-caption',kind:'CAPTION',playheadSeconds:3});
        void patch([{type:'clip.add',clipId:overlay.clip.id,clip:overlay.clip,...(overlay.track?{track:overlay.track}:{})}]);window.qa.manualCreations++;setSelectedId(overlay.clip.id);};
      const clip=doc.clips.find(candidate=>candidate.id===selectedId)||null;
      const noop=()=>{};
      return <main className={styles.studio} style={{display:'flex',alignItems:'start',height:900}}><div id="library-width" style={{width:264,height:700,flexShrink:0}}><CompositionStudioLibrary assets={[]} delivery={null} introAssetId={null} libraryOpen={true} lessons={[]} narrative={<span>Guion de prueba</span>} narrativeCount={0}
        captionTranscriptWordCount={0} insertionMode="APPEND" onAddAsset={noop} onReplaceAsset={noop} onAddSoundEffect={noop} onAddCaptionLayer={createManual}
        onGenerateTranscriptCaptions={()=>window.qa.generations++} onInsertionModeChange={noop} onAddTextLayer={noop} onClearIntro={noop} onSelectAsset={noop}
        onSelectLesson={noop} onSetIntro={noop} selectedHfId={clip?.hfId||null} replacementTarget={null} selectedLessonId={null} timelineAssetHfIds={new Map()}/></div>
        <div id="inspector" style={{width:360}}><CompositionInspector canvasWidth={doc.canvas.width} canvasHeight={doc.canvas.height} animations={[]} clip={clip}
          componentId={null} cropModeEnabled={false} colorGradingStatus={null} onAnimationSelect={noop} onDetachAudio={async()=>{}} onPatch={patch}
          onPreviewPosition={noop} onPreviewMask={noop} onPreviewCrop={noop} onPreviewColorGrading={noop} onRemove={async()=>{}} saving={false}
          selectedAnimationId={null} separatingAudio={false} separatingAudioProgress={0} sourcePreviewUrl={null} track={doc.tracks.find(track=>track.id===clip?.trackId)||null}/></div>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `,resolveDir:process.cwd(),loader:'tsx'},tsconfig:'apps/web/tsconfig.json',bundle:true,write:false,outfile:'.tmp/manual-caption-evidence/fixture.js',platform:'browser',jsx:'automatic',define:{'process.env':'{}'}});
  const javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
  const server = createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<html lang="es"><style>${css}</style><div id="root"></div><script>${javascript}</script></html>`);});
  console.info('QA de subtítulos: iniciando servidor local.');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try {
    console.info('QA de subtítulos: iniciando Chromium.');
    browser=await launchCompositionQaBrowser({profilePrefix:'courseforge-manual-captions-'});
    console.info('QA de subtítulos: verificando interacción.');
    const evaluate=async expression=>{const response=await browser.client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitFor=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('No se cumplió: '+expression);};
    await browser.client.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
    await waitFor("Boolean(document.querySelector('[role=tab]'))");
    for(const width of [232,264,336]){
      await evaluate(`document.querySelector('#library-width').style.width='${width}px'`);await pause(100);
      assert.equal(await evaluate(`(()=>{const tabs=[...document.querySelectorAll('[role=tab]')];const tab=tabs.find(tab=>tab.textContent.trim()==='Subtítulos');const box=tab.getBoundingClientRect();return box.width>0&&tab.scrollWidth<=tab.clientWidth+1&&tabs.filter(item=>item!==tab).every(item=>{const other=item.getBoundingClientRect();return Math.min(box.right,other.right)-Math.max(box.left,other.left)<=1||Math.min(box.bottom,other.bottom)-Math.max(box.top,other.top)<=1;});})()`),true,'Pestaña visible sin solapes a '+width);
    }
    await evaluate("[...document.querySelectorAll('[role=tab]')].find(button=>button.textContent.trim()==='Subtítulos').click()");
    await waitFor("Boolean(document.querySelector('[aria-label=\"Crear subtítulos\"]'))");
    assert.equal(await evaluate('qa.generations'),0);
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Crear subtítulos manuales').click()");
    await waitFor("Boolean(document.querySelector('[aria-label=\"Texto del subtítulo 1\"]'))");
    assert.equal(await evaluate('qa.manualCreations'),1);
    assert.equal(await evaluate("qa.document.clips.find(clip=>clip.id==='manual-caption').source.origin"),'MANUAL');
    await evaluate(`window.input=(selector,value)=>{const field=document.querySelector(selector);Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));};input('[aria-label="Texto del subtítulo 1"]','Primera frase escrita a mano');`);
    await pause(800);
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Agregar subtítulo').click()");
    await waitFor("Boolean(document.querySelector('[aria-label=\"Texto del subtítulo 2\"]'))");
    await evaluate(`input('[aria-label="Texto del subtítulo 2"]','Segunda frase <manual>');`);
    await pause(850);
    const source=await evaluate("qa.document.clips.find(clip=>clip.id==='manual-caption').source");
    assert.equal(source.origin,'MANUAL');assert.deepEqual(source.cues.map(cue=>cue.text),['Primera frase escrita a mano','Segunda frase <manual>']);
    assert.deepEqual(source.cues.map(cue=>[cue.startSeconds,cue.endSeconds]),[[0,2],[2,4]]);
    const beforeInvalid=await evaluate('qa.commits.length');
    await evaluate(`(()=>{const field=[...document.querySelectorAll('#inspector label')].filter(label=>label.textContent.startsWith('Inicio (s)'))[1].querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'1');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(850);assert.equal(await evaluate('qa.commits.length'),beforeInvalid,'Solapes no deben guardarse');
    await evaluate(`(()=>{const field=[...document.querySelectorAll('#inspector label')].filter(label=>label.textContent.startsWith('Inicio (s)'))[1].querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'2');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(800);await evaluate('reload()');await pause(150);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Texto del subtítulo 2"]').value`),'Segunda frase <manual>');
    assert.equal(await evaluate('qa.generations'),0,'La autoría manual no debe llamar a generación');
    const document=await evaluate('qa.document');
    for(const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW,COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]){
      const html=await compileCompositionPreview({document,assetUrls:new Map(),target});
      assert.ok(html.includes('Primera frase escrita a mano'));assert.ok(html.includes('Segunda frase &lt;manual&gt;'));
    }
    await evaluate('lock()');await pause(150);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Texto del subtítulo 1"]').disabled`),true);
    await mkdir('.tmp/manual-caption-evidence',{recursive:true});
    await writeFile('.tmp/manual-caption-evidence/document.json',JSON.stringify(document,null,2));
    console.log('PASS: pestaña Subtítulos, creación sin voz, dos frases manuales, guardado y recarga simulada, rechazo de solapes, bloqueo, texto escapado en preview/render y cero generación.');
  } finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
