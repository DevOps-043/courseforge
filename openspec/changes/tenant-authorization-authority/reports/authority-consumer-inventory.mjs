import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inventario de fuentes versionadas. No ejecuta módulos de producto o proveedores.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const reportDirectory = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(path.join(root, 'apps/web/package.json'));
const ts = require('typescript');
const watched = new Set(['getAuthenticatedUser', 'resolveServerIdentity', 'resolveServerAccessToken',
  'resolveActiveTenantContext', 'resolveTenantContext', 'resolveTenantContextByOrganizationId',
  'getOrganizationPlatformRole', 'loadCurrentUserMemberships', 'canReviewContent']);
const errorNames = new Set(['AuthIdentityLookupError', 'TenantContextLookupError']);
const methodNames = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
const output = outputArgument?.slice('--output='.length) ?? 'authority-consumer-inventory.json';
if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(output)) throw new Error('El destino debe ser un nombre JSON local al directorio de informes.');
const target = path.join(reportDirectory, output);
if (existsSync(target) && !process.argv.includes('--replace')) throw new Error('El informe ya existe; usa --replace o un nombre nuevo.');
const git = (...arguments_) => execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' });
const tracked = git('ls-files', '-z', '--', 'apps/web/src').split('\0').filter(file => /\.tsx?$/.test(file)
  && !/\/(__tests__|fixtures)\//.test(file) && !/\.(test|fixture)\./.test(file));
const records = [];
for (const file of tracked) {
  const source = readFileSync(path.join(root, file), 'utf8');
  if (![...watched, ...errorNames].some(name => source.includes(name))) continue;
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const aliases = new Map([...watched, ...errorNames].map(name => [name, name]));
  const imports = [];
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      const symbol = (binding.propertyName ?? binding.name).text;
      if (!watched.has(symbol) && !errorNames.has(symbol)) continue;
      aliases.set(binding.name.text, symbol);
      imports.push({ symbol, local: binding.name.text, module: statement.moduleSpecifier.text });
    }
  }
  const calls = [], emitters = [], catches = [], httpMethods = [];
  const line = node => syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;
  const enclosing = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isFunctionLike(parent)) continue;
      return parent.name?.getText(syntax) ?? (ts.isVariableDeclaration(parent.parent) ? parent.parent.name.getText(syntax) : '<callback>');
    }
    return '<modulo>';
  };
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name && methodNames.has(node.name.text)
      && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) httpMethods.push(node.name.text);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const local = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
      const symbol = aliases.get(local);
      if (symbol && watched.has(symbol) && ts.isCallExpression(node)) calls.push({ symbol, line: line(node), function: enclosing(node) });
      if (symbol && errorNames.has(symbol) && ts.isNewExpression(node)) emitters.push({ symbol, line: line(node), function: enclosing(node) });
    }
    if (ts.isCatchClause(node)) {
      const body = node.block.getText(syntax);
      catches.push({ line: line(node), function: enclosing(node),
        authorityClassNames: [...errorNames].filter(name => body.includes(name)),
        mentionsSharedMapper: body.includes('authorizationUnavailableResponse'),
        mentionsLogging: /console\.|logger\.|logFailure/.test(body) });
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  if (!calls.length && !emitters.length && !imports.length) continue;
  records.push({ file, sha256: createHash('sha256').update(source).digest('hex'),
    area: file.includes('/app/api/') ? 'HTTP' : file.includes('/lib/server/') ? 'SERVIDOR'
      : /['"]use server['"]/.test(source) ? 'ACCION_SERVIDOR' : 'OTRO', httpMethods, imports, calls, emitters, catches });
}
const report = { base: git('rev-parse', 'HEAD').trim(), node: process.version, typescript: ts.version,
  criterion: 'AST y nombres importados; no resuelve el grafo transitivo ni demuestra captura efectiva, rol o seguridad. Los nombres de propiedades son candidatos léxicos.',
  trackedChanges: git('diff', '--name-only', '--', 'apps/web/src').trim().split('\n').filter(Boolean),
  summary: { files: records.length, calls: records.reduce((total, record) => total + record.calls.length, 0),
    emitterFiles: records.filter(record => record.emitters.length).length,
    httpFiles: records.filter(record => record.area === 'HTTP').length,
    actions: records.filter(record => record.area === 'ACCION_SERVIDOR').length }, records };
writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, ...report.summary }));
