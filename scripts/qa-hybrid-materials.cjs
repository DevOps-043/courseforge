// Interfaz real con motores simulados; sin credenciales ni llamadas de generación.
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {createRequire}=require('node:module');
const {resolve}=require('node:path');
const {readFileSync,mkdirSync}=require('node:fs');
const {build}=require('esbuild');
const {compile}=require('@tailwindcss/node');
const {Scanner}=require('@tailwindcss/oxide');
const puppeteer=createRequire(resolve('apps/web/tools/controlled-hyperframes/package.json'))('puppeteer');
async function main(){
  const output=resolve('.tmp/hybrid-materials-qa');mkdirSync(output,{recursive:true});
  const compiler=await compile(readFileSync('apps/web/src/app/globals.css','utf8'),{base:resolve('apps/web/src/app'),onDependency(){}});
  const css=compiler.build(new Scanner({sources:[{base:resolve('apps/web/src/domains/materials/components'),pattern:'*.tsx',negated:false},{base:resolve('apps/web/src/domains/course-delivery/components'),pattern:'*.tsx',negated:false}]}).scan());
  const hooks=`import React from 'react';export function useMaterials(){return window.qa.academy} export function useMaterialStateStyles(){return {label:'Generando',color:'bg-blue-100 text-blue-800'}}`;
  const mocks={
    'hooks/useMaterials':hooks,
    'materials.service':`export const materialsService={getLessonComponents:async()=>[]}`,
    'pipeline-dirty-actions':`export async function dismissUpstreamDirtyAction(){}`,
    'DeliveryContentEditor':`export function DeliveryContentEditor(){return null}`,
    'DeliveryLivePanel':`export function DeliveryLivePanel(){return null}`,
    'DeliveryAgendaEditor':`export function DeliveryAgendaEditor(){return null}`,
    'DeliveryConfigurationFields':`export function DeliveryConfigurationFields(){return null}`,
    'HybridRouteEditor':`export function HybridRouteEditor(){return null}`,
    'MaterialDetailsModal':`export function MaterialDetailsModal(){return null}`,
  };
  const bundle=await build({bundle:true,write:false,outdir:resolve('.tmp/hybrid-material-bundle'),format:'iife',platform:'browser',jsx:'automatic',tsconfig:resolve('apps/web/tsconfig.json'),plugins:[{name:'motores-simulados',setup(b){
    b.onResolve({filter:/.*/},args=>{const key=Object.keys(mocks).find(key=>args.path.endsWith(key));return key?{path:key,namespace:'qa'}:undefined;});
    b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}],stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';import{createRoot}from'react-dom/client';import{HybridMaterialsWorkspace}from'./apps/web/src/domains/materials/components/HybridMaterialsWorkspace';
    const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';let render;
    const lessons=[{id:first,lesson_title:'Lección con fallo',module_id:'m1',module_title:'Módulo',state:'NEEDS_FIX',expected_components:['READING'],iteration_count:1,max_iterations:4,oa_text:'Aplicar'}, {id:second,lesson_title:'Otra lección activa',module_id:'m1',module_title:'Módulo',state:'GENERATING',expected_components:['READING'],iteration_count:1,max_iterations:4,oa_text:'Aplicar'}];
    window.qa={hubCalls:0,academyCalls:0,retries:0,academy:{materials:null,loading:false,isGenerating:false,isValidating:false,isApproved:false,isReadyForQA:false,isStartingGeneration:false,generationStuckInfo:null,error:null,actionError:null,
      startGeneration:async()=>{window.qa.academyCalls++;window.qa.academy.materials={state:'PHASE3_GENERATING',lessons};window.qa.academy.isGenerating=true;render()},
      runFixIteration:async(id)=>{window.qa.retries++;lessons.find(x=>x.id===id).state='GENERATING';render()},refresh:async()=>{},validateLesson:async()=>{},markLessonForFix:async()=>{},forceResetGeneration:async()=>{}}};
    const delivery={artifactId:'course',busy:false,error:'',refresh:async()=>{},snapshot:{enabled:true,syllabusApproved:true,canReview:false,settings:[],lessons:[],readiness:{planReady:true,materialsReady:false},workspace:{revision:1,document:{config:{mode:'HYBRID'},agenda:[{id:first,title:'Sesión pendiente'}]}},run:null},command:async()=>{window.qa.hubCalls++;delivery.error='Fallo simulado al iniciar Hub';render();throw Error('Fallo simulado')}};
    window.qa.setHubState=(status)=>{delivery.error='';delivery.snapshot.run={id:first,operation:'MATERIALS',status,retry_units:[],units:[{id:first,ready:status==='COMPLETED',error:status==='FAILED'?'UNSUPPORTED_OUTPUT':undefined,retryable:status==='FAILED'?false:true,attempts:1,generating:status==='RUNNING'}]};render()};
    const root=createRoot(document.getElementById('root'));function App(){const[,update]=React.useState(0);render=()=>update(x=>x+1);return <HybridMaterialsWorkspace artifactId='course' delivery={delivery}/>};root.render(<App/>);`}});
  const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return}if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n'));return}res.end('<!doctype html><html lang="es" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><body style="background:var(--engine-canvas);color:var(--engine-text)"><main id="root" style="max-width:1080px;margin:auto;padding:16px"></main><script src="/bundle.js"></script></body></html>')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
    await page.setViewport({width:1280,height:900});await page.goto('http://127.0.0.1:'+server.address().port);
    const click=text=>page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text)).click(),text);
    await page.waitForFunction(()=>document.body.textContent.includes('Generar materiales pendientes'));await click('Generar materiales pendientes');
    await page.waitForFunction(()=>window.qa.hubCalls===1&&window.qa.academyCalls===1);await page.waitForFunction(()=>document.body.textContent.includes('Uno de los destinos no pudo iniciar'));
    await click('Asíncronos · Academy');await click('Lección con fallo');await page.screenshot({path:resolve(output,'academy-before-retry.png'),fullPage:true});await click('Reintentar pendientes');await page.waitForFunction(()=>window.qa.retries===1);
    assert.equal(await page.evaluate(()=>window.qa.academy.isGenerating),true);assert.equal(await page.evaluate(()=>window.qa.academy.materials.lessons[1].state),'GENERATING');
    await page.screenshot({path:resolve(output,'academy-running-retry.png'),fullPage:true});await click('Síncronos · Hub');assert.equal(await page.evaluate(()=>window.qa.academyCalls),1);
    for(const [state,label] of Object.entries({RUNNING:'Generando materiales síncronos',QUEUED:'Generación síncrona en cola',FAILED:'Generación síncrona finalizada con errores',COMPLETED:'Generación síncrona completada',PAUSED:'Generación síncrona en pausa',CANCELLED:'Generación síncrona cancelada'})){
      await page.evaluate(state=>window.qa.setHubState(state),state);await page.waitForFunction(label=>document.body.textContent.includes(label),{},label);
      if(state==='FAILED'){
        assert.equal(await page.$eval('[data-run-state=FAILED]',node=>node.getAttribute('role')),'alert');
        assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Reanudar pendientes').disabled),true);
        await page.screenshot({path:resolve(output,'hub-failed.png'),fullPage:true});
      }
      if(state==='COMPLETED')await page.screenshot({path:resolve(output,'hub-completed.png'),fullPage:true});
    }
    await page.evaluate(()=>window.qa.setHubState('FAILED'));
    await page.setViewport({width:375,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));await page.setViewport({width:1280,height:900});await page.screenshot({path:resolve(output,'light.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({independentStartFailure:true,academyContinues:true,retryWhileOtherLessonRunning:true,panelsRemainMounted:true,allSixHubStatesVisible:true,failedIsAlert:true,nonRetryableResumeDisabled:true,mobileNoOverflow:true,externalRequests:false}));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
