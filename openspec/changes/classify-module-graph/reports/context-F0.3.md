# Continuidad F0.3 — 2026-11-05

## Objetivo, base y resultado

Rama staging; HEAD de producto fd2a10611e658ba20fff415910356996b88f5069.
Se preservaron los cinco documentos modificados y la auditoría heredada fuera
del commit. El objetivo global sigue siendo el plan completo de remediación.
F0.3 queda cerrado localmente; TD-12 y F3.5 permanecen abiertos.

El [inventario resumido](inventory-summary.md) conserva versiones, hashes y las
46 aristas de cuatro componentes fuertemente conexas (26 módulos). Doce aristas
se borran al emitir CommonJS de forma aislada; 34 se conservan. Todas tienen
imports y líneas identificados, y el JSON local incluye consumidores entrantes.
Madge sigue reportando once recorridos; no son una enumeración exhaustiva.

Una primera proyección de solo las 29 aristas de esos once recorridos dejaba
visible un recorrido alternativo effects.service → text-presentation →
text-layer.types → effects.service. Por eso el diagnóstico final usa componentes
completas, con pruebas del algoritmo, en lugar de limitarse a la salida circular.
Al eliminar las doce aristas borradas de esas componentes no quedan ciclos en la
proyección. Esto NO modifica el gate ni acredita el bundle o ejecución de Next.

## Advertencias y causa comprobada

El comando existente procesa 2.282 archivos: once ciclos, 582 referencias únicas
no resueltas por Madge. F0.1 registró 2.262 archivos, once ciclos y 577 avisos.

- 579 referencias se resuelven con TypeScript y la base absoluta de tsconfig.
- Una es el import CSS de tailwindcss en globals.css: el paquete instalado declara
  exports["."].style = ./index.css; no se presenta su declaración .d.mts como CSS.
- Una es CompositionStudio.module.css desde la fixture de toolbar. El archivo
  existe; requiere el tratamiento de CSS del bundler, no resolución TS ordinaria.
- Una es server-only desde production-course-context.service. Next instalado
  declara el alias a next/dist/compiled/server-only y su tratamiento de servidor
  o cliente en dist/build/create-compiler-aliases.js. No se ejecutó un build aquí.

Madge 8.0.0 transforma el tsconfig parseado en un objeto compilerOptions;
filing-cabinet vuelve a convertirlo con convertCompilerOptionsFromJson. En esa
reconversión se pierde pathsBasePath. Prueba local sobre @/utils/auth/session:
configuración TS nativa resuelve session.ts; reconversión no resuelve; restaurar
solo pathsBasePath vuelve a resolver el mismo archivo. Fuentes instaladas:
madge/lib/api.js y filing-cabinet/index.js. No se modificaron dependencias.

El grafo complementario recupera 2.214 aristas entre nodos ya inventariados,
sin componentes nuevas ni aristas internas adicionales en las cuatro componentes.
Conserva los mismos once recorridos representativos. Es diagnóstico complementario,
no sustituto silencioso de la compuerta y no prueba de exhaustividad del bundler.

La comparación AST con 37dcf7dcfb89d6289369b4c962423a02097b5293 inspecciona
2.260 fuentes TS/TSX/CSS históricas: cinco referencias actuales estaban ausentes
en esa base; no hay alias históricos ausentes de los avisos actuales. Son
thumbnail-upload-policy, authorization-unavailable-response, server-identity,
tenant-memberships y auth-identity-error. Todos resuelven con TS. Esto explica
la variación de cinco avisos; no se ejecutó Madge sobre un checkout histórico.

## Grupos y orden de corrección

