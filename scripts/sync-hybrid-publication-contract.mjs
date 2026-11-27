import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [operation, academyRoot, ...extra] = process.argv.slice(2);
if (!['--check', '--write'].includes(operation) || !academyRoot || extra.length) {
  throw new Error('Uso: node scripts/sync-hybrid-publication-contract.mjs --check|--write <repositorio-Academy>');
}
const targetRoot = resolve(academyRoot);
const targetPackage = JSON.parse(await readFile(resolve(targetRoot, 'package.json'), 'utf8'));
if (targetPackage.name !== 'soflia-academy' || targetRoot === root) throw new Error('El destino debe ser el repositorio de Academy.');
const base = 'apps/web/src/domains/publication/contracts/';
for (const [source, target, transform] of [
  ['hybrid-publication-route.ts', 'apps/web/src/lib/course-import/contracts/hybrid-publication-route.ts'],
  ['hybrid-publication-preparation.ts', 'apps/web/src/lib/course-import/contracts/hybrid-publication-preparation.ts',
    content => content.replaceAll('../../course-delivery/types/', '../../../features/live/')],
  ['hybrid-publication-package.ts', 'apps/web/src/lib/course-import/contracts/hybrid-publication-package.ts'],
  ['fixtures/hybrid-route-v2.json', 'apps/web/src/lib/course-import/contracts/fixtures/hybrid-route-v2.json'],
  ['fixtures/hybrid-package-v2.json', 'apps/web/src/lib/course-import/contracts/fixtures/hybrid-package-v2.json'],
]) {
  const original = await readFile(resolve(root, base, source), 'utf8');
  const content = transform ? transform(original) : original;
  const destination = resolve(targetRoot, target);
  if (operation === '--write') {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  } else if (content.replaceAll('\r\n', '\n') !== (await readFile(destination, 'utf8')).replaceAll('\r\n', '\n')) {
    throw new Error(`Contrato divergente en Academy: ${target}`);
  }
}
console.log(operation === '--write' ? 'Contratos híbridos sincronizados con Academy.' : 'Paridad de contratos y fixture verificada.');
