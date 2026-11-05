import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const ts = require('typescript');
const apiRoot = path.join(root, 'apps/web/src/app/api/production/hyperframes');
const outputName = process.argv.find(value => value.startsWith('--output='))?.slice('--output='.length) || 'hyperframes-direct-inventory.json';
if (path.basename(outputName) !== outputName || !outputName.endsWith('.json')) throw new Error('El destino debe ser un JSON dentro de reports.');
const outputFile = path.join(directory, outputName);
if (existsSync(outputFile) && !process.argv.includes('--replace')) throw new Error('El inventario ya existe. Usa --output=otro.json o --replace explícito para actualizarlo.');
const normalize = value => value.replaceAll('\\', '/');
const records = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (entry.name !== 'route.ts') continue;
    const source = readFileSync(file, 'utf8');
    if (source.includes('authorizationUnavailableResponse') || /await (authorizeCompositionPresetRequest|resolveAuthorizedRenderContext|authorizeCompositionAgentRequest)\(/.test(source)) continue;
    const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const direct = /getAuthenticatedUser|resolveActiveTenantContext|canReviewContent/.test(source) && !/create\w+(?:Handler|Handlers)\(/.test(source);
    const methods = [];
    for (const statement of syntax.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const method = statement.name?.text;
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
      const catches = statement.body.statements.filter(ts.isTryStatement).filter(item => item.catchClause).map(item => item.catchClause);
      methods.push({ method, catches: catches.map(clause => ({ line: syntax.getLineAndCharacterOfPosition(clause.getStart()).line + 1,
        legacyTenant: clause.block.getText().includes('instanceof TenantContextLookupError'),
        legacyReason: clause.block.getText().includes('instanceof TenantContextLookupError') && (clause.block.getText().includes('details: { reason: error.code }') || clause.block.getText().includes('tenantUnavailableResponse')) })) });
    }
    records.push({ file: normalize(path.relative(root, file)), category: direct ? 'DIRECTA' : 'DELEGADA_POR_INSPECCIONAR', sha256: createHash('sha256').update(source).digest('hex'), methods });
  }
}
visit(apiRoot);
records.sort((left, right) => left.file.localeCompare(right.file));
const report = { base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), criterion: 'Clasificación léxica/AST; no acredita seguridad o comportamiento.', records };
writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
for (const category of ['DIRECTA', 'DELEGADA_POR_INSPECCIONAR']) {
  const selected = records.filter(item => item.category === category);
  process.stdout.write(`${category}: ${selected.length} rutas, ${selected.reduce((total, item) => total + item.methods.length, 0)} métodos\n`);
}