| Unidad siguiente | Alcance y dirección propuesta | Contratos a preservar | Validación prevista |
|---|---|---|---|
| F3.5.a | Captions: extraer validación de énfasis/fronteras a una función neutral que no dependa del schema de cues; conservar exports existentes | Zod, UTF-16/graphemas, efectos y presentación | caption-effects, caption-presets, texto y suite HyperFrames |
| F3.5.b | Documento/plan de captions/fuentes: separar contratos mínimos consumidos por planes del schema que los valida | Formato versionado, defaults, serialización, hashes y resolución de fuentes | documento, compilador, fuentes, captions y HyperFrames |
| F3.5.c | HTTP narrativa: mover NarrativeExtractionHttpAuthorization a contrato neutral compartido por handler genérico y adaptador de voz | Autoridad, tenant, timeout, rate limit, apply/recovery y estados inciertos | suites HTTP de narrativa y HyperFrames |
| F3.5.d1… | QA: dividir las 18 fuentes de fence/supervisor/materialización/comparación por contratos de ejecución, sin mover todo a un único archivo | Fence, worker, finalización, autoridad, checkpoints, audio/video y abortos | suites de cada subgrupo antes y después, más HyperFrames completo |
| F3.5.e | Resolver configuración del analizador y validar alias con canarios; clasificar CSS y server-only explícitamente | Mismas entradas y rechazo efectivo de ciclos, sin ignores que escondan código | canarios de alias y ciclos, grafo completo, tipos y verify:pr |

Cada unidad requiere su OpenSpec/escenarios antes del código. El plan es una
hipótesis acotada: verificar todos los consumidores antes de elegir cada extracción.
No convertir import type en una exclusión global para declarar aprobado el gate.
Los lotes HTTP F1.3.c.3.c.4 y siguientes conservan su alcance en su tablero.

## Reproducción y evidencia

Desde la raíz, con dependencias instaladas:

```powershell
node --test openspec/changes/classify-module-graph/reports/import-analysis.test.mjs openspec/changes/classify-module-graph/reports/graph-components.test.mjs
node openspec/changes/classify-module-graph/reports/inventory.mjs
node openspec/changes/classify-module-graph/reports/compare-baseline.mjs 37dcf7dcfb89d6289369b4c962423a02097b5293
node openspec/changes/classify-module-graph/reports/render-summary.mjs
npm run verify:pr
```

Salidas completas locales en .tmp/module-graph, no tolerancias del gate:

| Comprobación | Resultado y evidencia local |
|---|---|
| Clasificador y componentes | 0; ocho pruebas aprobadas, classifier-tests-final.log |
| Inventario final | 0; inventory-final.log e inventory.json |
| Comparación histórica | 0; baseline-comparison.log/json |
| verify:pr inicial restringido | 1; pruebas del arnés no pudieron crear config Git en directorios temporales, verify-pr.log |
| verify:pr autorizado | 1 por los once ciclos; adapters/harness/docs/OpenSpec aprobados, 43/43 OpenSpec, 26/26 arnés, lint cero errores/572 warnings sin diferencias, tipos aprobados; verify-pr-retry.log |
| docs:check final | 0; 297 documentos comprobados; docs-final.log |
| openspec:validate final | 0; 43/43, openspec-final.log |

La repetición autorizada terminó y no quedan procesos de estas comprobaciones.
No se ejecutaron suites de producto posteriores al paso architecture:cycles,
que corta el gate, ni build, CI, render, servicios externos o SQL. No se atribuye
a esta unidad la ejecución de suites realizada en lotes anteriores.

## Revisión adversarial propia y límites

Se comprobó que CSS no se analizara como TS y que JSON no generara imports
espurios. Se probaron imports explícitos/implícitos de tipos, imports mixtos,
reexports, dynamic import, require, referencias repetidas, componentes alternativas,
componentes conectadas en una dirección, autorreferencias y nodos sin entrada.
No es una revisión independiente ni una prueba de inicialización real del bundle.

El script solo lee fuentes TS/TSX/CSS, configuración versionada y metadatos de Git;
escribe el inventario local y su resumen. Sin lectura de .env ni secretos, acceso
remoto o modificaciones al producto/gate. No se descartan aristas sin evidencia.
Reversión: revertir el commit local de esta unidad. La aceptación final de TD-12
requiere corregir los grupos y aprobar el comando, con advertencias explicadas.
