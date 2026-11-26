// Prueba de renderizado real, sin navegador, credenciales ni cambios remotos.
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const { build } = require('esbuild');
const { load } = require('cheerio');

async function main() {
  const output = resolve('.tmp/hybrid-materials-qa-render');
  mkdirSync(output, { recursive: true });
  const mocks = {
    'hooks/useMaterials': `export let current;export function setCurrent(value){current=value}export function useMaterials(){return current}export function useMaterialStateStyles(){return {label:'Listo para QA',color:''}}`,
    'pipeline-dirty-actions': `export async function dismissUpstreamDirtyAction(){}`,
    'LessonMaterialsCard': `export function LessonMaterialsCard(){return <article>Lección validada</article>}`,
    'DeliveryContentEditor': `export function DeliveryContentEditor(){return <p>Contenido disponible</p>}`,
    'DeliveryLivePanel': `export function DeliveryLivePanel(){return null}`,
    'DeliveryAgendaEditor': `export function DeliveryAgendaEditor(){return null}`,
    'DeliveryConfigurationFields': `export function DeliveryConfigurationFields(){return null}`,
    'HybridRouteEditor': `export function HybridRouteEditor(){return null}`,
  };
  await build({ bundle: true, write: true, outdir: output, format: 'cjs', platform: 'node', jsx: 'automatic', tsconfig: resolve('apps/web/tsconfig.json'), external: ['react', 'react-dom/server'],
    plugins: [{ name: 'controladores-simulados', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = args.path === 'qa-material-hooks' ? 'hooks/useMaterials' : Object.keys(mocks).find(key => args.path.endsWith(key));
        return key ? { path: key, namespace: 'qa' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }], stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
      import {HybridMaterialsWorkspace} from './apps/web/src/domains/materials/components/HybridMaterialsWorkspace';
      import {DeliveryStagePanel} from './apps/web/src/domains/course-delivery/components/DeliveryStagePanel';
      import {setCurrent} from 'qa-material-hooks';
      export function render(scenario){
        const id='10000000-0000-4000-8000-000000000001';
        const lessons=Array.from({length:20},(_,index)=>({id:'lesson-'+index,module_id:'m',module_title:'Módulo',lesson_title:'Lección '+index,state:'APPROVABLE'}));
        const academy={materials:{state:'PHASE3_READY_FOR_QA',lessons},loading:false,isGenerating:false,isValidating:false,isApproved:false,isReadyForQA:true,isStartingGeneration:false,error:null,actionError:null};
        const document={config:{mode:'HYBRID'},agenda:[{id,title:'Sesión',minutes:60}],materials:{[id]:{documents:{}}},staleMaterials:[]};
        const delivery={snapshot:{enabled:true,syllabusApproved:true,canReview:true,settings:[],lessons:[],workspace:{revision:2,document},readiness:{planReady:true,materialsReady:false},run:{id,operation:'MATERIALS',status:'COMPLETED',units:[{id,ready:true}]}},busy:false,error:''};
        if(scenario==='readonly')delivery.snapshot.canReview=false;
        if(scenario==='hub-pending')document.staleMaterials=[id];
        if(scenario==='academy-pending'){academy.isReadyForQA=false;academy.materials.state='PHASE3_GENERATED';lessons[0].state='GENERATED'}
        if(scenario==='running')delivery.snapshot.run.status='RUNNING';
        if(scenario==='approved'){delivery.snapshot.readiness.materialsReady=true;academy.isApproved=true;academy.isReadyForQA=false}
        setCurrent(academy);
        if(scenario==='synchronous'){document.config.mode='SYNCHRONOUS';return renderToStaticMarkup(<DeliveryStagePanel controller={delivery} stage={5}/>)}
        return renderToStaticMarkup(<HybridMaterialsWorkspace artifactId={id} delivery={delivery} profile={{platform_role:scenario==='readonly'?'CONSTRUCTOR':'ADMIN'}}/>);
      }
    ` } });
  const { render } = require(resolve(output, 'stdin.js'));
  const jointLabel = 'Aprobar materiales de Hub y Academy';
  const button = ($, text) => $('button').filter((_, node) => $(node).text().trim() === text);
  for (const scenario of ['ready', 'readonly', 'hub-pending', 'academy-pending', 'running', 'approved']) {
    const $ = load(render(scenario));
    const panel = $('section[aria-label="Revisión QA del curso híbrido"]');
    assert.equal(panel.length, 1);
    assert.equal(panel.parents('[hidden]').length, 0, 'QA conjunto debe quedar fuera de los destinos ocultables');
    assert.equal(button($, 'Aprobar materiales completos').length, 0, 'No duplicar aprobación conjunta al pie de Hub');
    if (scenario === 'readonly' || scenario === 'approved') assert.equal(button($, jointLabel).length, 0);
    else {
      assert.equal(button($, jointLabel).length, 1);
      assert.equal(button($, jointLabel).attr('disabled') !== undefined, scenario !== 'ready');
    }
    if (scenario === 'ready') {
      const academy = $('section[aria-label="Materiales asíncronos de Academy"]');
      assert.ok(academy.text().includes('Pendiente de revision QA'));
      assert.equal(academy.find('textarea').length, 1);
      assert.equal(button($, 'Aprobar').length, 1);
      assert.equal(button($, 'Rechazar').length, 1);
    }
    if (scenario === 'readonly') {
      assert.equal(button($, 'Aprobar').length, 0);
      assert.equal(button($, 'Rechazar').length, 0);
      assert.ok(panel.text().includes('requiere un usuario con permiso'));
    }
    if (scenario === 'approved') assert.ok(panel.text().includes('aprobados y vigentes'));
    console.log('PASS QA híbrido:', scenario);
  }
  const synchronous = load(render('synchronous'));
  assert.equal(button(synchronous, 'Aprobar materiales completos').length, 1, 'El síncrono puro conserva su aprobación');
  assert.equal(button(synchronous, 'Aprobar materiales completos').attr('disabled'), undefined);
  console.log('PASS QA síncrono puro');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
