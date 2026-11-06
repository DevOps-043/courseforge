import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const baseline = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(baseline ?? '')) throw new Error('Indicar SHA completo de la base.');
const directory = 'apps/web/src/domains/production/composition-editor/http/';
const previous = (file) => execFileSync('git', ['show', `${baseline}:${directory}${file}`], { encoding: 'utf8' });
const current = (file) => fs.readFileSync(directory + file, 'utf8');
const files = [
  'composition-narrative-command-handler.server.ts', 'composition-narrative-extraction-handler.server.ts',
  'composition-narrative-extraction-handlers.server.ts', 'composition-narrative-fragment-plan-handler.server.ts',
];
const emit = (source, fileName) => ts.transpileModule(source, { fileName,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
for (const file of files) {
  const emitted = emit(current(file), file);
  assert.equal(emitted, emit(previous(file), file), `JavaScript idéntico: ${file}`);
  console.log(`${file}: SHA256 ${createHash('sha256').update(emitted).digest('hex')}`);
}
const alias = (source, fileName) => {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  return ast.statements.find((statement) => ts.isTypeAliasDeclaration(statement)
    && statement.name.text === 'NarrativeExtractionHttpAuthorization')?.type.getText(ast);
};
assert.equal(alias(current('composition-narrative-http-authorization.contract.ts'), 'contract.ts'),
  alias(previous('composition-narrative-extraction-handler.server.ts'), 'previous.ts'));
console.log('Cuatro emisiones CommonJS idénticas y unión de autorización conservada.');
