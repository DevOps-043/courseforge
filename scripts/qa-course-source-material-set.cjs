// Flujo real con servidor/acciones simulados: no genera contenido ni toca datos remotos.
const assert=require('node:assert/strict');const{createServer}=require('node:http');const{createRequire}=require('node:module');
const{resolve}=require('node:path');const{readFileSync,mkdirSync}=require('node:fs');const{build}=require('esbuild');
const{compile}=require('@tailwindcss/node');const{Scanner}=require('@tailwindcss/oxide');
const puppeteer=createRequire(resolve('apps/web/tools/controlled-hyperframes/package.json'))('puppeteer');
async function main(){
 const output=resolve('.tmp/all-sources-ui');mkdirSync(output,{recursive:true});
 const compiler=await compile(readFileSync('apps/web/src/app/globals.css','utf8'),{base:resolve('apps/web/src/app'),onDependency(){}});
 const css=compiler.build(new Scanner({sources:[{base:resolve('apps/web/src/domains/course-sources'),pattern:'*.tsx',negated:false}]}).scan());
 const bundle=await build({bundle:true,write:false,outdir:resolve('.tmp/all-sources-ui-bundle'),format:'iife',platform:'browser',jsx:'automatic',tsconfig:resolve('apps/web/tsconfig.json'),
 plugins:[{name:'fronteras-simuladas',setup(b){
  b.onResolve({filter:/curation\/actions\/curation.actions$/},()=>({path:'actions',namespace:'qa'}));
  b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'qa'}));
  b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='navigation'?'export function useRouter(){return {refresh(){}}}':`export async function getCurationSnapshotAction(){return {success:true,curation:{state:'PHASE2_APPROVED'},rows:[{},{},{},{}]}} export async function startCurationAction(){throw Error('No se debe generar en esta prueba')}` }));
 }}],stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CourseSourceCuration}from'./apps/web/src/domains/course-sources/CourseSourceCuration';function App(){const[done,setDone]=useState(false);return <><CourseSourceCuration artifactId="10000000-0000-4000-8000-000000000001" onNext={()=>setDone(true)}><p>Flujo web histórico</p></CourseSourceCuration>{done&&<p>Materiales habilitados</p>}</>}createRoot(document.getElementById('root')).render(<App/>);`}});
 const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const state={policy:'DOCUMENTS_AND_WEB',configured:true,revision:3,approved:false,curriculumHash:'a'.repeat(32),planReady:true,canApprove:false,
  lessons:['one','two'].map((lesson,i)=>({id:lesson,title:`Lección ${i+1}`,webRequired:2,requirements:[{id:'objective',label:'Aplicar conocimientos'}]})),
  evidence:[1,2].map(n=>({id:id(n),type:'DOCUMENT',title:`Manual ${n}`,text:'Contenido procesado del manual'})).concat([3,4,5,6].map(n=>({id:id(n),type:'WEB',lessonId:n<5?'one':'two',title:`Fuente ${n}`,text:'Contenido validado de la investigación',sourceRef:`https://example.com/${n}`}))),associations:[]};
 let writes=0,fail=false;const errors=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return;}
  if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css+'\n'+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n'));return;}
  if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(req.method==='GET'){res.end(JSON.stringify(state));return;}
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);assert.deepEqual(body,{action:'use-all',expectedRevision:3,curriculumHash:'a'.repeat(32)});writes++;
   await new Promise(r=>setTimeout(r,300));if(fail){res.statusCode=413;res.end(JSON.stringify({message:'El conjunto completo supera el límite de contexto.'}));return;}
   res.end(JSON.stringify({consumptionMode:'ALL_VALIDATED',revision:3}));return;}
  res.end('<!doctype html><html class="dark" lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><body style="background:var(--engine-canvas);color:var(--engine-text)"><main id="root" style="max-width:1000px;margin:auto;padding:16px"></main><script src="/bundle.js"></script></body></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.setViewport({width:1366,height:950});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const ready=()=>page.waitForFunction(()=>document.body.textContent.includes('Fuentes del curso · Uso automático'));
  const click=label=>page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click(),label);
  await ready();assert.equal(await page.$$eval('select,input[type=checkbox]',nodes=>nodes.length),0);
  await page.evaluate(()=>[...document.querySelectorAll('summary')].find(s=>s.textContent.includes('Lección 1')).click());
  await page.waitForFunction(()=>document.querySelectorAll('details[open] ul li').length===4);
  assert.equal(await page.$$eval('details[open] ul li',nodes=>nodes.length),4);
  assert.deepEqual(await page.$$eval('details[open] ul li',nodes=>nodes.map(node=>node.textContent)),['Documento · Manual 1','Documento · Manual 2','Web · Fuente 3','Web · Fuente 4']);
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
  await click('Usar todas las fuentes y continuar a Materiales');await page.waitForFunction(()=>document.body.textContent.includes('Preparando fuentes…'));
  await page.waitForFunction(()=>document.body.textContent.includes('Materiales habilitados'));assert.equal(writes,1);
  fail=true;await click('Usar todas las fuentes y continuar a Materiales');await page.waitForFunction(()=>document.body.textContent.includes('El conjunto completo supera el límite de contexto.'));
  await page.setViewport({width:375,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
  state.policy='DOCUMENTS_ONLY';await page.reload();await ready();assert.equal(await page.$$eval('[aria-label="Búsqueda de fuentes web"]',nodes=>nodes.length),0);
  state.policy='WEB_ONLY';await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('Flujo web histórico'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({multipleSources:true,noManualSelection:true,continueVersioned:true,errorVisible:true,documentPolicyRespected:true,legacyWebUnchanged:true,mobileNoOverflow:true,externalRequests:false}));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
