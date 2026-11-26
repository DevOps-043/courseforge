// Vista local de componentes reales con contenido de prueba; no llama proveedores.
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { build } = require('esbuild');
const { compile } = require('@tailwindcss/node');
const { Scanner } = require('@tailwindcss/oxide');
const { documentFixture } = require('../apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/__tests__/delivery-documents.fixture.js');

async function main() {
  const { workspace } = documentFixture();
  workspace.document.agenda[0].title = 'Sesión 1. Fundamentos y priorización inicial de tareas';
  workspace.document.config.mode = 'HYBRID';
  const compiler = await compile(readFileSync('apps/web/src/app/globals.css', 'utf8'), { base: resolve('apps/web/src/app'), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [{ base: resolve('apps/web/src/domains/course-delivery/components'), pattern: '*.tsx', negated: false }] }).scan());
  const bundle = await build({ bundle: true, write: false, outdir: resolve('.tmp/production-flow-ui'), format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: resolve('apps/web/tsconfig.json'), stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {DeliveryProductionReview} from './apps/web/src/domains/course-delivery/components/DeliveryProductionReview';
    const initial=${JSON.stringify(workspace)};
    function App(){ const [workspace,setWorkspace]=React.useState(initial); const controller={artifactId:initial.artifact_id,snapshot:{workspace,readiness:{materialsReady:!workspace.document.staleMaterials.length}}};
      return <><p>Prueba local · datos simulados · sin generación ni cambios remotos</p><h1>Gestión del tiempo · Producción</h1>
      <button onClick={()=>setWorkspace({...initial,document:{...initial.document,staleMaterials:initial.document.agenda.map(item=>item.id)}})}>Simular material desactualizado</button>
      <section style={{padding:24,border:'1px solid var(--engine-border)',borderRadius:16,marginTop:20}}><h2>Síncronos · Hub</h2><DeliveryProductionReview controller={controller}/></section></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` } });
  createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text); return; }
    if (request.url === '/style.css') { response.setHeader('Content-Type','text/css'); response.end(css+bundle.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n')); return; }
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:");
    response.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Prueba local · Revisión de producción</title><link rel="stylesheet" href="/style.css"><body style="background:var(--engine-canvas);color:var(--engine-text)"><main id="root" style="max-width:1050px;margin:auto;padding:24px"></main><script src="/bundle.js"></script></body></html>');
  }).listen(4321,'127.0.0.1',()=>console.log('Prueba local: http://127.0.0.1:4321'));
}
main().catch(error=>{console.error(error);process.exitCode=1});
