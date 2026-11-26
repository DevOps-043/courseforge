const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { build } = require('esbuild');
const { load } = require('cheerio');
const { documentFixture } = require('../apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/__tests__/delivery-documents.fixture.js');

async function main() {
  const output = resolve('.tmp/production-review-ssr');
  await build({ bundle: true, write: true, outdir: output, format: 'cjs', platform: 'node', jsx: 'automatic', tsconfig: resolve('apps/web/tsconfig.json'), external: ['react','react-dom/server'], stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {DeliveryProductionReview} from './apps/web/src/domains/course-delivery/components/DeliveryProductionReview';
    export function render(controller){return renderToStaticMarkup(<DeliveryProductionReview controller={controller}/>)}
  ` } });
  const { render } = require(resolve(output,'stdin.js'));
  for (const state of ['approved','stale','pending','plan-pending','empty']) {
    const { workspace,id } = documentFixture();
    if(state==='stale')workspace.document.staleMaterials=[id];
    if(state==='pending')delete workspace.document.materials[id];
    if(state==='plan-pending')delete workspace.document.plans[id];
    if(state==='empty')workspace.document.agenda=[];
    const $=load(render({artifactId:id,snapshot:{workspace,readiness:{materialsReady:state==='approved'}}}));
    assert.equal($('[aria-label="Revisión de materiales síncronos"]').length,1);
    assert.equal($('a[target="_blank"]').length,0,'La revisión permanece dentro del curso');
    assert.equal($('a').length,3);
    $('a').each((_,node)=>{
      const href=$(node).attr('href');
      assert.ok(href.includes('download=1'));
      assert.equal(href.includes('draft=1'),state!=='approved');
    });
    if(state==='approved'){
      assert.equal($('[aria-label="Vista del material"] button').length,3);
      assert.equal($('[aria-label="Presentación"]').length,1);
      assert.ok($.text().includes('Visible'));
      assert.ok(!$.text().includes('RESERVADA'));
    }
    if(state==='stale')assert.ok($.text().includes('Requiere actualización'));
    if(state==='pending'||state==='plan-pending'){
      assert.ok($.text().includes('Falta generar el plan o los materiales'));
      assert.ok($.text().includes('0/1 sesiones'));
    }
    if(state==='empty')assert.ok($.text().includes('No hay sesiones disponibles'));
    console.log('PASS revisión integrada:',state);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
