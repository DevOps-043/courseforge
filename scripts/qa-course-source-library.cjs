// Componentes React reales y CSS del producto; APIs sintéticas sin datos tenant ni red externa.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { existsSync, readFileSync, mkdirSync } = require('node:fs');
const { build } = require('esbuild');
const { compile } = require('@tailwindcss/node');
const { Scanner } = require('@tailwindcss/oxide');
const puppeteer = createRequire(resolve('apps/web/tools/controlled-hyperframes/package.json'))('puppeteer');
const course = '10000000-0000-4000-8000-000000000001';
const original = '20000000-0000-4000-8000-000000000001';
const successor = '20000000-0000-4000-8000-000000000002';
const orphan = '20000000-0000-4000-8000-000000000003';
const root = `/api/artifacts/${course}/sources`;
async function main() {
  const output = resolve(process.env.COURSE_SOURCE_QA_OUTPUT || 'openspec/changes/course-owned-document-sources/reports/qa'); mkdirSync(output, { recursive: true });
  const compiler = await compile(readFileSync('apps/web/src/app/globals.css', 'utf8'), { base: resolve('apps/web/src/app'), onDependency() {} });
  const scanner = new Scanner({ sources: [{ base: resolve('apps/web/src/domains/course-sources'), pattern: '*.tsx', negated: false }] });
  const css = compiler.build(scanner.scan());
  const component = resolve('apps/web/src/domains/course-sources/CourseSourceLibrary.tsx').replaceAll('\\', '/');
  const bundle = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    tsconfig: resolve('apps/web/tsconfig.json'), stdin: { loader: 'tsx', resolveDir: process.cwd(), contents:
      `import React from 'react';import{createRoot}from'react-dom/client';import{CourseSourceLibrary}from'${component}';createRoot(document.getElementById('root')).render(<CourseSourceLibrary artifactId='${course}'/>);` } });
  let documents = [{ id: original, filename: 'Manual corporativo con procedimientos y criterios de seguridad.txt', status: 'READY', supersedesId: null }];
  const requests = []; let failList = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/style.css') { response.setHeader('Content-Type','text/css'); response.end(css); return; }
    if (url.pathname.startsWith('/api/') || url.pathname === '/upload') {
      let raw = ''; for await (const part of request) raw += part;
      const body = request.headers['content-type']?.startsWith('application/json') ? JSON.parse(raw) : null;
      requests.push({ method: request.method, path: url.pathname, body });
      response.setHeader('Content-Type','application/json');
      if (url.pathname === root) {
        if (failList) { response.statusCode=503; response.end(JSON.stringify({message:'Indisponibilidad simulada'})); return; }
        response.end(JSON.stringify({ documents })); return;
      }
      if(url.pathname.endsWith('/review')) {response.end(JSON.stringify({configured:true,policy:null,revision:0,approved:false,curriculumHash:'a'.repeat(32),planReady:false,lessons:[],evidence:[],associations:[]}));return;}
      if(url.pathname.endsWith('/legacy')) {
        response.end(JSON.stringify(request.method==='GET'?{sources:[{id:original,kind:'SYLLABUS_DOCUMENT',title:'Temario histórico.pdf',diagnostic:'El original no está disponible. Se creará un TXT derivado.'}]}:{document:documents[0],originalAvailable:false}));return;
      }
      if (url.pathname.endsWith('/uploads')) {
        assert.equal(body.supersedesId,original);
        documents.push({id:successor,filename:body.filename,status:'RESERVED',supersedesId:body.supersedesId});
        response.end(JSON.stringify({ document:documents[1],upload:{signedUrl:'/upload'} })); return;
      }
      if (url.pathname.endsWith('/confirm')) documents[1].status='UPLOADED';
      if (url.pathname.endsWith(`/documents/${successor}`) && request.method==='POST') { documents[1].status='READY';documents[0].status='RETIRED'; }
      if (url.pathname.endsWith('/reconciliation')) {
        if(body.action==='inspect') response.end(JSON.stringify({observations:[{documentId:orphan,observation:'PRESENT'}]}));
        else { assert.equal(body.confirmDocumentId,orphan); response.end(JSON.stringify({purged:true})); } return;
      }
      if(url.pathname.includes('/documents/') && request.method==='GET') {
        const lastPage = url.searchParams.get('from') === '40';
        response.end(JSON.stringify({fragments:[{text_content:lastPage
          ? 'Sección final verificada.' : 'Texto documental <script>sin ejecutar</script>.'}],nextOrdinal:lastPage?null:40}));
        return;
      }
      response.end('{}'); return;
    }
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><body><main id="root" style="max-width:900px;margin:24px auto;padding:12px"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done)); let browser;
  try {
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    assert.ok(chrome,'Se requiere un navegador local.');
    browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--disable-background-networking'],timeout:20000});
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);page.on('request',request=>new URL(request.url()).hostname==='127.0.0.1'?request.continue():request.abort());
    const url=`http://127.0.0.1:${server.address().port}`;
    await page.setViewport({width:1440,height:1000});await page.goto(url);
    await page.waitForSelector('summary');await page.click('summary');await page.waitForFunction(()=>document.body.textContent.includes('Sustituir archivo'));
    const clickText=async text=>page.evaluate(label=>[...document.querySelectorAll('button')].find(button=>button.textContent===label).click(),text);
    await clickText('Ver texto');await page.waitForSelector('pre');assert.equal(await page.$eval('pre',element=>element.textContent.includes('<script>')),true);
    await clickText('Siguiente');await page.waitForFunction(()=>document.querySelector('pre')?.textContent.includes('Sección final'));
    await clickText('Anterior');await page.waitForFunction(()=>document.querySelector('pre')?.textContent.includes('<script>'));
    await clickText('Cerrar texto');await clickText('Sustituir archivo');
    const file=await page.$('input[type=file]');
    await file.uploadFile(resolve('apps/web/src/domains/course-sources/course-source-policy.ts'));
    // El formato rechazado no llega a reservas.
    await page.waitForFunction(()=>document.body.textContent.includes('Archivo no compatible') && !document.querySelector('input[type=file]').disabled);
    assert.equal(requests.some(request=>request.path.endsWith('/uploads')),false);
    const { writeFileSync }=require('node:fs');const fixture=resolve('.tmp/course-source-qa.txt');writeFileSync(fixture,'Procedimiento interno de seguridad. '.repeat(20));
    await file.uploadFile(fixture);
    await page.waitForFunction(()=>document.body.textContent.includes('sustituye'));
    await page.reload();await page.waitForSelector('summary');await page.click('summary');await page.waitForFunction(()=>document.body.textContent.includes('sustituye'));
    assert.equal(await page.$$eval('[aria-label="Versiones documentales"] li',items=>items.length),2);
    await clickText('Consultar fuentes históricas');await page.waitForFunction(()=>document.body.textContent.includes('Temario histórico.pdf'));
    page.once('dialog',dialog=>dialog.accept());await clickText('Importar a la biblioteca');
    await page.waitForFunction(()=>document.body.textContent.includes('TXT derivado importado'));
    await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
    await page.setViewport({width:375,height:900});await page.evaluate(()=>document.documentElement.classList.add('dark'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'La biblioteca no debe desbordar en móvil.');
    await page.screenshot({path:resolve(output,'mobile-dark.png'),fullPage:true});
    await page.evaluate(()=>[...document.querySelectorAll('summary')].find(element=>element.textContent==='Administrar cargas abandonadas').click());
    await clickText('Conciliar sin borrar');await page.waitForFunction(()=>document.body.textContent.includes('Objeto presente'));
    page.once('dialog',dialog=>dialog.accept(orphan));await clickText('Autorizar purga de esta carga');
    await page.waitForFunction(()=>document.body.textContent.includes('Purga confirmada'));
    assert.ok(requests.some(request=>request.body?.action==='purge'));
    failList=true;await page.reload();await page.waitForSelector('summary');await page.click('summary');await page.waitForFunction(()=>document.body.textContent.includes('Biblioteca no disponible'));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({replacement:true,reloadHistory:true,textEscaped:true,rejectedFormat:true,legacyImport:true,reconciliation:true,explicitPurgeConfirmation:true,mobileNoOverflow:true,externalRequests:false,screenshots:output}));
  } finally {if(browser)await browser.close();await new Promise(done=>server.close(done));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
