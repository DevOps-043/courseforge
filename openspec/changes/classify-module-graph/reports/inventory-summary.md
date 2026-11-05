# Inventario F0.3

Captura: 2026-11-05T09:16:01.921Z. HEAD: `fd2a10611e658ba20fff415910356996b88f5069`.

Versiones: node v24.19.0, typescript 5.9.3, madge 8.0.0.

- SHA256 `package-lock.json`: `481690538cd0df697bac88ea65cf9339814fc771e823bff38725b27662340538`.
- SHA256 `apps/web/tsconfig.json`: `55da79a2910ca2986c6aa22f948311abacfd2253a125346824ae09f33d259ab9`.

## Resultado

```json
{
  "files": 2282,
  "cycles": 11,
  "warnings": 582,
  "edges": {
    "borrada": 12,
    "conservada": 34
  },
  "warningsByClassification": {
    "resuelta por TypeScript": 579,
    "import CSS; resolver separado": 1,
    "no resuelta por TypeScript": 2
  },
  "components": 4,
  "cyclicFiles": 26,
  "recoveredEdges": 2214,
  "recoveredCycles": 11,
  "additionalRecoveredCycles": 0,
  "cyclesAfterRemovingErasedEdges": 0
}
```

Las clasificaciones son estáticas. Borrada significa eliminada en emisión aislada
CommonJS; conservada no demuestra que una función se ejecute ni un fallo de inicio.
La proyección solo elimina las aristas comprobadas como borradas; no sustituye al gate.
Se clasifican todas las aristas internas de las componentes fuertemente conexas,
incluidos recorridos alternativos que no aparecen en la lista inicial de Madge.

## Aristas de las componentes cíclicas

Rutas relativas a apps/web. La última columna cuenta consumidores entrantes en
el grafo original. El JSON local contiene sus rutas completas.

