import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { captureBackgroundDeployment } from './capture-background-deployment.mjs';

function destination(t) {
  const directory = mkdtempSync(join(tmpdir(), 'courseforge-deployment-'));
  t.after(() => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'courseforge-deployment-')) throw new Error('Ruta temporal inválida.');
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, 'deployment.json');
}

test('captura únicamente el origen del deploy concreto sin secretos', t => {
  const file = destination(t);
  captureBackgroundDeployment({ NETLIFY: 'true', DEPLOY_URL: 'https://build--example.netlify.app/',
    URL: 'https://example.netlify.app', SECRET: 'no-serializar' }, file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { origin: 'https://build--example.netlify.app' });
});

test('build local elimina metadatos antiguos y no depende de variables de producción', t => {
  const file = destination(t);
  captureBackgroundDeployment({ NETLIFY: 'true', DEPLOY_URL: 'https://old--example.netlify.app' }, file);
  captureBackgroundDeployment({}, file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { origin: null });
});

test('build de Netlify falla si no puede capturar un destino seguro', t => {
  const file = destination(t);
  for (const DEPLOY_URL of [undefined, '', 'invalid', 'http://example.com', 'https://user:password@example.com',
    'https://example.com/path', 'https://example.com?token=secret', 'https://example.com#fragment']) {
    assert.throws(() => captureBackgroundDeployment({ NETLIFY: 'true', DEPLOY_URL }, file));
  }
});

test('el comando de build captura el manifiesto junto al resolver incluso desde otro cwd', t => {
  const directory = dirname(destination(t));
  const script = join(directory, 'scripts/capture-background-deployment.mjs');
  const manifest = join(directory, 'apps/web/src/lib/server/background-deployment.generated.json');
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(dirname(manifest), { recursive: true });
  cpSync(new URL('./capture-background-deployment.mjs', import.meta.url), script);
  const child = spawnSync(process.execPath, [script], { cwd: tmpdir(), encoding: 'utf8',
    env: { NETLIFY: 'true', DEPLOY_URL: 'https://build-cli--example.netlify.app' } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')), { origin: 'https://build-cli--example.netlify.app' });
});
