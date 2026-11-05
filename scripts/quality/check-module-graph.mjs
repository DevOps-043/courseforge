import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
import ts from 'typescript';
import { analyzeModuleGraph } from './module-graph.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const gitPaths = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
async function main() {
  const { values } = parseArgs({ options: {
    entry: { type: 'string', multiple: true }, tsconfig: { type: 'string' }, report: { type: 'string' },
  } });
  if (Boolean(values.entry) !== Boolean(values.tsconfig)) throw new Error('Usa --entry y --tsconfig juntos para un diagnóstico acotado.');
  const inputs = { entries: values.entry ?? ['apps/web/src', 'apps/web/netlify/functions'],
    configFile: values.tsconfig ?? 'apps/web/tsconfig.json' };
  const configFile = path.resolve(root, inputs.configFile);
  const projectRoot = path.dirname(configFile);
  const report = await analyzeModuleGraph({
    entries: inputs.entries.map((entry) => path.resolve(root, entry)),
    configFile, baseDirectory: projectRoot, projectRoot,
  });
  const hashes = {};
  for (const file of [inputs.configFile, 'package-lock.json', 'package.json',
    'scripts/quality/check-module-graph.mjs', 'scripts/quality/module-graph.mjs', 'scripts/quality/module-graph-bundler.mjs']) {
    hashes[file] = createHash('sha256').update(await readFile(path.resolve(root, file))).digest('hex');
  }
  const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceChanges: [...new Set([
      ...gitPaths(['diff', '--name-only', '-z', 'HEAD', '--', ...inputs.entries]),
      ...gitPaths(['ls-files', '--others', '--exclude-standard', '-z', '--', ...inputs.entries]),
    ])],
    versions: { node: process.version, typescript: ts.version, madge: require('madge/package.json').version },
    inputs, hashes, ...report };
  const output = path.resolve(root, values.report ?? '.tmp/module-graph/latest.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  const counts = report.counts;
  console.log(`Grafo: ${counts.files} módulos, ${counts.edges} aristas, ${counts.cycles} ciclos; ${counts.classified} referencias de bundler justificadas, ${counts.unresolved} sin resolver.`);
  for (const reference of report.classified) console.log(`Bundler ${reference.specifier}: ${reference.reason}.`);
  for (const specifier of report.unresolved) console.error(`Importación no resuelta: ${specifier}`);
  for (const cycle of report.cycles) console.error(`Dependencia circular: ${cycle.join(' → ')} → ${cycle[0]}`);
  console.log(`Reporte completo: ${output}`);
  process.exitCode = report.ok ? 0 : 1;
}
main().catch((error) => {
  console.error(`No se pudo verificar el grafo: ${error instanceof Error ? error.message : 'fallo desconocido'}`);
  process.exitCode = 1;
});
