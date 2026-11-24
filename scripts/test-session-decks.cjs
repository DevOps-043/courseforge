const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { build } = require('esbuild');
const { readFileSync, writeFileSync } = require('node:fs');
const { load } = require('cheerio');
const { documentFixture } = require('../apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/__tests__/delivery-documents.fixture.js');
const { deliveryHash } = require('../apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/lib/delivery-hash.js');

async function main() {
  const output = resolve('.tmp/session-deck-api.cjs');
  await build({ entryPoints: ['apps/web/src/app/api/artifacts/[artifactId]/delivery/sessions/[sessionId]/deck/route.ts'], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', tsconfig: 'apps/web/tsconfig.json',
    plugins: [{ name: 'fronteras-de-prueba', setup(build) {
      build.onResolve({ filter: /delivery-access$/ }, () => ({ path: 'access', namespace: 'fixture' }));
      build.onResolve({ filter: /delivery-repository$/ }, () => ({ path: 'repository', namespace: 'fixture' }));
      build.onResolve({ filter: /delivery-enabled$/ }, () => ({ path: 'enabled', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'access' ? `
        export class DeliveryAccessError extends Error { constructor(message,status){super(message);this.status=status} }
        export async function requireDeliveryAccess(id){
          if(global.fixture.denied)throw new DeliveryAccessError('Acceso denegado.',403);
          if(id!==global.fixture.workspace.artifact_id)throw new DeliveryAccessError('Curso ajeno.',404);
          return {tenant:{organizationId:global.fixture.workspace.organization_id,userId:global.fixture.workspace.organization_id},admin:global.admin};
        }` : path === 'repository' ? `
        export async function readDeliveryWorkspace(){return structuredClone(global.fixture.workspace)}
        export async function readDeliveryContext(){return structuredClone(global.fixture.context)}` : `export function deliveryEnabled(){return true}` }));
    } }],
  });
  const route = require(output);
  global.fixture = documentFixture();
  const { workspace, id, material } = global.fixture;
  material.slides[0].points = ['Compara el impacto y la urgencia de las tareas antes de reservar tiempo de concentración en la agenda.'];
  workspace.document.materialsApproval.content = deliveryHash(workspace.document.materials);
  const assets = new Map();
  let insertions = 0;
  global.admin = { from(table) {
    assert.equal(table, 'production_assets');
    const filters = {};
    return { select() { return this; }, eq(key,value) { filters[key]=value; return this; },
      async maybeSingle() {
        const row = assets.get(filters.id);
        return { data: row && Object.entries(filters).every(([key,value])=>row[key]===value) ? row : null, error:null };
      }, async upsert(row, options) {
        assert.equal(options.ignoreDuplicates,true);
        if(!assets.has(row.id)){assets.set(row.id,structuredClone(row));insertions++;}
        return {error:null};
      } };
  } };
  const context = (sessionId=id) => ({params:Promise.resolve({artifactId:id,sessionId})});
  const request = (method='GET', query='', body) => new Request(`https://example.test/api/deck${query}`, {method,
    ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const post = () => route.POST(request('POST','',{revision:workspace.revision}),context());
  assert.equal((await (await route.GET(request(),context())).json()).deck,null);
  const [first,repeated] = await Promise.all([post(),post()]);
  assert.equal(first.status,200); assert.equal(repeated.status,200);
  const deck=(await first.json()).deck;
  assert.equal(deck.status,'READY'); assert.equal(insertions,1);
  assert.equal((await (await route.GET(request(),context())).json()).deck.id,deck.id);
  const preview = await route.GET(request('GET','?preview=1'),context());
  assert.equal(preview.status,200); assert.match(await preview.text(),/section class="slide/);
  assert.equal((await route.GET(request('GET','?download=1'),context())).headers.get('Content-Disposition').startsWith('attachment'),true);
  assert.equal((await route.POST(request('POST','',{revision:99}),context())).status,409);
  assert.equal((await route.GET(request(),context('10000000-0000-4000-8000-000000000002'))).status,404);
  global.fixture.denied=true;
  assert.equal((await post()).status,403);
  global.fixture.denied=false;
  const stored=assets.get(deck.id); const originalHtml=stored.content.html;
  stored.content.html='<script>alert(1)</script>';
  assert.equal((await route.GET(request('GET','?preview=1'),context())).status,409);
  stored.content.html=originalHtml;
  workspace.document.materialsApproval=null;
  assert.equal((await route.GET(request('GET','?preview=1'),context())).status,409);
  console.log('PASS API: producción concurrente, recuperación, preview, descarga, revisión, sesión ajena, acceso, integridad y aprobación');
  const next=documentFixture(); global.fixture=next;
  next.workspace.document.materialsApproval.content=deliveryHash(next.workspace.document.materials);
  const failed=await route.POST(request('POST','',{revision:next.workspace.revision}),context());
  assert.equal(failed.status,200); assert.equal((await failed.json()).deck.status,'QA_FAILED');
  assert.equal((await route.GET(request('GET','?preview=1'),context())).status,422);
  assert.equal((await route.GET(request('GET','?download=1'),context())).status,422);
  console.log('PASS API: QA bloqueante conserva diagnóstico y no permite utilizar o descargar el deck');
  await build({ bundle:true, outfile:resolve('.tmp/session-deck-view.cjs'), format:'cjs', platform:'node', jsx:'automatic',
    tsconfig:'apps/web/tsconfig.json', external:['react','react-dom/server'], stdin:{ loader:'tsx',resolveDir:process.cwd(),contents:`
      import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {DeliverySessionDeckView} from './apps/web/src/domains/course-delivery/components/DeliverySessionDeck';
      export function render(props){return renderToStaticMarkup(<DeliverySessionDeckView {...props}/>)}
    ` } });
  const {render}=require(resolve('.tmp/session-deck-view.cjs'));
  for(const state of ['pending','loading','error','ready','qa-failed','unapproved']){
    const props={approved:state!=='unapproved',busy:state==='loading',error:state==='error'?'Fallo recuperable':'',
      deck:state==='ready'?deck:state==='qa-failed'?{...deck,status:'QA_FAILED',qa:{...deck.qa,status:'FAIL',findings:[{code:'insufficient_slide_explanation',severity:'error',message:'Contenido insuficiente'}]}}:null,
      endpoint:'/api/deck',onGenerate:()=>{}};
    const $=load(render(props));
    assert.equal($('iframe').length,state==='ready'?1:0);
    assert.equal($('a').length,state==='ready'?1:0);
    if(state==='ready'){
      assert.equal($('iframe').attr('sandbox'),'allow-scripts');
      $('iframe').removeAttr('src').attr('srcdoc',originalHtml);
      const css=readFileSync(resolve('.tmp/session-deck-view.css'),'utf8');
      writeFileSync(resolve('.tmp/session-deck-visual.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><title>QA local · Presentación de sesión</title><style>${css}
        body{font:16px system-ui;margin:32px auto;max-width:1100px;padding:0 20px;color:#10243a;background:#f3f7f8}section{background:white;padding:24px;border-radius:16px}button,a{padding:10px;border:1px solid #cbd5e1;border-radius:8px}iframe{width:100%;aspect-ratio:16/9}h1{font-size:24px}
        </style><h1>Producción · Presentación de la sesión</h1><p>Prueba local con contenido ficticio · sin proveedores ni cambios en staging</p>${$('body').html()}</html>`);
    }
    if(state==='qa-failed')assert.match($.text(),/Contenido insuficiente/);
    if(state==='error')assert.equal($('[role=alert]').length,1);
  }
  console.log('PASS UI: pendiente, carga, error, deck listo, QA rechazado y materiales sin aprobar');
}
main().catch(error=>{console.error(error);process.exitCode=1});
