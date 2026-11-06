import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyzeModuleGraph, readModuleGraphOptions } from './module-graph.mjs';
import { classifyBundlerReference } from './module-graph-bundler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporaryRoot = path.join(root, '.tmp/module-graph');
function put(directory, file, source) {
  const target = path.join(directory, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}
function fixture(t, sources = {}) {
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(path.join(temporaryRoot, 'canary-'));
  t.after(() => {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(temporaryRoot) + path.sep + 'canary-'));
    rmSync(target, { recursive: true, force: true });
  });
  put(directory, 'package.json', '{}');
  put(directory, 'tsconfig.json', JSON.stringify({ compilerOptions: {
    module: 'esnext', moduleResolution: 'bundler', paths: { '@fixture/*': ['./src/*'] },
  }, include: ['src/**/*.ts'] }));
  for (const [file, source] of Object.entries(sources)) put(directory, `src/${file}`, source);
  return { directory, analyze: () => analyzeModuleGraph({
    entries: [path.join(directory, 'src')], configFile: path.join(directory, 'tsconfig.json'),
    baseDirectory: directory, projectRoot: directory,
  }) };
}

test('el alias relativo al tsconfig resuelve con base absoluta sin depender del cwd', async (t) => {
  const { directory, analyze } = fixture(t, { 'a.ts': "import { value } from '@fixture/b'; export { value };", 'b.ts': 'export const value = 1;' });
  const options = readModuleGraphOptions(path.join(directory, 'tsconfig.json'));
  assert.equal(path.resolve(options.pathsBasePath), path.resolve(directory));
  const result = await analyze();
  assert.equal(result.ok, true);
  assert.deepEqual(result.graph['src/a.ts'], ['src/b.ts']);
  assert.equal(result.counts.unresolved, 0);
});

test('un ciclo por alias hace fallar la misma política del gate', async (t) => {
  const { analyze } = fixture(t, {
    'a.ts': "import { b } from '@fixture/b'; export const a = () => b();",
    'b.ts': "import { a } from '@fixture/a'; export const b = () => a();",
  });
  const result = await analyze();
  assert.equal(result.ok, false);
  assert.equal(result.counts.cycles, 1);
  assert.equal(result.counts.unresolved, 0);
});

test('los ciclos solo de tipos no se excluyen', async (t) => {
  const { analyze } = fixture(t, {
    'a.ts': "import type { B } from '@fixture/b'; export type A = { b: B };",
    'b.ts': "import type { A } from '@fixture/a'; export type B = { a: A };",
  });
  const result = await analyze();
  assert.equal(result.ok, false);
  assert.equal(result.counts.cycles, 1);
});

test('un alias inexistente bloquea aunque no haya ciclos', async (t) => {
  const { analyze } = fixture(t, { 'a.ts': "import '@fixture/missing';" });
  const result = await analyze();
  assert.equal(result.ok, false);
  assert.equal(result.counts.cycles, 0);
  assert.deepEqual(result.unresolved, ['@fixture/missing']);
});

function tailwind(directory, style = './index.css') {
  put(directory, 'node_modules/tailwindcss/package.json', JSON.stringify({ name: 'tailwindcss', exports: {
    './package.json': './package.json', '.': { style },
  } }));
  put(directory, 'node_modules/tailwindcss/index.css', '/* recurso sintético */');
}

test('la clasificación CSS exige exports.style y un recurso real del paquete', (t) => {
  const { directory } = fixture(t);
  tailwind(directory);
  const reference = classifyBundlerReference('tailwindcss', directory);
  assert.equal(reference.specifier, 'tailwindcss');
  assert.ok(reference.resources[0].endsWith('index.css'));
  unlinkSync(path.join(directory, 'node_modules/tailwindcss/index.css'));
  assert.equal(classifyBundlerReference('tailwindcss', directory), null);
});

test('un import CSS inexistente bloquea sin ciclos', async (t) => {
  const { directory, analyze } = fixture(t, { 'a.ts': "import './theme.css';" });
  put(directory, 'src/theme.css', '@import "missing-graph-canary-package";');
  const result = await analyze();
  assert.equal(result.ok, false);
  assert.deepEqual(result.unresolved, ['missing-graph-canary-package']);
});

