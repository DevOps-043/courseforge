import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { moduleReferences } from './import-analysis.mjs';

const baseline = process.argv[2];
if (!baseline || !/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Indicar el SHA completo de la base a comparar.');
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'apps/web/src', 'apps/web/netlify/functions'], { encoding: 'utf8' })
  .trim().split('\n').filter((file) => /\.(?:tsx?|css)$/.test(file));
const blobs = execFileSync('git', ['cat-file', '--batch'], {
  input: files.map((file) => `${baseline}:${file}\n`).join(''), maxBuffer: 128 * 1024 * 1024,
});
const specifiers = new Set();
let offset = 0;
for (const file of files) {
  const end = blobs.indexOf(10, offset);
  const header = blobs.subarray(offset, end).toString('utf8');
  const size = Number(header.split(' ')[2]);
  if (!Number.isSafeInteger(size)) throw new Error(`Blob no disponible: ${file}`);
  const source = blobs.subarray(end + 1, end + 1 + size).toString('utf8');
  for (const entry of moduleReferences(source, file)) specifiers.add(entry.specifier);
  offset = end + size + 2;
}
const inventory = JSON.parse(fs.readFileSync('.tmp/module-graph/inventory.json', 'utf8'));
const added = inventory.warningInventory.filter((entry) => !specifiers.has(entry.specifier));
const baselineAliases = [...specifiers].filter((specifier) => specifier.startsWith('@/')).sort();
const currentAliases = new Set(inventory.warningInventory.map((entry) => entry.specifier));
const comparison = {
  baseline, current: inventory.head, files: files.length,
  newWarningSpecifiers: added,
  baselineAliasesAbsentFromCurrentWarnings: baselineAliases.filter((specifier) => !currentAliases.has(specifier)),
  limit: 'Comparación de declaraciones AST históricas, no ejecución de Madge sobre el checkout histórico.',
};
fs.writeFileSync('.tmp/module-graph/baseline-comparison.json', `${JSON.stringify(comparison, null, 2)}\n`);
console.log(JSON.stringify(comparison, null, 2));
