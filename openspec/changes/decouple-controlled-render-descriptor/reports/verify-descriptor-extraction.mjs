import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const baseline = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(baseline ?? '')) throw new Error('Indicar SHA completo de la base.');
const directory = 'apps/web/src/domains/production/composition-editor/qa/';
const files = [
  'composition-controlled-execution-fence.ts', 'composition-controlled-reference-selection.ts',
  'composition-controlled-reference-measurement.ts', 'composition-controlled-render-materialization.ts',
  'composition-render-supervisor.service.ts', 'composition-materialized-supervisor-renderer.ts',
];
const emit = (source, fileName) => ts.transpileModule(source, { fileName,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
for (const file of files) {
  const current = emit(fs.readFileSync(directory + file, 'utf8'), file);
  const previous = emit(execFileSync('git', ['show', `${baseline}:${directory}${file}`], { encoding: 'utf8' }), file);
  assert.equal(current, previous, `JavaScript idéntico: ${file}`);
  console.log(`${file}: SHA256 ${createHash('sha256').update(current).digest('hex')}`);
}

const web = path.resolve('apps/web');
const config = ts.readConfigFile(path.join(web, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
assert.equal(parsed.errors.length, 0);
const options = { ...parsed.options, incremental: false, noEmit: true };
const virtualFile = path.join(web, 'src/domains/production/composition-editor/__tests__/controlled-render-descriptor-compatibility.probe.ts');
const probe = `
import type {ControlledRenderDescriptor} from '../qa/composition-controlled-render-descriptor.contract';
import type {CompositionRenderAuthorityService} from '../qa/composition-render-authority.service';
type OriginalDescriptor = {organizationId: string; revisionId: string; executionId: string;
  documentHash: string; projectHash: string;
  contract: Awaited<ReturnType<CompositionRenderAuthorityService['issue']>>['contract']};
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type AssertFalse<T extends false> = T;
export type DescriptorCompatibility = Assert<Equal<ControlledRenderDescriptor, OriginalDescriptor>>;
export type RejectMalformedDescriptor = AssertFalse<Equal<Omit<ControlledRenderDescriptor, 'projectHash'> & {projectHash: number}, OriginalDescriptor>>;
`;
const host = ts.createCompilerHost(options);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => path.resolve(file) === virtualFile
  ? ts.createSourceFile(file, probe, languageVersion, true)
  : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram({ rootNames: [virtualFile, ...parsed.fileNames.filter((file) => file.endsWith('.d.ts'))], options, host });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }));
}
assert.equal(diagnostics.length, 0, 'Equivalencia de tipos y canario negativo');
console.log('Seis emisiones idénticas; descriptor equivalente al contexto de autoridad y canario negativo aprobados.');
