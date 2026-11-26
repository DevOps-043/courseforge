const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { load } = require('cheerio');
const { resolve } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const { documentFixture } = require('../apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/__tests__/delivery-documents.fixture.js');

async function main() {
  await build({ bundle:true, outfile:resolve('.tmp/hybrid-assignment-view.cjs'), format:'cjs', platform:'node', jsx:'automatic',
    tsconfig:'apps/web/tsconfig.json', external:['react','react-dom/server'], stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
      import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {HybridRouteEditor} from './apps/web/src/domains/course-delivery/components/HybridRouteEditor';
      export function render(controller){return renderToStaticMarkup(<HybridRouteEditor controller={controller}/>)}
    `}});
  const { render } = require(resolve('.tmp/hybrid-assignment-view.cjs'));
  const {workspace,id,context}=documentFixture();
  workspace.document.config.mode='HYBRID';
  workspace.document.agenda[0].coverage.push({lessonId:'live-only',scope:'Caso en vivo',review:false});
  workspace.document.hybridRoute=[{kind:'ASYNCHRONOUS',id:'10000000-0000-4000-8000-000000000002',title:'Preparación individual',minutes:60,lessonIds:['lesson','async-only']},{kind:'SYNCHRONOUS',sessionId:id}];
  const lessons=[context.lessons[0],{id:'live-only',title:'Caso de aplicación en equipo',module:'Módulo de práctica',objective:'Aplicar criterios'},
    {id:'async-only',title:'Preparación individual de conceptos',module:'Módulo de fundamentos',objective:'Comprender conceptos'}];
  const controller={snapshot:{workspace,lessons,syllabusApproved:true},busy:false};
  let $=load(render(controller));
  const choices=$('select').filter((_,element)=>$(element).find('option[value=PENDING][disabled]').length>0);
  assert.equal(choices.length,3);
  assert.deepEqual(choices.map((_,element)=>$(element).val()).get(),['SHARED','SYNCHRONOUS','ASYNCHRONOUS']);
  assert.match($.text(),/Solo Hub: 1 · Solo Academy: 1 · Compartidas: 1 · Sin asignar: 0/);
  assert.equal($('button').filter((_,element)=>$(element).text()==='Guardar recorrido híbrido').prop('disabled'),false);
  const markup=$('body').html();
  const css=readFileSync(resolve('.tmp/hybrid-assignment-view.css'),'utf8');
  writeFileSync(resolve('.tmp/hybrid-assignment-visual.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA local · Asignación de modalidades</title><style>
    :root{--engine-border:#ced9e2;--engine-text:#10243a;--engine-canvas:#f6f9fa;--engine-surface-solid:white;--engine-text-muted:#456;--engine-accent-strong:#008a7e}
    *{box-sizing:border-box}body{font:16px system-ui;background:#edf4f6;margin:0;padding:24px;color:#10243a}main{max-width:1050px;margin:auto;background:white;padding:24px;border-radius:16px}button,input,select,textarea{font:inherit}select{height:auto}button{padding:10px;border:1px solid #ced9e2;border-radius:8px}fieldset{min-width:0} ${css}
    </style><main><h1>Temario · Distribución del curso híbrido</h1><p>Prueba local con datos ficticios; no modifica cursos ni inicia generación.</p>${markup}</main></html>`);
  $=load(render({...controller,busy:true}));
  assert.ok($('fieldset[disabled]').length>=2);
  console.log('PASS UI: destinos explícitos, resumen, sesiones/tramos y edición bloqueada durante guardado');
}
main().catch(error=>{console.error(error);process.exitCode=1});
