const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { load } = require('cheerio');
const { resolve } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
async function main() {
  await build({ bundle:true, outfile:resolve('.tmp/session-broll-view.cjs'), format:'cjs', platform:'node', jsx:'automatic',
    tsconfig:'apps/web/tsconfig.json', external:['react','react-dom/server'], stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
      import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {SessionBrollView} from './apps/web/src/domains/course-delivery/components/DeliverySessionBrolls';
      export function render(props){return renderToStaticMarkup(<SessionBrollView {...props}/>)}
    `}});
  const {render}=require(resolve('.tmp/session-broll-view.cjs'));
  const clip={id:'10000000-0000-4000-8000-000000000001',name:'Ejemplo de priorización.mp4',status:'GENERATED',current:true,duration:12};
  for(const state of ['empty','loading','error','pending','generated','approved','stale','unapproved','builder']) {
    const props={clips:['empty','loading','error','unapproved'].includes(state)?[]:[{...clip,status:state==='pending'?'PENDING':state==='approved'?'APPROVED':'GENERATED',current:state!=='stale'}],
      approved:state!=='unapproved',canReview:state!=='builder',busy:state==='loading',error:state==='error'?'Error recuperable':'',progress:state==='loading'?'Subiendo clip…':'',
      endpoint:'/api/session/broll',preview:['generated','approved'].includes(state)?clip.id:null,next:null,inputRef:{current:null},pending:state==='pending',
      onUpload(){},onRetry(){},onPreview(){},onRefresh(){},onMore(){},onAction(){}};
    const markup=render(props),$=load(markup);
    assert.match($.text(),/su ausencia no bloquea el curso/);
    assert.equal($('video').length,['generated','approved'].includes(state)?1:0);
    if($('video').length){assert.ok($('video').attr('muted')!==undefined);assert.ok($('video').attr('controls')!==undefined);assert.ok(!$('video').attr('src').startsWith('https:'));}
    assert.equal($('button').filter((_,el)=>$(el).text()==='Aprobar apoyo').length,state==='generated'?1:0);
    if(state==='empty')assert.match($.text(),/Puedes continuar sin B-rolls/);
    if(state==='stale')assert.match($.text(),/Requiere validar/);
    if(state==='error')assert.equal($('[role=alert]').length,1);
    if(state==='generated'){
      // Vista estática sin descargar ni reproducir medios externos.
      const css=readFileSync(resolve('.tmp/session-broll-view.css'),'utf8');
      $('video').replaceWith('<div style="aspect-ratio:16/9;background:#10243a;color:white;display:grid;place-items:center;border-radius:12px">Vista de prueba · Sin reproducción externa</div>');
      writeFileSync(resolve('.tmp/session-broll-visual.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA local · B-rolls de sesión</title><style>
        :root{--engine-text:#10243a;--engine-border:#d0dae4;--engine-canvas:#f7fafb}*{box-sizing:border-box}body{font:16px system-ui;margin:0;padding:24px;background:#edf4f6;color:#10243a}main{max-width:1000px;margin:auto;background:white;border-radius:16px;padding:24px}button,input{font:inherit}button{padding:10px;border:1px solid #ccd5df;border-radius:8px;background:#fff}button:disabled{opacity:.5}ul{padding:0;list-style:none}${css}
        </style><main><h1>Producción · Sesión síncrona</h1><p>Prueba local con contenido ficticio. No sube ni genera archivos.</p>${$('body').html()}</main></html>`);
    }
  }
  console.log('PASS UI B-roll: opcional, carga, error, pendiente, validado, aprobado, obsoleto, sin aprobación y sin rol revisor');
}
main().catch(error=>{console.error(error);process.exitCode=1});
