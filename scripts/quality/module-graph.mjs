import path from 'node:path';
import madge from 'madge';
import ts from 'typescript';
import { classifyBundlerReference } from './module-graph-bundler.mjs';

export function readModuleGraphOptions(configFile) {
  const absolute = path.resolve(configFile);
  const config = ts.readConfigFile(absolute, ts.sys.readFile);
  if (config.error) throw new Error(`No se pudo leer tsconfig: ${ts.flattenDiagnosticMessageText(config.error.messageText, '\n')}`);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(absolute));
  if (parsed.errors.length) throw new Error(`tsconfig inválido: ${parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('; ')}`);
  return parsed.options;
}

export async function analyzeModuleGraph({ entries, configFile, baseDirectory, projectRoot }) {
  const result = await madge(entries.map((entry) => path.resolve(entry)), {
    baseDir: path.resolve(baseDirectory),
    fileExtensions: ['ts', 'tsx'],
    // filing-cabinet acepta opciones parseadas bajo options, sin reconvertirlas.
    tsConfig: { options: readModuleGraphOptions(configFile) },
  });
  const classified = [];
  const unresolved = [];
  for (const specifier of result.warnings().skipped) {
    const reference = classifyBundlerReference(specifier, projectRoot);
    if (reference) classified.push(reference);
    else unresolved.push(specifier);
  }
  const graph = result.obj();
  const cycles = result.circular();
  return {
    ok: cycles.length === 0 && unresolved.length === 0,
    graph, cycles, classified, unresolved,
    counts: { files: Object.keys(graph).length,
      edges: Object.values(graph).reduce((count, dependencies) => count + dependencies.length, 0),
      cycles: cycles.length, classified: classified.length, unresolved: unresolved.length },
  };
}
