import fs from 'node:fs';

const inventory = JSON.parse(fs.readFileSync('.tmp/module-graph/inventory.json', 'utf8'));
const comparison = JSON.parse(fs.readFileSync('.tmp/module-graph/baseline-comparison.json', 'utf8'));
const code = (value) => `\`${value}\``;
const lines = [
  '# Inventario F0.3', '',
  `Captura: ${inventory.generatedAt}. HEAD: ${code(inventory.head)}.`, '',
  `Versiones: ${Object.entries(inventory.versions).map(([name, value]) => `${name} ${value}`).join(', ')}.`, '',
  ...Object.entries(inventory.hashes).map(([file, hash]) => `- SHA256 ${code(file)}: ${code(hash)}.`), '',
  '## Resultado', '',
  '```json', JSON.stringify(inventory.counts, null, 2), '```', '',
  'Las clasificaciones son estáticas. Borrada significa eliminada en emisión aislada',
  'CommonJS; conservada no demuestra que una función se ejecute ni un fallo de inicio.',
  'La proyección solo elimina las aristas comprobadas como borradas; no sustituye al gate.',
  'Se clasifican todas las aristas internas de las componentes fuertemente conexas,',
  'incluidos recorridos alternativos que no aparecen en la lista inicial de Madge.', '',
  '## Aristas de las componentes cíclicas', '',
  'Rutas relativas a apps/web. La última columna cuenta consumidores entrantes en',
  'el grafo original. El JSON local contiene sus rutas completas.', '',
  '| Consumidor → dependencia | Líneas del import | Emisión | Consumidores de la dependencia |',
  '|---|---|---|---|',
  ...inventory.edges.map((edge) => `| ${code(edge.consumer)} → ${code(edge.target)} | ${edge.imports.map((entry) => entry.line).join(', ')} | ${edge.classification} | ${edge.consumersOfTarget.length} |`), '',
  '## Variación frente a F0.1', '',
  `Base histórica: ${code(comparison.baseline)}. Fuentes inspeccionadas: ${comparison.files}.`, '',
  comparison.limit, '',
  '| Referencia actual ausente en las declaraciones de la base | Consumidores actuales | Clasificación |',
  '|---|---|---|',
  ...comparison.newWarningSpecifiers.map((entry) => `| ${code(entry.specifier)} | ${entry.consumers.length} | ${entry.classification} |`), '',
  `Alias históricos ausentes de los warnings actuales: ${comparison.baselineAliasesAbsentFromCurrentWarnings.length}.`, '',
  '## Referencias fuera de la resolución TypeScript normal', '',
  ...inventory.warningInventory.filter((entry) => entry.classification !== 'resuelta por TypeScript')
    .map((entry) => `- ${code(entry.specifier)}: ${entry.classification}. ${entry.consumers.map((consumer) => `${code(consumer.consumer)}:${consumer.line}`).join(', ')}.`), '',
  'El inventario completo se genera en .tmp/module-graph/inventory.json; no contiene',
  'valores de configuración ni cuerpos de fuentes. Incluye referencias, consumidores',
  'y ciclos complementarios. Este resumen se regenera con render-summary.mjs.', '',
];
fs.writeFileSync('openspec/changes/classify-module-graph/reports/inventory-summary.md', lines.join('\n'));
