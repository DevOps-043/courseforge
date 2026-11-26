import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('netlify-cli/package.json'));
const buildInfoRequire = createRequire(cliRequire.resolve('@netlify/build-info'));
const shipEntry = cliRequire.resolve('@netlify/zip-it-and-ship-it');
const shipRequire = createRequire(shipEntry);

test('los patrones de workspaces y archivos ocultos conservan su comportamiento', () => {
  const { minimatch, Minimatch } = buildInfoRequire('minimatch');
  assert.equal(minimatch('apps/web/package.json', 'apps/*/package.json'), true);
  assert.equal(minimatch('packages/ui/package.json', 'apps/*/package.json'), false);
  assert.equal(minimatch('.env', '**/*', { dot: true }), true);
  assert.equal(minimatch('.env', '**/*'), false);
  assert.equal(minimatch('src/main.ts', '**/*.{ts,tsx}'), true);
  assert.equal(minimatch('src/main.js', '**/*.{ts,tsx}'), false);
  assert.equal(new Minimatch('!dist/**').match('src/main.ts'), true);
  assert.equal(new Minimatch('!dist/**').match('dist/main.js'), false);
  // build-info usa globParts para localizar el directorio base del workspace.
  assert.deepEqual(new Minimatch('apps/*').globParts[0], ['apps', '*']);
});

test('el trazador y el empaquetador incluyen una dependencia local de la función', async t => {
  const prefix = join(tmpdir(), 'courseforge-tooling-security-');
  const directory = await mkdtemp(prefix);
  t.after(async () => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'courseforge-tooling-security-')) {
      throw new Error('Ruta temporal fuera del alcance de la prueba.');
    }
    await rm(directory, { recursive: true, force: true });
  });
  const functions = join(directory, 'functions');
  const shared = join(directory, 'shared');
  await mkdir(functions);
  await mkdir(shared);
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
  await writeFile(join(shared, 'message.cjs'), "module.exports = 'hola';\n");
  const entry = join(functions, 'hello.js');
  await writeFile(entry, "const message = require('../shared/message.cjs'); exports.handler = async () => ({ statusCode: 200, body: message });\n");

  const { nodeFileTrace } = shipRequire('@vercel/nft');
  const traced = await nodeFileTrace([entry], { base: directory, processCwd: directory });
  const tracedPaths = new Set([...traced.fileList].map(path => path.replaceAll('\\', '/')));
  assert.equal(tracedPaths.has('functions/hello.js'), true);
  assert.equal(tracedPaths.has('shared/message.cjs'), true);
  assert.equal([...tracedPaths].some(path => path.startsWith('..')), false);

  const { zipFunctions } = await import(pathToFileURL(shipEntry).href);
  const output = join(directory, 'output');
  await mkdir(output);
  const packaged = await zipFunctions(functions, output, {
    basePath: directory, repositoryRoot: directory, config: { '*': { nodeBundler: 'nft' } },
  });
  assert.equal(packaged.length, 1);
  assert.equal(packaged[0].name, 'hello');
  const JSZip = require('jszip');
  const archive = await JSZip.loadAsync(await readFile(packaged[0].path));
  assert.equal(Object.keys(archive.files).some(path => path.endsWith('shared/message.cjs')), true);
});
