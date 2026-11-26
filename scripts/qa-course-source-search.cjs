// Componentes reales y acciones de servidor simuladas; sin generación ni datos remotos.
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
  const output=resolve('.tmp/source-search-qa');mkdirSync(output,{recursive:true});
  const compiler=await compile(readFileSync('apps/web/src/app/globals.css','utf8'),{base:resolve('apps/web/src/app'),onDependency(){}});
  const css=compiler.build(new Scanner({sources:[{base:resolve('apps/web/src/domains/course-sources'),pattern:'*.tsx',negated:false}]}).scan());
  const bundle=await build({bundle:true,write:false,outdir:resolve('.tmp/source-search-bundle'),format:'iife',platform:'browser',jsx:'automatic',tsconfig:resolve('apps/web/tsconfig.json'),
    plugins:[{name:'acciones-simuladas',setup(b){b.onResolve({filter:/curation\/actions\/curation.actions$/},()=>({path:'actions',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:`export async function getCurationSnapshotAction(){return (await fetch('/qa/state')).json()} export async function startCurationAction(){return (await fetch('/qa/start',{method:'POST'})).json()}` }));}}],
    stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{CourseSourceSearchStatus}from'./apps/web/src/domains/course-sources/CourseSourceSearchStatus';createRoot(document.getElementById('root')).render(<CourseSourceSearchStatus artifactId="qa-course" planReady={true} approved={false}/>);`}});
  let state=null,count=0,starts=0,fail=false,failRead=false;
  const server=createServer(async(req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);return;}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css+'\n'+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n'));return;}
    if(req.url==='/qa/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(failRead?{success:false,error:'No se pudo verificar temporalmente el acceso.'}:{success:true,curation:state?{state,attempt_number:1,qa_decision:null}:null,rows:Array.from({length:count},()=>({}))}));return;}
    if(req.url==='/qa/start'){starts++;await new Promise(r=>setTimeout(r,500));res.setHeader('Content-Type','application/json');if(fail){res.end(JSON.stringify({success:false,error:'Fallo de prueba al iniciar'}));return;}state='PHASE2_GENERATING';res.end(JSON.stringify({success:true}));return;}
    res.end('<!doctype html><html lang="es" class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><body style="background:var(--engine-canvas)"><main id="root" style="max-width:900px;margin:auto;padding:16px"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);page.on('request',r=>new URL(r.url()).hostname==='127.0.0.1'?r.continue():r.abort());
    await page.setViewport({width:1280,height:900});await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.body.textContent.includes('Todavía no se ha iniciado'));
    const click=label=>page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click(),label);
    await click('Buscar fuentes web para vacíos documentales');await page.waitForFunction(()=>document.body.textContent.includes('Iniciando búsqueda'));
    await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Búsqueda en curso…');if(!button.disabled)throw Error('Inicio duplicado habilitado');button.click()});
    await page.waitForFunction(()=>document.body.textContent.includes('Buscando fuentes web…'));assert.equal(starts,1);
    await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('Buscando fuentes web…'));
    await page.screenshot({path:resolve(output,'running.png'),fullPage:true});
    failRead=true;await click('Consultar estado');await page.waitForFunction(()=>document.body.textContent.includes('No se pudo consultar el estado actual'));
    assert.equal(await page.$eval('section',element=>element.getAttribute('aria-busy')),'false');
    assert.equal(await page.$$eval('[aria-hidden=true]',nodes=>nodes.length),0);
    assert.equal(starts,1);await page.screenshot({path:resolve(output,'unavailable.png'),fullPage:true});
    failRead=false;await click('Consultar estado');await page.waitForFunction(()=>!document.body.textContent.includes('No se pudo consultar el estado actual'));
    state='PHASE2_READY_FOR_QA';count=3;
    await page.waitForFunction(()=>document.body.textContent.includes('Fuentes listas para revisar')&&document.body.textContent.includes('3 registros'),{timeout:10000});
    await page.setViewport({width:375,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:resolve(output,'completed-mobile.png'),fullPage:true});
    state='PHASE2_BLOCKED';await click('Consultar estado');await page.waitForFunction(()=>document.body.textContent.includes('requiere atención'));
    fail=true;await click('Completar búsqueda de fuentes pendientes');await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('Fallo de prueba'));
    assert.deepEqual(errors,[]);console.log(JSON.stringify({immediateFeedback:true,duplicateStartBlocked:true,persistedRunAfterReload:true,queryFailureNotReportedAsRunning:true,queryRecovery:true,polledCompletion:true,blockedState:true,startFailureVisible:true,mobileNoOverflow:true,externalRequests:false}));
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
