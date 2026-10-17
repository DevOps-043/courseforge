import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { gateScripts, executeGate } from './gate-plan.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function cleanup(path) {
  const full = resolve(path);
  if (!full.startsWith(resolve(tmpdir()) + sep + 'coursegen-')) throw new Error('Limpieza fuera del directorio temporal de pruebas.');
  rmSync(full, { recursive: true, force: true });
}
const put = (root, file, text) => {
  const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text);
};
function fixture(t, full = true) {
  const root = mkdtempSync(join(tmpdir(), 'coursegen-harness-'));
  t.after(() => cleanup(root));
  if (full) {
    for (const path of ['AGENTS.md', 'CLAUDE.md', 'codex.md', 'package.json', 'ai-specs',
      'docs/README.md', 'docs/prompt_maestro.md', 'docs/standards',
      'docs/architecture/system-context.md', 'docs/architecture/development-harness.md',
      'docs/operations/harness-quickstart.md', 'docs/references/harness-sources.md',
      '.agents/rules', '.agents/workflows', '.github/workflows/quality.yml',
      'scripts/ai', 'scripts/quality', 'openspec/config.yaml']) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      cpSync(join(repo, path), join(root, path), { recursive: true });
    }
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  // Una referencia inicial permite comprobar archivos nuevos sin hacer commits.
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-qm', 'Base de prueba'], { cwd: root });
  return root;
}
const run = (root, script, args = [], env = {}) => spawnSync(process.execPath, [join(repo, script), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HARNESS_BASE_REF: 'HEAD', ...env } });
const adapters = (root, check = false) => run(root, 'scripts/ai/sync-agent-adapters.mjs', check ? ['--check'] : []);
const validate = root => run(root, 'scripts/quality/validate-harness.mjs');
const docs = (root, base = 'HEAD') => run(root, 'scripts/quality/check-doc-links.mjs', [], { HARNESS_BASE_REF: base });
function registry(root, mutate) {
  const file = 'ai-specs/agents/registry.json';
  const value = JSON.parse(readFileSync(join(root, file), 'utf8')); mutate(value);
  put(root, file, JSON.stringify(value));
}
test('genera adaptadores deterministas y acepta CRLF equivalente', t => {
  const root = fixture(t);
  assert.equal(adapters(root).status, 0);
  const path = '.codex/skills/verify-change/SKILL.md';
  const original = readFileSync(join(root, path), 'utf8');
  put(root, path, original.replaceAll('\n', '\r\n'));
  assert.equal(adapters(root, true).status, 0);
  assert.equal(adapters(root).status, 0);
  assert.equal(readFileSync(join(root, path), 'utf8'), original);
  const result = validate(root);
  assert.equal(result.status, 0, result.stderr);
});
test('rechaza drift y la regeneración lo corrige', t => {
  const root = fixture(t); assert.equal(adapters(root).status, 0);
  put(root, '.claude/skills/verify-change/SKILL.md', 'Contenido divergente');
  assert.match(adapters(root, true).stderr, /desactualizado/);
  assert.equal(adapters(root).status, 0);
  assert.equal(adapters(root, true).status, 0);
});
test('rechaza huérfanos y conserva su contenido incluso al sincronizar', t => {
  const root = fixture(t); assert.equal(adapters(root).status, 0);
  const file = '.agents/skills/retirada/SKILL.md';
  put(root, file, 'Trabajo que debe conservarse');
  assert.notEqual(adapters(root, true).status, 0);
  assert.notEqual(adapters(root).status, 0);
  assert.equal(readFileSync(join(root, file), 'utf8'), 'Trabajo que debe conservarse');
});
test('rechaza metadatos que intentan cambiar la ruta de la skill', t => {
  const root = fixture(t);
  put(root, 'ai-specs/skills/verify-change/SKILL.md', '---\nname: ../../fuera\ndescription: Prueba\n---\n');
  assert.notEqual(adapters(root).status, 0);
});
test('rechaza destinos enlazados sin escribir fuera del repositorio', t => {
  const root = fixture(t); const external = mkdtempSync(join(tmpdir(), 'coursegen-external-'));
  t.after(() => cleanup(external));
  mkdirSync(join(root, '.codex'), { recursive: true });
  try { symlinkSync(external, join(root, '.codex/skills'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('El entorno no permite enlaces.'); return; } throw error; }
  const result = adapters(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Enlace no permitido/);
  assert.equal(existsSync(join(external, 'verify-change')), false);
});
test('detecta una ruta obligatoria ausente', t => {
  const root = fixture(t); rmSync(join(root, 'AGENTS.md'));
  const result = validate(root); assert.notEqual(result.status, 0); assert.match(result.stderr, /AGENTS.md/);
});
test('rechaza skills registradas inexistentes y fuentes fuera de dominio', t => {
  const root = fixture(t);
  registry(root, r => { r.development[0].skills = ['inventada']; });
  assert.match(validate(root).stderr, /Skill registrada inexistente/);
  registry(root, r => { r.development[0].skills = []; r.development[0].source = '../../fuera'; });
  assert.match(validate(root).stderr, /Fuente de rol inválida/);
});
test('rechaza exposición de desarrollo al runtime', t => {
  const root = fixture(t); registry(root, r => { r.runtime.developmentSkillsExposed = ['verify-change']; });
  const result = validate(root); assert.notEqual(result.status, 0); assert.match(result.stderr, /runtime/);
});
test('detecta un área perdida del estándar maestro', t => {
  const root = fixture(t);
  const file = 'docs/standards/engineering-practices.md';
  put(root, file, readFileSync(join(root, file), 'utf8').replace('## 17.', '## Área retirada.'));
  assert.match(validate(root).stderr, /17/);
});
test('rechaza cambios locales sensibles sin leer su contenido', t => {
  const root = fixture(t); put(root, '.env.local', 'VALOR_DE_FIXTURE_SIN_CREDENCIALES');
  const result = validate(root); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Archivo local/);
  assert.doesNotMatch(result.stderr, /VALOR_DE_FIXTURE/);
});
test('verifica enlaces nuevos con espacios y rechaza destinos inexistentes', t => {
  const root = fixture(t, false);
  put(root, 'docs/README.md', '[Existe](<archivo con espacios.md>)\n');
  put(root, 'docs/archivo con espacios.md', 'Fuente');
  assert.equal(docs(root).status, 0);
  put(root, 'docs/README.md', '[Falta](inexistente.md)\n');
  assert.notEqual(docs(root).status, 0);
});
test('no oculta enlaces rotos nuevos tras una línea base histórica', t => {
  const root = fixture(t, false);
  put(root, 'README.md', '[Histórico](historico-ausente.md)\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-qm', 'Enlace histórico'], { cwd: root });
  assert.equal(docs(root).status, 0);
  put(root, 'README.md', '[Histórico](historico-ausente.md)\n[Nuevo](nuevo-ausente.md)\n');
  const result = docs(root); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nuevo-ausente/);
  assert.doesNotMatch(result.stderr, /historico-ausente/);
});
test('CI detecta enlaces nuevos ya comprometidos frente a la base del PR', t => {
  const root = fixture(t, false);
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  put(root, 'README.md', '[Enlace nuevo](no-existe-en-ci.md)\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Cambio del PR'], { cwd: root });
  assert.notEqual(docs(root, base).status, 0);
  assert.match(docs(root, base).stderr, /no-existe-en-ci/);
});
test('rechaza referencias base inexistentes en vez de omitir la comprobación', t => {
  const root = fixture(t, false);
  assert.notEqual(docs(root, 'base-inexistente-de-fixture').status, 0);
});
test('CI no puede sustituir la verificación de producto por la del arnés', t => {
  const root = fixture(t);
  const file = '.github/workflows/quality.yml';
  put(root, file, readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n').replace('- run: npm run verify\n', '- run: npm run verify:harness\n'));
  assert.match(validate(root).stderr, /CI sin compuertas/);
});
test('la compuerta conserva verify de producto y se detiene con el código real', () => {
  assert.equal(gateScripts(false).at(-1), 'verify');
  assert.equal(gateScripts(true).includes('verify'), false);
  const observed = [];
  const status = executeGate(['primero', 'fallo', 'posterior'], script => {
    observed.push(script); return script === 'fallo' ? 7 : 0;
  });
  assert.equal(status, 7);
  assert.deepEqual(observed, ['primero', 'fallo']);
  assert.equal(executeGate(['correcto'], () => 0), 0);
});
