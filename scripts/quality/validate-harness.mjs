import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inside, readSkills, slug } from '../ai/harness-lib.mjs';

const root = process.cwd();
const errors = [];
const required = [
  'AGENTS.md', 'CLAUDE.md', 'codex.md', 'docs/README.md', 'docs/prompt_maestro.md',
  'docs/standards/base.md', 'docs/standards/engineering-practices.md',
  'docs/standards/web-and-jobs.md', 'docs/standards/security-and-tenancy.md',
  'docs/standards/testing.md', 'docs/standards/documentation.md',
  'docs/architecture/system-context.md', 'docs/architecture/development-harness.md',
  'docs/operations/harness-quickstart.md', 'docs/references/harness-sources.md',
  'ai-specs/README.md', 'ai-specs/agents/registry.json',
  'ai-specs/policies/tool-boundaries.md', 'ai-specs/templates/context-pack.md',
  'ai-specs/templates/evidence.md', 'openspec/config.yaml',
  '.agents/rules/coursegen-harness.md', '.github/workflows/quality.yml',
  'scripts/ai/sync-agent-adapters.mjs', 'scripts/quality/check-doc-links.mjs',
  'scripts/quality/run-gate.mjs', 'scripts/quality/harness.test.mjs',
];
const read = path => readFileSync(inside(root, path), 'utf8');
try {
  for (const file of required) if (!existsSync(inside(root, file))) errors.push('Falta ruta: ' + file);
  for (const file of ['CLAUDE.md', 'codex.md', '.agents/rules/coursegen-harness.md']) {
    if (existsSync(inside(root, file)) && !read(file).includes('AGENTS.md')) errors.push('Falta referencia al router: ' + file);
  }
  for (const file of ['AGENTS.md', 'docs/prompt_maestro.md', '.agents/rules/coursegen-harness.md']) {
    if (existsSync(inside(root, file)) && !read(file).includes('standards/engineering-practices.md')) errors.push('Falta estándar maestro: ' + file);
  }
  if (existsSync(inside(root, 'docs/standards/engineering-practices.md'))) {
    const standard = read('docs/standards/engineering-practices.md');
    for (let n = 1; n <= 17; n++) if (!standard.includes('## ' + n + '.')) errors.push('Área del estándar ausente: ' + n);
  }
  const skills = new Set(readSkills(root).map(skill => skill.name));
  const registry = JSON.parse(read('ai-specs/agents/registry.json'));
  if (registry.version !== 1 || !Array.isArray(registry.development) || !registry.development.length) throw new Error('Registro de roles inválido.');
  const ids = new Set();
  for (const role of registry.development) {
    if (typeof role.id !== 'string' || !slug.test(role.id) || ids.has(role.id)) throw new Error('ID de rol inválido o duplicado.');
    ids.add(role.id);
    if (typeof role.source !== 'string' || !/^development\/[a-z0-9-]+\.md$/.test(role.source) ||
        !existsSync(inside(root, 'ai-specs/agents/' + role.source))) throw new Error('Fuente de rol inválida: ' + role.id);
    if (!Array.isArray(role.skills) || role.skills.some(name => !skills.has(name))) throw new Error('Skill registrada inexistente: ' + role.id);
  }
  if (registry.runtime?.defaultPolicy !== 'deny' || !Array.isArray(registry.runtime?.developmentSkillsExposed) ||
      registry.runtime.developmentSkillsExposed.length) throw new Error('El runtime no puede exponer skills de desarrollo.');
  for (const name of ['propose', 'apply', 'verify', 'archive']) {
    const path = '.agents/workflows/openspec-' + name + '.md';
    if (!existsSync(inside(root, path))) errors.push('Workflow ausente: ' + path);
  }
  for (const dir of ['.agents/rules', '.agents/workflows']) if (existsSync(inside(root, dir))) {
    for (const name of readdirSync(inside(root, dir)).filter(name => name.endsWith('.md'))) {
      if (read(dir + '/' + name).length > 12000) errors.push('Regla/workflow excede 12000 caracteres: ' + name);
    }
  }
  const base = process.env.HARNESS_BASE_REF || 'HEAD';
  execFileSync('git', ['rev-parse', '--verify', base + '^{commit}'], { cwd: root, stdio: 'ignore' });
  const changed = execFileSync('git', ['diff', '--name-only', base, '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const file of new Set((changed + added).split('\0').filter(Boolean))) {
    if (/(^|\/)(\.env(?:\..*)?|settings\.local\.json)$|(^|\/)(node_modules|\.tmp)\//.test(file)) errors.push('Archivo local fuera del alcance del arnés: ' + file);
  }
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['adapters:sync', 'adapters:check', 'harness:validate', 'docs:check', 'openspec:validate', 'test:harness', 'verify:harness', 'verify:pr', 'verify']) {
    if (typeof pkg.scripts?.[name] !== 'string' || !pkg.scripts[name].trim()) errors.push('Script ausente: ' + name);
  }
  const ci = read('.github/workflows/quality.yml');
  if (!ci.includes('run: npm run verify:harness') || !/^\s*- run: npm run verify\s*$/m.test(ci)) errors.push('CI sin compuertas de arnés/producto.');
} catch (error) { errors.push(error.message); }
if (errors.length) {
  console.error('Arnés inválido:\n' + errors.map(error => '- ' + error).join('\n'));
  process.exitCode = 1;
} else console.log('Arnés de Coursegen válido.');
