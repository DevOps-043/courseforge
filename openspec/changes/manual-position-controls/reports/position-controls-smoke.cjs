// Ejecutar desde la raíz después de compilar tsconfig.hyperframes-test.json.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { build } = require('esbuild');
const { launchCompositionQaBrowser } = require('../../../../apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/qa/composition-qa-browser.js');

async function main() {
  const bundle = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CompositionPositionControls} from '@/domains/materials/components/composition-editor/CompositionPositionControls';
      import {CompositionAutosaveBoundary} from '@/domains/materials/components/composition-editor/CompositionAutosaveBoundary';
      import {compositionLayoutSchema} from '@/domains/production/composition-editor/composition-document.types';
      window.commits = [];
      function Harness() {
        const [x, setX] = useState('-100'), [y, setY] = useState('50');
        const [disabled, setDisabled] = useState(false);
        const [width, setWidth] = useState(1920);
        window.configure = (locked, width) => {setDisabled(locked); setWidth(width);};
        return <CompositionAutosaveBoundary value={{x,y}} disabled={disabled} onCommit={() => {
          if (!x.trim() || !y.trim() || !compositionLayoutSchema.shape.x.safeParse(Number(x)).success || !compositionLayoutSchema.shape.y.safeParse(Number(y)).success) return;
          window.commits.push({x:Number(x), y:Number(y)}); return true;
        }}><CompositionPositionControls canvasWidth={width} canvasHeight={1080} disabled={disabled} x={x} y={y} onXChange={setX} onYChange={setY}/></CompositionAutosaveBoundary>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    tsconfig: 'apps/web/tsconfig.json', bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  });
  console.log('Bundle del componente listo.');
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<html lang="es"><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    console.log('Iniciando navegador de QA.');
    browser = await launchCompositionQaBrowser({profilePrefix: 'courseforge-position-'});
    console.log('Navegador listo.');
    const evaluate = async expression => {
      const result = await browser.client.send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await browser.client.send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}`});
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 100 && !await evaluate('Boolean(document.querySelector("input"))'); attempt++) await pause(50);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('input[type=range]')).map(i => [i.value,i.min,i.max])`), [['-100','-1920','1920'],['50','-1080','1080']]);
    await evaluate(`window.change = (selector, value) => { const input = document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); }; document.querySelector('input[type=range]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); change('input[type=range]','240');`);
    await pause(750);
    assert.equal(await evaluate('commits.length'), 0, 'No guardar durante el arrastre');
    assert.equal(await evaluate(`document.querySelector('input[type=number]').value`), '240');
    await evaluate(`document.querySelector('input[type=range]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));`);
    await pause(100);
    assert.deepEqual(await evaluate('commits'), [{x:240,y:50}]);
    await evaluate(`change('input[type=number]','-320.5')`);
    await pause(750);
    assert.deepEqual(await evaluate('commits.at(-1)'), {x:-320.5,y:50});
    await evaluate(`change('input[type=number]','9000')`);
    await pause(750);
    assert.equal(await evaluate('commits.length'), 2, 'No guardar posición fuera del esquema');
    await evaluate(`change('input[type=number]','')`);
    await pause(750);
    assert.equal(await evaluate('commits.length'), 2, 'No convertir vacío a cero');
    await evaluate(`change('input[type=number]','-320.5'); configure(true,1080)`);
    await pause(100);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('input')).every(i=>i.matches(':disabled'))`), true);
    assert.equal(await evaluate(`document.querySelector('input[type=range]').min`), '-1080');
    console.log('PASS: negativos, sincronización, guardado al soltar, precisión decimal, entradas inválidas, bloqueo y formato.');
  } finally {
    console.log('Cerrando QA.');
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error); process.exitCode=1;});
