import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectLintWarnings, compareLintWarnings } from './lint-warning-baseline.mjs';

const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const require = createRequire(path.join(webRoot, 'package.json'));
const { ESLint } = require('eslint');

test('baseline compara cada archivo y regla sin compensar incrementos entre archivos', () => {
  const baseline = { schemaVersion: 2, files: { 'a.ts': { regla: { firma: 2 } }, 'b.ts': { regla: { firma: 1 } } } };
  assert.deepEqual(compareLintWarnings(baseline, baseline), []);
  const changes = compareLintWarnings({ schemaVersion: 2, files: { 'a.ts': { regla: { firma: 1 } }, 'b.ts': { regla: { firma: 2 } } } }, baseline);
  assert.equal(changes.find(c => c.file === 'a.ts').kind, 'reducir-baseline');
  assert.equal(changes.find(c => c.file === 'b.ts').kind, 'incremento');
  assert.throws(() => compareLintWarnings(baseline, { schemaVersion: 1 }), /inválido/);
});

test('reducciones y archivos eliminados exigen retirar tolerancias obsoletas', () => {
  const changes = compareLintWarnings({ schemaVersion: 2, files: {} }, { schemaVersion: 2, files: { 'a.ts': { regla: { firma: 1 } } } });
  assert.equal(changes[0].kind, 'reducir-baseline');
});

test('configuración efectiva resuelve plugins de overrides en TSX, MJS y CJS', async () => {
  const eslint = new ESLint({ cwd: webRoot });
  for (const file of ['src/canario.tsx', 'tools/canario.mjs', 'tools/canario.cjs']) {
    const config = await eslint.calculateConfigForFile(path.join(webRoot, file));
    for (const rule of ['react-hooks/immutability', 'react-hooks/purity', 'react-hooks/refs', 'react-hooks/set-state-in-effect', 'react/no-unescaped-entities', '@next/next/no-assign-module-variable']) {
      const plugin = rule.split('/').slice(0, -1).join('/');
      assert.ok(config.plugins[plugin], `${file}: ${plugin}`);
      assert.equal(config.rules[rule][0], 1, `${file}: ${rule}`);
    }
  }
});

test('canarios reales de ESLint rechazan un error y un warning nuevo', async () => {
  const eslint = new ESLint({ cwd: webRoot });
  const errors = await eslint.lintText('import {useState} from "react"; export default function Prueba(){ if (Math.random()) { useState(0); } return null; }', { filePath: path.join(webRoot, 'src/canario.tsx') });
  assert.ok(errors[0].messages.some(m => m.ruleId === 'react-hooks/rules-of-hooks' && m.severity === 2));
  const warnings = await eslint.lintText('let monto = 1; console.log(monto); export {};', { filePath: path.join(webRoot, 'src/canario.ts') });
  assert.ok(warnings[0].messages.some(m => m.ruleId === 'prefer-const' && m.severity === 1));
  assert.ok(compareLintWarnings(collectLintWarnings(warnings, webRoot), { schemaVersion: 2, files: {} }).some(c => c.kind === 'incremento'));
});

test('rechaza sustituir un warning por otro aunque el conteo por archivo y regla sea igual', () => {
  const collect = (source, line = 1) => collectLintWarnings([{ filePath: path.join(webRoot, 'src/canario.ts'), source,
    messages: [{ severity: 1, ruleId: 'prefer-const', line }] }], webRoot);
  const baseline = collect('let cantidad = 1;');
  assert.ok(compareLintWarnings(collect('let nuevo = 2;'), baseline).some(c => c.kind === 'incremento'));
  assert.deepEqual(compareLintWarnings(collect('\n  let cantidad = 1;', 2), baseline), []);
});

test('excluye artefactos generados y conserva scripts y fuentes', async () => {
  const eslint = new ESLint({ cwd: webRoot });
  for (const file of ['dist/composition-worker/result.js', 'src/domain/.tmp/unit/result.js', '.tmp/result.js']) {
    assert.equal(await eslint.isPathIgnored(path.join(webRoot, file)), true, file);
  }
  for (const file of ['src/app/page.tsx', 'tools/qa/composition-manual-captions.smoke.cjs', 'netlify/functions/curation-background.ts']) {
    assert.equal(await eslint.isPathIgnored(path.join(webRoot, file)), false, file);
  }
});
