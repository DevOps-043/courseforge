import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeImports, moduleReferences } from './import-analysis.mjs';

test('CSS usa su parser y JSON no se interpreta como un módulo TypeScript', () => {
  assert.deepEqual(moduleReferences('/* @import "ignorado"; */\n@import "tailwindcss";\n@import url("./theme.css");', 'fixture.css')
    .map(({ specifier, kind }) => [specifier, kind]), [['tailwindcss', 'css-import'], ['./theme.css', 'css-import']]);
  assert.deepEqual(moduleReferences('{"text":"import value from fake"}', 'fixture.json'), []);
});

test('distingue tipos explícitos e implícitos de valores conservados', () => {
  const result = analyzeImports(`
import type { Contract } from './contract';
import { Shape } from './shape';
import { type Configuration, run } from './runtime';
import './side-effect';
export const execute = (value: Contract, shape: Shape, config: Configuration) => run(value, shape, config);
`, 'fixture.ts');
  assert.deepEqual(result.map(({ specifier, explicitType, emission }) => [specifier, explicitType, emission]), [
    ['./contract', true, 'borrada'], ['./shape', false, 'borrada'],
    ['./runtime', false, 'conservada'], ['./side-effect', false, 'conservada'],
  ]);
});

test('conserva reexports de valores, dynamic import y require; borra reexports de tipos', () => {
  const result = analyzeImports(`
export type { Contract } from './contract';
export { type Shape } from './shape';
export { run } from './runtime';
export const lazy = () => import('./lazy');
export const legacy = require('./legacy');
export type Options = import('./options').Options;
`, 'fixture.ts');
  assert.deepEqual(result.map(({ specifier, emission }) => [specifier, emission]), [
    ['./contract', 'borrada'], ['./shape', 'borrada'], ['./runtime', 'conservada'],
    ['./lazy', 'conservada'], ['./legacy', 'conservada'], ['./options', 'borrada'],
  ]);
});

test('un import de valor al mismo specifier prevalece en la emisión agregada', () => {
  const result = analyzeImports(`import type { Contract } from './shared';
import { run } from './shared'; export const execute = (value: Contract) => run(value);`, 'fixture.ts');
  assert.equal(result.length, 2);
  assert.ok(result.every((entry) => entry.emission === 'conservada'));
  assert.equal(result[0].explicitType, true);
});
