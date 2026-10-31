// Desde la raíz, tras compilar tsconfig.hyperframes-test.json. Servidor local y medios sintéticos.
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {build} = require('esbuild');
const root='../../../../apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/';
const {createInitialCompositionDocument}=require(root+'composition-document.factory.js');
const {applyCompositionEditorPatches}=require(root+'editor-patch.service.js');
const {compileCompositionPreview}=require(root+'composition-preview-compiler.service.js');
const {launchCompositionQaBrowser}=require(root+'qa/composition-qa-browser.js');

async function main(){
  const assetId='55555555-5555-4555-8555-555555555558';
  let document=createInitialCompositionDocument({animatedDeck:null,assets:[{checksum:'a'.repeat(64),durationSeconds:4,
    fileSizeBytes:100,hasAudio:false,mimeType:'video/mp4',productionAssetId:assetId,publicUrl:null,
    storageBucket:'production-assets',storagePath:'fixture.mp4',timelineRole:'BROLL'}],
    plan:{accentColor:'#38BDF8',durationSeconds:4,subtitle:'',title:'Máscara no destructiva'}});
  const clip=document.clips.find(clip=>clip.kind==='VIDEO');
  document.clips=[clip];clip.kind='IMAGE';
  document=applyCompositionEditorPatches(document,[{type:'clip.layout',clipId:clip.id,layout:{x:100,y:100,width:400,height:300}},
    {type:'clip.crop',clipId:clip.id,crop:{top:20,right:30,bottom:40,left:50}}]);
  const subject=document.clips[0];
  const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="red"/></svg>');
  const previewHtml=await compileCompositionPreview({document,documentHash:'a'.repeat(64),assetUrls:new Map([[assetId,svg]])});
  const bundle=await build({stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {CompositionMaskControls} from '@/domains/materials/components/composition-editor/CompositionMaskControls';
    import {createCompositionPreviewParentCommand} from '@/domains/production/composition-editor/composition-preview-protocol';
    window.commits=[]; let sequence=0;
    const post=message=>document.querySelector('iframe').contentWindow.postMessage(createCompositionPreviewParentCommand(message),location.origin);
    function Harness(){
      const [clip,setClip]=useState(${JSON.stringify(subject)}),[disabled,setDisabled]=useState(false);
      window.lock=setDisabled;
      window.earlierMask=mask=>post({type:'courseforge-composition-visual-patch',baseDocumentHash:'${'a'.repeat(64)}',sequence:++sequence,patch:{changes:[{hfId:clip.hfId,mask}]}});
      return <CompositionMaskControls clip={clip} disabled={disabled}
        onPreview={(hfId,mask,reset)=>post({reset,type:'courseforge-composition-preview-mask',hfId,mask})}
        onPatch={async operations=>{const mask=operations[0].mask;window.commits.push(mask);setClip(clip=>({...clip,mask:mask??undefined}));
          post({type:'courseforge-composition-visual-patch',baseDocumentHash:'${'a'.repeat(64)}',sequence:++sequence,patch:{changes:[{hfId:clip.hfId,mask}]}});return true;}}/>;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `,resolveDir:process.cwd(),loader:'tsx'},tsconfig:'apps/web/tsconfig.json',bundle:true,write:false,platform:'browser',jsx:'automatic'});
  const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(request.url==='/preview'?previewHtml:`<html lang="es"><div id="root"></div><iframe src="/preview" style="width:960px;height:540px"></iframe><script>${bundle.outputFiles[0].text}</script></html>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await launchCompositionQaBrowser({profilePrefix:'courseforge-mask-'});
    const evaluate=async expression=>{const result=await browser.client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    await browser.client.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
    for(let i=0;i<200&&!await evaluate('Boolean(document.querySelector("select")&&document.querySelector("iframe").contentWindow.__timelines?.["courseforge-composition"])');i++)await pause(50);
    await evaluate(`window.target=()=>document.querySelector('iframe').contentDocument.querySelector('[data-hf-id="${subject.hfId}"]');
      window.state=()=>{const t=target(),m=t.querySelector('.composition-visual-mask');return {mask:m?.style.clipPath??'none',crop:t.querySelector('.motion-subject').style.clipPath,source:t.querySelector('img').getAttribute('src'),width:t.style.width};};
      window.changeShape=value=>{const select=document.querySelector('select');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};`);
    const before=await evaluate('state()');
    await evaluate(`changeShape('CIRCLE')`);await pause(100);
    assert.match((await evaluate('state()')).mask,/circle/);
    await evaluate(`window.hitImage=(localX,localY)=>{const frame=document.querySelector('iframe'),t=target(),box=t.getBoundingClientRect(),scale=box.width/400;
      return frame.contentDocument.elementFromPoint(box.left+localX*scale,box.top+localY*scale)?.tagName==='IMG';};`);
    assert.equal(await evaluate('hitImage(200,150)'),true,'Centro de la máscara visible');
    assert.equal(await evaluate('hitImage(60,30)'),false,'Esquina dentro de crop pero fuera del círculo oculta');
    assert.equal(await evaluate('commits.length'),0,'Preview previo al autoguardado');
    await pause(700);assert.equal(await evaluate('commits.length'),1);
    await evaluate(`changeShape('ROUNDED_RECT')`);await pause(750);
    await evaluate(`const range=document.querySelector('input[type=range]');range.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(range,'35');range.dispatchEvent(new Event('input',{bubbles:true}));`);
    await pause(750);
    assert.match((await evaluate('state()')).mask,/35%/);
    assert.equal(await evaluate('commits.length'),2,'El arrastre no escribe por cada cambio');
    await evaluate(`earlierMask({shape:'ROUNDED_RECT',radiusPercent:20})`);await pause(100);
    assert.match((await evaluate('state()')).mask,/35%/,'Una confirmación anterior no reemplaza el gesto actual');
    await evaluate(`document.querySelector('input').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);await pause(100);
    assert.equal(await evaluate('commits.length'),3);
    await evaluate(`changeShape('ELLIPSE')`);await pause(750);assert.match((await evaluate('state()')).mask,/ellipse/);
    await evaluate(`changeShape('NONE')`);await pause(750);
    const cleared=await evaluate('state()');assert.equal(cleared.mask,'none');assert.equal(cleared.crop,before.crop);
    assert.equal(await evaluate('hitImage(60,30)'),true,'Quitar máscara recupera la esquina admitida por crop');
    assert.equal(await evaluate('hitImage(10,150)'),false,'Quitar máscara conserva el recorte izquierdo');
    assert.equal(cleared.source,before.source);assert.equal(cleared.width,before.width);
    await evaluate(`lock(true)`);await pause(100);assert.equal(await evaluate('document.querySelector("select").matches(":disabled")'),true);
    console.log('PASS: círculo, elipse, redondeo, preview inmediato, guardado al soltar, quitar conserva crop/fuente/tamaño y bloqueo.');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
