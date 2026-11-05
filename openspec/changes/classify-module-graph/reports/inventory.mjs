import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import madge from 'madge';
import ts from 'typescript';
import { analyzeImports, moduleReferences } from './import-analysis.mjs';
import { cyclicComponents } from './graph-components.mjs';

const require = createRequire(import.meta.url);
const root = process.cwd();
const web = path.join(root, 'apps/web');
const configuration = path.join(web, 'tsconfig.json');
const config = ts.readConfigFile(configuration, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, web).options;
const resolutionCache = ts.createModuleResolutionCache(root, (file) => file.toLowerCase(), options);
const normalize = (file) => path.relative(web, file).replaceAll('\\', '/');
const resolve = (specifier, consumer) => ts.resolveModuleName(specifier, consumer, options, ts.sys, resolutionCache).resolvedModule?.resolvedFileName;
const result = await madge(['apps/web/src', 'apps/web/netlify/functions'], {
  fileExtensions: ['ts', 'tsx'], tsConfig: 'apps/web/tsconfig.json',
});
const graph = result.obj();
const cycles = result.circular();
const components = cyclicComponents(graph);
const membership = new Map(components.flatMap((component, index) => component.map((file) => [file, index])));
const cyclicFiles = new Set(membership.keys());
const warnings = new Map(result.warnings().skipped.map((specifier) => [specifier, []]));
const references = new Map();
const recoveredGraph = structuredClone(graph);
const recoveredEdges = [];
for (const consumer of Object.keys(graph)) {
  const absolute = path.join(web, consumer);
  const source = fs.readFileSync(absolute, 'utf8');
  const entries = cyclicFiles.has(consumer)
    ? analyzeImports(source, absolute, options) : moduleReferences(source, absolute);
  references.set(consumer, entries);
  for (const entry of entries) {
    const resolved = entry.kind === 'css-import' ? null : resolve(entry.specifier, absolute);
    const target = resolved ? normalize(resolved) : null;
    if (warnings.has(entry.specifier)) {
      warnings.get(entry.specifier).push({ consumer, line: entry.line, kind: entry.kind, target });
    }
    if (target && Object.hasOwn(graph, target) && !recoveredGraph[consumer].includes(target)) {
      recoveredGraph[consumer].push(target);
      recoveredEdges.push({ consumer, target, specifier: entry.specifier });
    }
  }
}
const edges = [];
const seen = new Set();
for (const consumer of cyclicFiles) {
  for (const target of graph[consumer]) {
    if (membership.get(target) !== membership.get(consumer)) continue;
    const key = `${consumer}\0${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = references.get(consumer).filter((entry) => {
      const resolved = resolve(entry.specifier, path.join(web, consumer));
      return resolved && normalize(resolved) === target;
    });
    edges.push({ consumer, target, imports: matches,
      classification: matches.length === 0 ? 'pendiente'
        : matches.some((entry) => entry.emission === 'conservada') ? 'conservada' : 'borrada',
      consumersOfTarget: Object.entries(graph).filter(([, dependencies]) => dependencies.includes(target)).map(([file]) => file),
    });
  }
}
const warningInventory = [...warnings].map(([specifier, consumers]) => ({
  specifier, consumers,
  classification: consumers.length === 0 ? 'sin consumidor AST'
    : consumers.every((entry) => entry.kind === 'css-import') ? 'import CSS; resolver separado'
    : consumers.every((entry) => entry.target) ? 'resuelta por TypeScript'
      : consumers.some((entry) => entry.target) ? 'resolución mixta' : 'no resuelta por TypeScript',
}));
const recoveredCycles = (await madge(recoveredGraph)).circular();
const cycleKey = (cycle) => cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join('\0')).sort()[0];
const originalCycleKeys = new Set(cycles.map(cycleKey));
const runtimeProjection = structuredClone(graph);
for (const edge of edges.filter((entry) => entry.classification === 'borrada')) {
  runtimeProjection[edge.consumer] = runtimeProjection[edge.consumer].filter((target) => target !== edge.target);
}
const projectedCycles = (await madge(runtimeProjection)).circular();
const counts = (entries, field) => entries.reduce((total, entry) => {
  total[entry[field]] = (total[entry[field]] ?? 0) + 1;
  return total;
}, {});
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inventory = {
  generatedAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  versions: { node: process.version, typescript: ts.version, madge: require('madge/package.json').version },
  hashes: Object.fromEntries(['package-lock.json', 'apps/web/tsconfig.json'].map((file) => [file, hash(file)])),
  command: 'npm run architecture:cycles',
  counts: { files: Object.keys(graph).length, cycles: cycles.length, warnings: warnings.size,
    edges: counts(edges, 'classification'), warningsByClassification: counts(warningInventory, 'classification'),
    components: components.length, cyclicFiles: cyclicFiles.size,
    recoveredEdges: recoveredEdges.length, recoveredCycles: recoveredCycles.length,
    additionalRecoveredCycles: recoveredCycles.filter((cycle) => !originalCycleKeys.has(cycleKey(cycle))).length,
    cyclesAfterRemovingErasedEdges: projectedCycles.length },
  cycles, components, edges, warningInventory, recoveredEdges, recoveredCycles, projectedCycles,
};
fs.mkdirSync('.tmp/module-graph', { recursive: true });
fs.writeFileSync('.tmp/module-graph/inventory.json', `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ ...inventory, cycles: undefined, edges: undefined, warningInventory: undefined,
  recoveredEdges: undefined, recoveredCycles: undefined, components: undefined, projectedCycles: undefined }, null, 2));
