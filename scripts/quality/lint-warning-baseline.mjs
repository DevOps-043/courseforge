import path from 'node:path';
import { createHash } from 'node:crypto';

export function collectLintWarnings(results, root) {
  const files = {};
  for (const result of results) {
    const warnings = result.messages.filter(message => message.severity === 1);
    if (warnings.length === 0) continue;
    if (typeof result.source !== 'string') throw new Error(`Falta código para identificar warnings: ${result.filePath}`);
    const sourceLines = result.source.split(/\r?\n/);
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    for (const message of warnings) {
      const sourceLine = sourceLines[message.line - 1];
      if (sourceLine === undefined) throw new Error(`No se pudo ubicar un warning: ${file}`);
      const rule = message.ruleId ?? 'diagnostico-sin-regla';
      const warningId = createHash('sha256').update(sourceLine.trim()).digest('hex');
      files[file] ??= {};
      files[file][rule] ??= {};
      files[file][rule][warningId] = (files[file][rule][warningId] ?? 0) + 1;
    }
  }
  return { schemaVersion: 2, files: Object.fromEntries(Object.entries(files).sort().map(([file, rules]) => [file,
    Object.fromEntries(Object.entries(rules).sort().map(([rule, warnings]) => [rule, Object.fromEntries(Object.entries(warnings).sort())])),
  ])) };
}

export function compareLintWarnings(current, baseline) {
  if (!baseline || baseline.schemaVersion !== 2 || !baseline.files || typeof baseline.files !== 'object' || Array.isArray(baseline.files)) {
    throw new Error('Baseline de warnings de lint inválido.');
  }
  const changes = [];
  const files = new Set([...Object.keys(current.files), ...Object.keys(baseline.files)]);
  for (const file of files) {
    const actual = current.files[file] ?? {};
    const previous = baseline.files[file] ?? {};
    if (typeof previous !== 'object' || Array.isArray(previous)) throw new Error(`Reglas de baseline inválidas: ${file}`);
    for (const rule of new Set([...Object.keys(actual), ...Object.keys(previous)])) {
      const actualWarnings = actual[rule] ?? {};
      const previousWarnings = previous[rule] ?? {};
      if (typeof previousWarnings !== 'object' || Array.isArray(previousWarnings)) throw new Error(`Firmas de baseline inválidas: ${file} / ${rule}`);
      for (const warningId of new Set([...Object.keys(actualWarnings), ...Object.keys(previousWarnings)])) {
        const count = actualWarnings[warningId] ?? 0;
        const allowed = previousWarnings[warningId] ?? 0;
        if (!Number.isInteger(allowed) || allowed < 0) throw new Error(`Conteo de baseline inválido: ${file} / ${rule}`);
        if (count !== allowed) changes.push({ file, rule, warningId, previous: allowed, current: count, kind: count > allowed ? 'incremento' : 'reducir-baseline' });
      }
    }
  }
  return changes;
}