test('no acepta una entrada CSS que escape del paquete', (t) => {
  const { directory } = fixture(t);
  tailwind(directory, '../outside.css');
  put(directory, 'node_modules/outside.css', '/* fuera del paquete */');
  assert.equal(classifyBundlerReference('tailwindcss', directory), null);
});

function nextMarker(directory) {
  put(directory, 'node_modules/next/package.json', JSON.stringify({ name: 'next', exports: {
    './dist/build/create-compiler-aliases': './aliases.cjs',
    './dist/compiled/server-only/empty': './empty.cjs', './dist/compiled/server-only/index': './index.cjs',
  } }));
  put(directory, 'node_modules/next/aliases.cjs', "exports.createServerOnlyClientOnlyAliases = server => ({'server-only$': server ? 'next/dist/compiled/server-only/empty' : 'next/dist/compiled/server-only/index'});");
  put(directory, 'node_modules/next/empty.cjs', '');
  put(directory, 'node_modules/next/index.cjs', '');
}

test('server-only exige alias de Next y recursos de servidor y cliente existentes', (t) => {
  const { directory } = fixture(t);
  nextMarker(directory);
  assert.equal(classifyBundlerReference('server-only', directory).resources.length, 2);
  unlinkSync(path.join(directory, 'node_modules/next/empty.cjs'));
  assert.equal(classifyBundlerReference('server-only', directory), null);
});

test('el comando no justifica recursos ausentes usando otro proyecto', (t) => {
  const { directory } = fixture(t, { 'a.ts': "import 'server-only';" });
  nextMarker(directory);
  const report = path.join(directory, 'report.json');
  const execute = () => spawnSync(process.execPath, [path.join(root, 'scripts/quality/check-module-graph.mjs'),
    '--entry', path.join(directory, 'src'), '--tsconfig', path.join(directory, 'tsconfig.json'), '--report', report],
  { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(execute().status, 0);
  unlinkSync(path.join(directory, 'node_modules/next/empty.cjs'));
  assert.equal(execute().status, 1);
  assert.deepEqual(JSON.parse(readFileSync(report, 'utf8')).unresolved, ['server-only']);
});

test('variaciones de las referencias conocidas no reciben tolerancia', (t) => {
  const { directory } = fixture(t);
  for (const specifier of ['tailwindcss/missing', 'server-only-missing', '@fixture/server-only']) {
    assert.equal(classifyBundlerReference(specifier, directory), null);
  }
});

test('el gate y el arnés conservan el runner y sus canarios', () => {
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['architecture:cycles'], 'node scripts/quality/check-module-graph.mjs');
  assert.ok(scripts.verify.includes('npm run architecture:cycles'));
  assert.ok(scripts['test:harness'].includes('scripts/quality/module-graph.test.mjs'));
});

test('el comando real devuelve fallo ante ciclos e imports desconocidos y aprueba el caso válido', (t) => {
  const cases = [
    { sources: { 'a.ts': "import { value } from '@fixture/b'; export { value };", 'b.ts': 'export const value = 1;' }, expected: 0 },
    { sources: { 'a.ts': "import type { B } from '@fixture/b'; export type A = { b: B };",
      'b.ts': "import type { A } from '@fixture/a'; export type B = { a: A };" }, expected: 1 },
    { sources: { 'a.ts': "import '@fixture/missing';" }, expected: 1 },
  ];
  for (const { sources, expected } of cases) {
    const { directory } = fixture(t, sources);
    const report = path.join(directory, 'report.json');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/quality/check-module-graph.mjs'),
      '--entry', path.join(directory, 'src'), '--tsconfig', path.join(directory, 'tsconfig.json'), '--report', report],
    { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, expected, result.stderr);
    const artifact = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(artifact.ok, expected === 0);
    if (expected !== 0) assert.ok(artifact.cycles.length > 0 || artifact.unresolved.length > 0);
  }
});

test('un tsconfig ausente no produce un grafo aprobado', (t) => {
  const { directory } = fixture(t);
  assert.throws(() => readModuleGraphOptions(path.join(directory, 'missing.json')), /No se pudo leer tsconfig/);
});
