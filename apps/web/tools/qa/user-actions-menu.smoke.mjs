import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const webRoot = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(webRoot, 'package.json'));
const runtimeModules = process.argv[2];
const { chromium } = runtimeModules
  ? await import(pathToFileURL(path.join(runtimeModules, 'playwright/index.mjs')).href)
  : await import('playwright');
const output = path.join(webRoot, '.tmp/user-actions-menu-qa');
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import UsersTable from './src/app/admin/users/UsersTable';
const users = Array.from({length:8}, (_,index)=>({id:'qa-'+index, first_name:'Persona '+index, email:'persona'+index+'@example.test',platform_role:'CONSTRUCTOR'}));
createRoot(document.getElementById('root')).render(<div className="soflia-engine-shell"><main style={{marginLeft:'10%',paddingTop:80}}><div className="engine-content"><UsersTable initialUsers={users}/></div></main></div>);`, resolveDir: webRoot, loader: 'tsx' },
  tsconfig: path.join(webRoot, 'tsconfig.json'), bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic', outfile: path.join(output, 'fixture.js'),
});
const css = await require('postcss')([require('@tailwindcss/postcss')()]).process(
  '@import "tailwindcss" source(none); @import "../../src/app/engine-design-system.css"; @source "../../src/app/admin/users"; :root{--font-newsreader:Georgia;--font-inter-tight:Arial;--font-ibm-plex:Arial}',
  { from: path.join(webRoot, 'tools/qa/users-qa.css') },
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const checks = [];
try {
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{width:1365,height:768}, {width:390,height:844}]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://courseforge.test/**', route => route.fulfill({ contentType:'text/html', body:
        `<html lang="es" class="${theme === 'dark' ? 'dark' : ''}"><head><style>${css.css}\n${bundle.outputFiles.find(file=>file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>` }));
      await page.goto('http://courseforge.test');
      await page.addScriptTag({ content: bundle.outputFiles.find(file=>file.path.endsWith('.js')).text });
      const trigger = page.getByRole('button', { name:'Acciones de Persona 0', exact:true });
      await trigger.waitFor();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.engine-content')).transform !== 'none' && document.querySelector('.engine-content').getAnimations().every(animation=>animation.playState === 'finished'));
      const menu = page.getByRole('menu');
      await trigger.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await trigger.click();
      await menu.waitFor();
      assert.equal(await menu.evaluate(element=>element.parentElement === document.body), true);
      const bounds = await menu.boundingBox();
      const anchor = await trigger.boundingBox();
      assert.ok(bounds.x >= 8 && bounds.x+bounds.width <= viewport.width-8+1);
      assert.ok(bounds.y >= 8 && bounds.y+bounds.height <= viewport.height-8+1);
      assert.ok(Math.abs(bounds.y-(anchor.y+anchor.height+5)) < 1, 'Menú junto al botón, sin desplazamiento por el contenedor');
      assert.equal(await page.getByRole('menuitem').evaluate(element=>element === document.activeElement), true);
      await page.screenshot({ path:path.join(output, `${theme}-${viewport.width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await menu.count(), 0);
      assert.equal(await trigger.evaluate(element=>element === document.activeElement), true);
      await page.keyboard.press('Enter');
      await menu.waitFor();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await page.waitForFunction(()=>document.querySelector('[role="dialog"] input')?.value === 'Persona 0');
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      await trigger.click();
      await page.getByRole('button', {name:'Cerrar acciones de usuario'}).click({position:{x:1,y:1}});
      assert.equal(await menu.count(), 0);
      await trigger.click();
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
      await menu.waitFor({state:'detached'});
      await trigger.click();
      await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
      await menu.waitFor({state:'detached'});
      const lastTrigger = page.getByRole('button', {name:'Acciones de Persona 7',exact:true});
      await lastTrigger.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await lastTrigger.click();
      await menu.waitFor();
      const bottomBounds = await menu.boundingBox();
      assert.ok(bottomBounds.y >= 8 && bottomBounds.y+bottomBounds.height <= viewport.height-8+1);
      await page.getByRole('menuitem').click();
      await dialog.waitFor();
      await page.waitForFunction(()=>document.querySelector('[role="dialog"] input')?.value === 'Persona 7');
      checks.push({theme,width:viewport.width,portal:true,position:true,keyboard:true,correctUser:true,outsideClick:true,scroll:true,resize:true});
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({checks,errors},null,2));
  process.stdout.write(`${JSON.stringify({checks,errors},null,2)}\n`);
} finally {
  await browser.close();
}
