// Fixture local para revisión por navegador: componentes reales, acciones simuladas.
const { createServer } = require('node:http');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { build } = require('esbuild');
const { compile } = require('@tailwindcss/node');
const { Scanner } = require('@tailwindcss/oxide');

async function main() {
  const compiler = await compile(readFileSync('apps/web/src/app/globals.css', 'utf8'), { base: resolve('apps/web/src/app'), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [
    { base: resolve('apps/web/src/domains/materials/components'), pattern: '*.tsx', negated: false },
    { base: resolve('apps/web/src/domains/course-delivery/components'), pattern: '*.tsx', negated: false },
  ] }).scan());
  const mocks = {
    'hooks/useMaterials': `export function useMaterials(){return window.review.academy} export function useMaterialStateStyles(){return {label:'Listo para QA',color:''}}`,
    'materials.service': `export const materialsService={getLessonComponents:async()=>[]}`,
    'pipeline-dirty-actions': `export async function dismissUpstreamDirtyAction(){}`,
    'DeliveryContentEditor': `export function DeliveryContentEditor(){return <p>Contenido de dos sesiones disponible para revisar.</p>}`,
    'DeliveryLivePanel': `export function DeliveryLivePanel(){return null}`,
    'DeliveryAgendaEditor': `export function DeliveryAgendaEditor(){return null}`,
    'DeliveryConfigurationFields': `export function DeliveryConfigurationFields(){return null}`,
    'HybridRouteEditor': `export function HybridRouteEditor(){return null}`,
    'MaterialDetailsModal': `export function MaterialDetailsModal(){return null}`,
  };
  const bundle = await build({ bundle: true, write: false, outdir: resolve('.tmp/hybrid-review-bundle'), format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: resolve('apps/web/tsconfig.json'),
    plugins: [{ name: 'acciones-simuladas', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(mocks).find(key => args.path.endsWith(key)); return key ? { path: key, namespace: 'qa' } : undefined; });
      builder.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }], stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {HybridMaterialsWorkspace} from './apps/web/src/domains/materials/components/HybridMaterialsWorkspace';
      let render; let approvals=0, rejections=0, conflict=false;
      const id='10000000-0000-4000-8000-000000000001';
      const lessons=[{id,lesson_title:'Priorización de tareas',module_id:'m',module_title:'Gestión del tiempo',state:'APPROVABLE',expected_components:[],iteration_count:1,max_iterations:4,oa_text:'Aplicar'}];
      const academy={materials:{state:'PHASE3_READY_FOR_QA',lessons},loading:false,isGenerating:false,isValidating:false,isApproved:false,isReadyForQA:true,isStartingGeneration:false,generationStuckInfo:null,error:null,actionError:null,
        refresh:async()=>{render()},startGeneration:async()=>{},validateMaterials:async()=>{},validateLesson:async()=>{},markLessonForFix:async()=>{},forceResetGeneration:async()=>{},runFixIteration:async()=>{},submitToQA:async()=>{},
        applyQADecision:async(decision)=>{if(decision==='REJECTED'){rejections++;academy.isReadyForQA=false;academy.materials.state='PHASE3_NEEDS_FIX';lessons[0].state='NEEDS_FIX'}else{academy.isApproved=true;academy.isReadyForQA=false;academy.materials.state='PHASE3_APPROVED'}render()}};
      const document={config:{mode:'HYBRID'},agenda:[{id,title:'Sesión de priorización',minutes:60}],materials:{[id]:{documents:{}}},staleMaterials:[]};
      const delivery={artifactId:id,busy:false,error:'',refresh:async()=>{},snapshot:{enabled:true,syllabusApproved:true,canReview:true,settings:[],lessons:[],readiness:{planReady:true,materialsReady:false},workspace:{revision:2,document},
        run:{id,operation:'MATERIALS',status:'COMPLETED',units:[{id,ready:true,attempts:1}]}},command:async(input)=>{
          if(input.action!=='APPROVE'||input.operation!=='MATERIALS')throw Error('Comando inesperado');
          approvals++;delivery.busy=true;render();await new Promise(resolve=>setTimeout(resolve,100));delivery.busy=false;
          if(conflict){render();throw Error('Las fuentes cambiaron. Actualiza los materiales antes de aprobar.')}
          delivery.snapshot.readiness.materialsReady=true;academy.isApproved=true;academy.isReadyForQA=false;academy.materials.state='PHASE3_APPROVED';render();return {success:true};
        }};
      window.review={academy};
      function reset(){conflict=false;delivery.busy=false;delivery.snapshot.canReview=true;document.staleMaterials=[];delivery.snapshot.readiness.materialsReady=false;
        academy.isApproved=false;academy.isReadyForQA=true;academy.materials.state='PHASE3_READY_FOR_QA';lessons[0].state='APPROVABLE';render()}
      function App(){const[,update]=React.useState(0);render=()=>update(value=>value+1);return <>
        <aside className='mb-4 space-x-3 rounded border p-3' aria-label='Escenarios simulados'>
          <p>Prueba local: sin generación ni aprobación remota. Aprobaciones conjuntas solicitadas: {approvals}. Rechazos Academy: {rejections}.</p>
          <button onClick={reset}>Preparar materiales listos</button>
          <button onClick={()=>{reset();conflict=true;render()}}>Simular conflicto de fuentes</button>
          <button onClick={()=>{reset();delivery.snapshot.canReview=false;render()}}>Simular usuario sin permiso</button>
          <button onClick={()=>{reset();document.staleMaterials=[id];render()}}>Simular Hub pendiente</button>
        </aside>
        <HybridMaterialsWorkspace artifactId={id} delivery={delivery} profile={{platform_role:delivery.snapshot.canReview?'ADMIN':'CONSTRUCTOR'}}/>
      </>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
    if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:");
    res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QA híbrido · prueba local</title><link rel="stylesheet" href="/style.css"><body style="background:var(--engine-canvas);color:var(--engine-text)"><main id="root" style="max-width:1080px;margin:auto;padding:16px"></main><script src="/bundle.js"></script></body></html>');
  }).listen(4319, '127.0.0.1', () => console.log('Fixture local: http://127.0.0.1:4319'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