| Consumidor → dependencia | Líneas del import | Emisión | Consumidores de la dependencia |
|---|---|---|---|
| `src/domains/production/composition-editor/composition-caption-effects-plan.ts` → `src/domains/production/composition-editor/composition-document.types.ts` | 1 | borrada | 208 |
| `src/domains/production/composition-editor/composition-document.types.ts` → `src/domains/production/composition-editor/composition-caption-effects-plan.ts` | 4 | conservada | 11 |
| `src/domains/production/composition-editor/composition-document.types.ts` → `src/domains/production/composition-editor/composition-font-references.ts` | 6 | conservada | 14 |
| `src/domains/production/composition-editor/composition-font-references.ts` → `src/domains/production/composition-editor/composition-document.types.ts` | 2 | borrada | 208 |
| `src/domains/production/composition-editor/composition-caption-effects.service.ts` → `src/domains/production/composition-editor/composition-text-layer.types.ts` | 1 | borrada | 20 |
| `src/domains/production/composition-editor/composition-caption-effects.service.ts` → `src/domains/production/composition-editor/composition-text-presentation.ts` | 3 | conservada | 3 |
| `src/domains/production/composition-editor/composition-text-layer.types.ts` → `src/domains/production/composition-editor/composition-caption-effects.service.ts` | 3 | conservada | 7 |
| `src/domains/production/composition-editor/composition-text-presentation.ts` → `src/domains/production/composition-editor/composition-text-layer.types.ts` | 1 | borrada | 20 |
| `src/domains/production/composition-editor/http/composition-narrative-command-handler.server.ts` → `src/domains/production/composition-editor/http/composition-narrative-extraction-handler.server.ts` | 9 | borrada | 4 |
| `src/domains/production/composition-editor/http/composition-narrative-extraction-handler.server.ts` → `src/domains/production/composition-editor/http/composition-narrative-command-handler.server.ts` | 5 | conservada | 2 |
| `src/domains/production/composition-editor/qa/composition-controlled-comparison-artifacts.ts` → `src/domains/production/composition-editor/qa/composition-exported-video-conformance.ts` | 3 | conservada | 16 |
| `src/domains/production/composition-editor/qa/composition-controlled-event-comparison-artifacts.ts` → `src/domains/production/composition-editor/qa/composition-controlled-comparison-artifacts.ts` | 5 | conservada | 10 |
| `src/domains/production/composition-editor/qa/composition-controlled-execution-fence.ts` → `src/domains/production/composition-editor/qa/composition-materialized-supervisor-renderer.ts` | 6 | borrada | 10 |
| `src/domains/production/composition-editor/qa/composition-controlled-reference-selection.ts` → `src/domains/production/composition-editor/qa/composition-materialized-supervisor-renderer.ts` | 5 | borrada | 10 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-finalization.service.ts` → `src/domains/production/composition-editor/qa/composition-controlled-render-worker-contract.ts` | 6 | conservada | 11 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-finalization.service.ts` → `src/domains/production/composition-editor/qa/composition-render-authority.service.ts` | 4 | conservada | 5 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-materialization.ts` → `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` | 15 | borrada | 6 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-upload.service.ts` → `src/domains/production/composition-editor/qa/composition-controlled-render-finalization.service.ts` | 5 | conservada | 2 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-upload.service.ts` → `src/domains/production/composition-editor/qa/composition-controlled-render-worker-contract.ts` | 8 | conservada | 11 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-upload.service.ts` → `src/domains/production/composition-editor/qa/composition-render-authority.service.ts` | 4 | conservada | 5 |
| `src/domains/production/composition-editor/qa/composition-controlled-render-worker-contract.ts` → `src/domains/production/composition-editor/qa/composition-controlled-execution-fence.ts` | 3 | conservada | 13 |
| `src/domains/production/composition-editor/qa/composition-exported-audio-loudness.ts` → `src/domains/production/composition-editor/qa/composition-controlled-execution-fence.ts` | 7 | conservada | 13 |
| `src/domains/production/composition-editor/qa/composition-exported-audio-timing.ts` → `src/domains/production/composition-editor/qa/composition-controlled-execution-fence.ts` | 11 | conservada | 13 |
| `src/domains/production/composition-editor/qa/composition-exported-conformance-gate.ts` → `src/domains/production/composition-editor/qa/composition-exported-audio-loudness.ts` | 2 | borrada | 8 |
| `src/domains/production/composition-editor/qa/composition-exported-conformance-gate.ts` → `src/domains/production/composition-editor/qa/composition-exported-audio-timing.ts` | 3 | borrada | 14 |
| `src/domains/production/composition-editor/qa/composition-exported-video-conformance.ts` → `src/domains/production/composition-editor/qa/composition-controlled-execution-fence.ts` | 31 | conservada | 13 |
| `src/domains/production/composition-editor/qa/composition-exported-video-conformance.ts` → `src/domains/production/composition-editor/qa/composition-exported-audio-loudness.ts` | 13 | conservada | 8 |
| `src/domains/production/composition-editor/qa/composition-exported-video-conformance.ts` → `src/domains/production/composition-editor/qa/composition-exported-audio-timing.ts` | 14 | conservada | 14 |
| `src/domains/production/composition-editor/qa/composition-exported-video-conformance.ts` → `src/domains/production/composition-editor/qa/composition-exported-conformance-gate.ts` | 8, 9 | conservada | 4 |
| `src/domains/production/composition-editor/qa/composition-materialized-supervisor-renderer.ts` → `src/domains/production/composition-editor/qa/composition-controlled-execution-fence.ts` | 5 | conservada | 13 |
| `src/domains/production/composition-editor/qa/composition-materialized-supervisor-renderer.ts` → `src/domains/production/composition-editor/qa/composition-controlled-render-materialization.ts` | 3 | conservada | 4 |
| `src/domains/production/composition-editor/qa/composition-materialized-supervisor-renderer.ts` → `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` | 2 | borrada | 6 |
| `src/domains/production/composition-editor/qa/composition-render-authority.service.ts` → `src/domains/production/composition-editor/qa/composition-controlled-render-worker-contract.ts` | 9 | conservada | 11 |
| `src/domains/production/composition-editor/qa/composition-render-authority.service.ts` → `src/domains/production/composition-editor/qa/composition-render-supervisor-binding.ts` | 8 | conservada | 6 |
| `src/domains/production/composition-editor/qa/composition-render-authority.service.ts` → `src/domains/production/composition-editor/qa/composition-supervised-comparison-artifacts.ts` | 7 | conservada | 3 |
| `src/domains/production/composition-editor/qa/composition-render-checkpoint.ts` → `src/domains/production/composition-editor/qa/composition-controlled-reference-selection.ts` | 8 | conservada | 10 |
| `src/domains/production/composition-editor/qa/composition-render-checkpoint.ts` → `src/domains/production/composition-editor/qa/composition-render-supervisor-binding.ts` | 7 | conservada | 6 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor-binding.ts` → `src/domains/production/composition-editor/qa/composition-controlled-comparison-artifacts.ts` | 5 | conservada | 10 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor-binding.ts` → `src/domains/production/composition-editor/qa/composition-controlled-event-comparison-artifacts.ts` | 6 | conservada | 5 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` → `src/domains/production/composition-editor/qa/composition-controlled-reference-selection.ts` | 12 | borrada | 10 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` → `src/domains/production/composition-editor/qa/composition-controlled-render-upload.service.ts` | 4 | conservada | 2 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` → `src/domains/production/composition-editor/qa/composition-render-authority.service.ts` | 3 | conservada | 5 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` → `src/domains/production/composition-editor/qa/composition-render-checkpoint.ts` | 11 | conservada | 8 |
| `src/domains/production/composition-editor/qa/composition-render-supervisor.service.ts` → `src/domains/production/composition-editor/qa/composition-render-supervisor-binding.ts` | 5 | conservada | 6 |
| `src/domains/production/composition-editor/qa/composition-supervised-comparison-artifacts.ts` → `src/domains/production/composition-editor/qa/composition-controlled-comparison-artifacts.ts` | 6 | conservada | 10 |
| `src/domains/production/composition-editor/qa/composition-supervised-comparison-artifacts.ts` → `src/domains/production/composition-editor/qa/composition-controlled-event-comparison-artifacts.ts` | 7 | conservada | 5 |

