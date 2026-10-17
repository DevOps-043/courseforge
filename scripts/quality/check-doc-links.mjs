import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

const root = process.cwd();
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const canonical = new Set(['AGENTS.md', 'CLAUDE.md', 'codex.md', 'docs/README.md',
  'docs/prompt_maestro.md', 'docs/architecture/system-context.md',
  'docs/architecture/development-harness.md', 'docs/operations/harness-quickstart.md',
  'docs/references/harness-sources.md']);
function collect(path) {
  const full = resolve(root, path);
  if (!existsSync(full)) return;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) collect(path + '/' + entry.name);
    else if (entry.isFile() && entry.name.endsWith('.md')) canonical.add(path + '/' + entry.name);
  }
}
for (const dir of ['docs/standards', 'ai-specs', 'openspec', '.agents/rules', '.agents/workflows']) collect(dir);
const links = text => [...text.matchAll(/!?\[[^\]]*\]\((<[^>]*>|[^)]+)\)/g)].map(match => match[1]);
try {
  const base = process.env.HARNESS_BASE_REF || 'HEAD';
  git(['rev-parse', '--verify', base + '^{commit}']);
  const changed = new Set((git(['diff', '--name-only', base, '-z']) +
    git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(file => file.endsWith('.md') && !file.startsWith('docs/archive/')));
  const files = new Set([...canonical, ...changed]);
  const errors = [];
  for (const file of files) {
    const full = resolve(root, file);
    if (!existsSync(full)) continue;
    let previous = new Set();
    if (!canonical.has(file)) {
      try { previous = new Set(links(git(['show', base + ':' + file]))); } catch { /* Documento nuevo. */ }
    }
    for (let target of links(readFileSync(full, 'utf8'))) {
      if (previous.has(target)) continue;
      if (target.startsWith('<')) target = target.slice(1, -1);
      target = target.split(/\s+["']/)[0].split('#')[0];
      if (!target || /^(?:https?:|mailto:|data:)/i.test(target)) continue;
      try { target = decodeURIComponent(target); } catch { errors.push(file + ': destino mal codificado'); continue; }
      const dest = target.startsWith('/') ? resolve(root, '.' + target) : resolve(dirname(full), target);
      const rel = relative(root, dest);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || !existsSync(dest)) errors.push(file + ' -> ' + target);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Enlaces locales verificados: ' + files.size + ' documentos; catálogo canónico y enlaces nuevos.');
} catch (error) {
  console.error('Documentación inválida: ' + error.message);
  process.exitCode = 1;
}
