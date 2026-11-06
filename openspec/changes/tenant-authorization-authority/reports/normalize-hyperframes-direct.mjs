import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const ts = require('typescript');
const inventory = JSON.parse(readFileSync(path.join(directory, 'hyperframes-direct-inventory.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const report = [];
function parse(file, source) { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true); }
function edit(source, edits) {
  const sorted = edits.sort((left, right) => right.start - left.start);
  let boundary = source.length + 1;
  for (const item of sorted) {
    if (item.end > boundary) throw new Error('Ediciones solapadas.');
    source = source.slice(0, item.start) + item.text + source.slice(item.end);
    boundary = item.start;
  }
  return source;
}
for (const record of inventory.records.filter(item => item.category === 'DIRECTA')) {
  const target = path.resolve(root, record.file);
  const allowedRoot = path.join(root, 'apps/web/src/app/api/production/hyperframes') + path.sep;
  if (!target.startsWith(allowedRoot) || path.basename(target) !== 'route.ts') throw new Error('El destino está fuera de las rutas HyperFrames permitidas.');
  let original = readFileSync(target, 'utf8');
  if (verify) {
    const blob = execFileSync('git', ['show', `${inventory.base}:${record.file}`], { cwd: root, encoding: 'utf8' });
    const candidates = [blob, blob.replace(/\r?\n/g, '\r\n')];
    original = candidates.find(value => createHash('sha256').update(value).digest('hex') === record.sha256);
    if (!original) throw new Error(`El inventario no coincide con el blob base: ${record.file}`);
  }
  if (createHash('sha256').update(original).digest('hex') !== record.sha256) throw new Error(`La fuente cambió desde el inventario: ${record.file}`);
  const nl = original.includes('\r\n') ? '\r\n' : '\n';
  let source = original;
  let syntax = parse(target, source);
  const edits = [];
  let guards = 0;
  for (const statement of syntax.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.body) continue;
    const name = statement.name?.text;
    if (!record.methods.some(item => item.method === name) && name !== 'initializeDraftResponse') continue;
    for (const item of statement.body.statements.filter(ts.isTryStatement)) {
      const clause = item.catchClause;
      if (!clause) continue;
      const errorName = clause.variableDeclaration?.name.getText(syntax);
      if (errorName !== 'error') throw new Error(`Catch inesperado en ${record.file}`);
      const legacy = clause.block.statements.find(node => ts.isIfStatement(node) && node.expression.getText(syntax) === 'error instanceof TenantContextLookupError');
      const reason = legacy && /details: \{ reason: error.code \}|tenantUnavailableResponse/.test(legacy.getText(syntax));
      const requestId = name === 'initializeDraftResponse' ? 'params.requestId' : 'requestId';
      const options = reason ? ', error instanceof TenantContextLookupError ? { details: { reason: error.code } } : undefined' : '';
      let guard = `${nl}    const authorityUnavailable = authorizationUnavailableResponse(error, ${requestId}${options});${nl}    if (authorityUnavailable) return authorityUnavailable;`;
      if (record.file.endsWith('/drafts/[draftId]/preview/route.ts')) {
        guard = `${nl}    const authorityUnavailable = authorizationUnavailableResponse(error, requestId);${nl}    if (authorityUnavailable) {${nl}      if (!failureBridgeHash || previewGeneration === null) return authorityUnavailable;${nl}      const failure = await authorityUnavailable.json();${nl}      return previewFailureResponse({ bridgeCode: "DEPENDENCY_FAILED", code: API_ERROR_CODE.dependencyUnavailable,${nl}        documentHash: failureBridgeHash, message: failure.message, previewGeneration, requestId, retryable: true, status: 503 });${nl}    }`;
      }
      edits.push({ start: clause.block.getStart(syntax) + 1, end: clause.block.getStart(syntax) + 1, text: guard });
      if (legacy) edits.push({ start: legacy.getStart(syntax), end: legacy.end, text: '' });
      guards++;
    }
  }
  source = edit(source, edits);
  // Tras retirar sus dos llamadas, eliminar el formatter legacy ya redundante.
  syntax = parse(target, source);
  const redundant = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'tenantUnavailableResponse');
  if (redundant && [...source.matchAll(/\btenantUnavailableResponse\b/g)].length === 1) source = source.slice(0, redundant.getFullStart()) + source.slice(redundant.end);
  // Mover solo el patrón contiguo revisión → tenant → denegación y anclarlo.
  syntax = parse(target, source);
  const roleEdits = [];
  let roles = 0;
  function visit(node) {
    if (ts.isBlock(node)) for (let index = 0; index + 2 < node.statements.length; index++) {
      const [role, declaration, denial] = node.statements.slice(index, index + 3);
      if (!ts.isIfStatement(role) || !ts.isVariableStatement(declaration) || !ts.isIfStatement(denial)) continue;
      const roleText = role.getText(syntax);
      if (!/canReviewContent\([^,()]+\)/.test(roleText) || !/const tenant = await resolveActiveTenantContext\(\)/.test(declaration.getText(syntax)) || denial.expression.getText(syntax) !== '!tenant') continue;
      const updatedRole = roleText.replace(/canReviewContent\(([^,()]+)\)/, 'canReviewContent($1, tenant)');
      roleEdits.push({ start: role.getStart(syntax), end: role.end, text: '' });
      const lineStart = source.lastIndexOf('\n', role.getStart(syntax)) + 1;
      const indent = source.slice(lineStart, role.getStart(syntax));
      roleEdits.push({ start: denial.end, end: denial.end, text: nl + indent + updatedRole });
      roles++;
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  source = edit(source, roleEdits);
  if ([...source.matchAll(/\bTenantContextLookupError\b/g)].length === 1) {
    const cleanupSyntax = parse(target, source);
    for (const statement of cleanupSyntax.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      const elements = statement.importClause.namedBindings.elements;
      const index = elements.findIndex(item => item.name.text === 'TenantContextLookupError');
      if (index < 0) continue;
      const start = elements.length === 1 ? statement.getFullStart() : index > 0 ? elements[index - 1].end : elements[index].getStart(cleanupSyntax);
      const end = elements.length === 1 ? statement.end : index > 0 ? elements[index].end : elements[index + 1].getStart(cleanupSyntax);
      source = source.slice(0, start) + source.slice(end);
      break;
    }
  }
  if (record.file.endsWith('/drafts/[draftId]/preview/route.ts')) {
    const helper = parse(target, source).statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'previewFailureResponse');
    const text = helper.getText().replace('"Cache-Control": "private, no-store",', '"Cache-Control": "private, no-store",' + nl + '      Vary: "Cookie",');
    source = source.slice(0, helper.getStart()) + text + source.slice(helper.end);
  }
  source = 'import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";' + nl + source;
  if (record.file.endsWith('/drafts/[draftId]/preview/route.ts')) {
    source = source.replace('import { API_ERROR_CODE }', 'import { API_ERROR_CODE, type ApiErrorBody }')
      .replace('const failure = await authorityUnavailable.json();', 'const failure = await authorityUnavailable.json() as ApiErrorBody;');
  }
  source = source.replace(/^[\t ]+(?=\r?$)/gm, '');
  const remaining = [];
  function calls(node) {
    if (ts.isCallExpression(node) && node.expression.getText() === 'canReviewContent' && node.arguments.length === 1) remaining.push(node.getText());
    ts.forEachChild(node, calls);
  }
  calls(parse(target, source));
  report.push({ file: record.file, guards, roles, remainingRoleCalls: remaining });
  if (verify && source.replaceAll('\r\n', '\n') !== readFileSync(target, 'utf8').replaceAll('\r\n', '\n')) throw new Error(`La transformación no reproduce el archivo: ${record.file}`);
  if (apply) writeFileSync(target, source);
}
writeFileSync(path.join(directory, 'hyperframes-direct-transformation.json'), JSON.stringify({ mode: verify ? 'VERIFY' : apply ? 'APPLY' : 'PREVIEW', records: report }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ verified: verify, applied: apply, files: report.length, guards: report.reduce((sum, item) => sum + item.guards, 0), roles: report.reduce((sum, item) => sum + item.roles, 0), remainingRoleCalls: report.filter(item => item.remainingRoleCalls.length) }, null, 2) + '\n');