## Variación frente a F0.1

Base histórica: `37dcf7dcfb89d6289369b4c962423a02097b5293`. Fuentes inspeccionadas: 2260.

Comparación de declaraciones AST históricas, no ejecución de Madge sobre el checkout histórico.

| Referencia actual ausente en las declaraciones de la base | Consumidores actuales | Clasificación |
|---|---|---|
| `@/domains/publication/thumbnail-upload-policy` | 2 | resuelta por TypeScript |
| `@/lib/server/authorization-unavailable-response` | 29 | resuelta por TypeScript |
| `@/lib/server/server-identity` | 1 | resuelta por TypeScript |
| `@/lib/server/tenant-memberships` | 1 | resuelta por TypeScript |
| `@/lib/server/auth-identity-error` | 1 | resuelta por TypeScript |

Alias históricos ausentes de los warnings actuales: 0.

## Referencias fuera de la resolución TypeScript normal

- `tailwindcss`: import CSS; resolver separado. `src/app/globals.css`:1.
- `@/domains/materials/components/composition-editor/CompositionStudio.module.css`: no resuelta por TypeScript. `src/domains/production/composition-editor/qa/composition-toolbar-layout.fixture.tsx`:5.
- `server-only`: no resuelta por TypeScript. `src/domains/production/course-context/production-course-context.service.ts`:1.

El inventario completo se genera en .tmp/module-graph/inventory.json; no contiene
valores de configuración ni cuerpos de fuentes. Incluye referencias, consumidores
y ciclos complementarios. Este resumen se regenera con render-summary.mjs.
