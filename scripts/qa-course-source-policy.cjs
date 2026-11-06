// UI real, API sintética, CSS del producto y navegador local sin red externa.
const assert=require('node:assert/strict');const{createServer}=require('node:http');
const{createRequire}=require('node:module');const{resolve}=require('node:path');const{existsSync,readFileSync,mkdirSync}=require('node:fs');
const{build}=require('esbuild');const{compile}=require('@tailwindcss/node');const{Scanner}=require('@tailwindcss/oxide');
const puppeteer=createRequire(resolve('apps/web/tools/controlled-hyperframes/package.json'))('puppeteer');
async function main(){
  const output=resolve(process.env.COURSE_SOURCE_QA_OUTPUT || 'openspec/changes/course-owned-document-sources/reports/qa-phase3');mkdirSync(output,{recursive:true});
  const compiler=await compile(readFileSync('apps/web/src/app/globals.css','utf8'),{base:resolve('apps/web/src/app'),onDependency(){}});
  const css=compiler.build(new Scanner({sources:[{base:resolve('apps/web/src/domains/course-sources'),pattern:'*.tsx',negated:false}]}).scan());
  const component=resolve('apps/web/src/domains/course-sources/CourseSourceReviewPanel.tsx').replaceAll('\\','/');
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:resolve('apps/web/tsconfig.json'),stdin:{loader:'tsx',resolveDir:process.cwd(),contents:
    `import React from'react';import{createRoot}from'react-dom/client';import{CourseSourceReviewPanel}from'${component}';createRoot(document.getElementById('root')).render(<CourseSourceReviewPanel artifactId='10000000-0000-4000-8000-000000000001'/>);`}});
  const document='20000000-0000-4000-8000-000000000001';const requests=[];
  const state={configured:true,policy:null,revision:0,approved:false,curriculumHash:'a'.repeat(32),planReady:true,
    lessons:[{id:'lesson',title:'Seguridad y permisos',webRequired:2,requirements:[{id:'objective',label:'Verificar identidad'},{id:'topic:0',label:'Control de permisos'}]}],
    evidence:[{id:document,type:'DOCUMENT',title:'Manual interno',text:'Verificar identidad y control de permisos mediante validación de roles.'}],associations:[]};
  let malformed=false;
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0].text);return;}
    if(url.pathname==='/style.css'){response.setHeader('Content-Type','text/css');response.end(css);return;}
    if(url.pathname.includes('/api/')){
      response.setHeader('Content-Type','application/json');if(request.method==='GET'){response.end(JSON.stringify(malformed?{}:state));return;}
      let raw='';for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
      if(body.action==='propose'){response.end(JSON.stringify({associations:state.lessons[0].requirements.map(item=>({lessonId:'lesson',evidenceType:'DOCUMENT',evidenceId:document,requirementIds:[item.id],verified:false,conflict:false,resolution:''}))}));return;}
      if(body.expectedRevision!==state.revision){response.statusCode=409;response.end(JSON.stringify({message:'La revisión cambió. Actualiza antes de guardar.'}));return;}
      if(body.action==='policy'){state.policy=body.policy;state.revision++;state.associations=[];state.approved=false;}
      if(body.action==='save'){state.associations=body.associations;state.revision++;state.approved=false;}
      if(body.action==='approve'){assert.ok(state.associations.every(item=>item.verified));state.approved=true;}
      response.end(JSON.stringify({revision:state.revision}));return;
    }
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><body><main id="root" style="max-width:900px;margin:24px auto;padding:12px"></main><script src="/bundle.js"></script></body></html>');
  });await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
  try{
    const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser=await puppeteer.launch({executablePath,headless:true,args:['--disable-background-networking'],timeout:20000});
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);page.on('request',request=>new URL(request.url()).hostname==='127.0.0.1'?request.continue():request.abort());
    await page.setViewport({width:1440,height:1100});const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
    await page.waitForFunction(()=>document.body.textContent.includes('Debes elegir'));
    assert.equal(await page.$$eval('input[type=radio]:checked',items=>items.length),0);
    const click=async label=>page.evaluate(label=>[...document.querySelectorAll('button')].find(button=>button.textContent===label).click(),label);
    await page.click('input[value=DOCUMENTS_ONLY]');page.once('dialog',dialog=>dialog.accept());await click('Guardar política');
    await page.waitForFunction(()=>document.body.textContent.includes('Revisión 1'));
    await click('Proponer asociaciones');await page.waitForSelector('input[type=checkbox]');
    assert.equal(await page.$eval('button:last-of-type',()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Aprobar cobertura guardada').disabled),true);
    await page.click('input[type=checkbox]');
    await page.evaluate(()=>document.querySelectorAll('input[type=checkbox]')[1].click());
    await page.waitForSelector('input:not([type])');await page.type('input:not([type])','Se aplica el procedimiento vigente del manual interno.');
    await page.evaluate(()=>{const inputs=document.querySelectorAll('input[type=checkbox]');inputs[0].click();inputs[2].click();});
    await click('Guardar revisión');await page.waitForFunction(()=>document.body.textContent.includes('Revisión 2'));
    await click('Aprobar cobertura guardada');await page.waitForFunction(()=>document.body.textContent.includes('Cobertura aprobada y versionada'));
    await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('Aprobada'));
    assert.equal(await page.$eval('input[value=DOCUMENTS_ONLY]',input=>input.checked),true);
    await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
    await page.setViewport({width:375,height:900});await page.evaluate(()=>document.documentElement.classList.add('dark'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sin desbordamiento móvil');
    await page.screenshot({path:resolve(output,'mobile-dark.png'),fullPage:true});
    state.revision++;await click('Guardar revisión');await page.waitForFunction(()=>document.body.textContent.includes('La revisión cambió'));
    malformed=true;await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('La configuración de fuentes no está disponible'));
    assert.deepEqual(errors,[]);assert.ok(requests.some(item=>item.action==='approve'));
    console.log(JSON.stringify({noPreselection:true,persistedPolicy:true,unverifiedProposals:true,conflictResolution:true,reviewApproval:true,reload:true,staleRevisionRejected:true,mobileNoOverflow:true,externalRequests:false}));
  }finally{if(browser)await browser.close();await new Promise(done=>server.close(done));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
