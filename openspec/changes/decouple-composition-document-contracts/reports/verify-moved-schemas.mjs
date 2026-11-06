import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const baseline = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(baseline ?? '')) throw new Error('Indicar SHA completo de la base.');
const directory = 'apps/web/src/domains/production/composition-editor/';
const parse = (file, previous = false) => ts.createSourceFile(file,
  previous ? execFileSync('git', ['show', `${baseline}:${directory}${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n')
    : fs.readFileSync(directory + file, 'utf8').replaceAll('\r\n', '\n'), ts.ScriptTarget.Latest, true);
const before = new Map();
const after = new Map();
const source = (file, previous) => {
  const cache = previous ? before : after;
  if (!cache.has(file)) cache.set(file, parse(file, previous));
  return cache.get(file);
};
const expression = (ast, name) => {
  for (const statement of ast.statements) {
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find((entry) => entry.name.getText(ast) === name);
      if (declaration?.initializer) return declaration.initializer.getText(ast);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.body.getText(ast);
  }
  throw new Error(`Declaración ausente: ${name}`);
};
let checked = 0;
const compare = (oldFile, newFile, names) => {
  for (const name of names) {
    assert.equal(expression(source(newFile), name), expression(source(oldFile, true), name), name);
    checked += 1;
  }
};
compare('composition-document.types.ts', 'composition-clip.contract.ts', [
  'COMPOSITION_MEDIA_FIT_MODES', 'compositionLayoutSchema', 'compositionLayoutPatchSchema',
  'compositionVisualCropSchema', 'compositionClipSchema', 'getCompositionClipMediaAssetId',
]);
compare('composition-document.types.ts', 'composition-document.types.ts', [
  'compositionEditorDocumentSchema', 'compositionTrackSchema', 'compositionGroupSchema', 'compositionAudioMixSchema',
]);
compare('composition-document.types.ts', 'composition-schema-primitives.ts', ['editorIdSchema', 'finiteNumberSchema', 'boundedSecondsSchema']);
compare('composition-document.types.ts', 'composition-document.types.constants.ts', ['COMPOSITION_TIMELINE_BOUNDARY_EPSILON_SECONDS', 'exceedsCompositionTimelineBoundary']);
compare('composition-font-references.ts', 'composition-font-reference.contract.ts', ['COMPOSITION_FONT_REFERENCE_LIMIT', 'compositionFontReferenceSchema', 'compositionDeckFontReferencesSchema']);
compare('composition-font-references.ts', 'composition-font-references.ts', ['compositionFontReferenceDetails', 'compositionFontReferences']);
compare('composition-caption-effects-plan.ts', 'composition-caption-effects-plan.ts', ['buildCaptionEffectPlanForClip', 'buildCaptionEffectPlan']);

const exports = (ast) => ast.statements.flatMap((statement) => {
  if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    return statement.exportClause.elements.map((entry) => entry.name.text);
  }
  if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
  return ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((entry) => entry.name.getText(ast))
    : statement.name ? [statement.name.text] : [];
}).sort();
for (const file of ['composition-document.types.ts', 'composition-font-references.ts']) {
  assert.deepEqual(exports(source(file)), exports(source(file, true)), `Exports públicos: ${file}`);
}
console.log(`Extracción comprobada: ${checked} inicializadores/cuerpos idénticos y exports públicos conservados en dos módulos.`);
