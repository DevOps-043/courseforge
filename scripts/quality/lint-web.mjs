import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectLintWarnings, compareLintWarnings } from './lint-warning-baseline.mjs';

const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const require = createRequire(path.join(webRoot, 'package.json'));
const { ESLint } = require('eslint');

async function main() {
  const eslint = new ESLint({ cwd: webRoot, cache: true, cacheLocation: path.join(webRoot, '.tmp/lint/eslintcache') });
  const results = await eslint.lintFiles(['.']);
  for (const result of results) {
    if (result.warningCount > 0 && typeof result.source !== 'string') result.source = await readFile(result.filePath, 'utf8');
  }
  const reportPath = path.join(webRoot, '.tmp/lint/latest.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
  const baseline = JSON.parse(await readFile(path.join(webRoot, 'eslint-warning-baseline.json'), 'utf8'));
  const warnings = collectLintWarnings(results, webRoot);
  const changes = compareLintWarnings(warnings, baseline);
  const errors = results.reduce((sum, result) => sum + result.errorCount, 0);
  const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);
  const newWarningFiles = new Set(changes.filter(change => change.kind === 'incremento').map(change => change.file));
  const failures = results.filter(result => result.errorCount > 0 || newWarningFiles.has(path.relative(webRoot, result.filePath).split(path.sep).join('/')));
  if (failures.length) console.log(await (await eslint.loadFormatter('stylish')).format(failures));
  for (const change of changes) {
    console.error(`Lint ${change.kind}: ${change.file} / ${change.rule} [${change.warningId.slice(0, 8)}]: ${change.previous} → ${change.current}`);
  }
  console.log(`Lint: ${errors} errores, ${warningCount} warnings detectados, ${changes.length} diferencias con baseline.`);
  console.log(`Diagnóstico completo: ${reportPath}`);
  process.exitCode = errors > 0 || changes.length > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(`No se pudo completar lint: ${error.message}`);
  process.exitCode = 2;
});
