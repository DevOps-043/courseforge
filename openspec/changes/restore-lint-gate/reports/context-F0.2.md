# Continuidad F0.2 — 2026-11-05

Zona America/Mexico_City; responsable Codex. Base 9362ae1c, staging. Objetivo
global activo: completar el plan de deuda técnica, sin reducirlo a este lote.
Estado: F0.2 cerrado como unidad local verificada. TD-08
permanece resuelto pendiente de aceptación en CI Linux y lifecycle scripts.

## Diagnóstico y solución

El preset Next limita su bloque plugins por extensión y no incluye cjs; los
overrides locales eran globales. calculateConfigForFile reproduce el fallo solo
en cjs; TSX/MJS sí cargan plugins. eslint.config.mjs registra globalmente los mismos
objetos plugin del preset. Los niveles existentes se conservan, sin upgrades.

El primer lint completo tras corregir plugins da 1.653 errores y 601 warnings.
1.646 errores y 29 warnings corresponden a dist/.tmp compilados no versionados;
git ls-files no lista archivos en esas salidas. Las siete infracciones restantes
son require en el script QA cjs. Se excluyen solo esos artefactos generados y se
convierten esos imports a import dinámico dentro de main, manteniendo el comando
histórico y la lógica QA. Los canarios comprueban selección y reglas efectivas.

Lint de fuentes: 2.367 archivos, cero errores, 572 warnings en 193 archivos.
El baseline final schemaVersion 2 identifica archivo/regla/huella SHA256 de línea
sin indentación y su multiplicidad. Rechaza sustituciones aunque el conteo sea
igual y conserva identidad al desplazar líneas. Obliga a reducir tolerancias
cuando desaparecen warnings. No acepta errores. npm run lint pasa por el runner
que conserva diagnóstico íntegro en apps/web/.tmp/lint/latest.json; no hay modo
automático para aceptar baseline. test:harness incluye seis pruebas de la política
y de ESLint real (canarios rules-of-hooks y prefer-const).

Distribución: no-explicit-any 327; no-unused-vars 75; set-state-in-effect 75;
exhaustive-deps 22; refs 21; prefer-const 13; no-img-element 9;
no-assign-module-variable 8; no-unescaped-entities 8; no-html-link-for-pages 6;
immutability 6; no-empty-object-type 2. Son deuda visible, no correcciones acreditadas.
jsx-ast-utils emite dos avisos por TSNonNullExpression fuera de los diagnósticos
estructurados; el log original los conserva. No se silencia ese stderr.

## Evidencia

| Comando | Resultado | Archivo |
|---|---|---|
| Config efectiva de extensiones tras corregir plugins | 0 | plugins-after.log |
| ESLint completo tras registro de plugins | 1; errores de artefactos y siete imports QA | lint-full.json / lint-full.log |
| ESLint de fuentes tras ajustes | 0; 2.367 archivos, 0 errores, 572 warnings | lint-source.json / lint-source.log |
| node --test scripts/quality/lint-warning-baseline.test.mjs | 0; 5/5 | canary-final.log |
| node --check script QA cjs | 0 | Comando directo, sin ejecutar browser |
| npm ci aislado offline, sandbox | -4048; no permite mkdir de node_modules | npm-ci-isolated.log |
| npm run lint (runner con baseline) | 0; cero diferencias | lint-gate.log |
| npm run lint con archivo canario nuevo | 1; detecta prefer-const, sin errores | cli-warning-canary.log; wrapper exige ese 1 y retira su archivo en finally |
| Node22 temporal | 0; v22.23.4 | node22-retry.log; primer intento offline ENOTCACHED |
| Canarios con Node22 | 0; 5/5 | canary-node22.log; dependencias principales, no instalación limpia |
| npm ci aislado offline con subprocesos habilitados | 0; 2.265 paquetes, 18 min | npm-ci-isolated-retry.log; ignore-scripts |
| Lint limpio con Node22 | 0; mismos 572 warnings, sin diferencias | lint-clean-node22.log |
| Tipos fríos limpios con Node22 / heap automático | 134; OOM aproximado a 2 GiB | types-clean-node22.log |
| Tipos fríos limpios con Node22 / heap 4 GiB | 0 | types-clean-node22-4gb.log |
| npm run typecheck tras fijar heap explícito | 0 | typecheck-final.log; sin excluir fuentes |
| Huellas de reportes local y limpio | 0; idénticas | baseline-signatures.log |
| Canarios definitivos local / limpio Node22 | 0; 6/6 en cada uno | canary-signatures.log / canary-clean-node22.log |
| Runner definitivo limpio Node22 | 0; cero diferencias | lint-clean-node22-signatures.log |
| QA Chromium instrumentada de subtítulos manuales | 0; fixture local sin generación | manual-caption-qa-instrumented.log |
| verify:pr previo a huellas finales | 1; 41 OpenSpec, 25 tests arnés, lint y tipos aprueban; 11 ciclos | verify-pr.log; 2.277 archivos, 582 warnings Madge |
| verify:pr final con huellas y heap de tipos | 1; 41 OpenSpec, 26 tests arnés, lint y tipos aprueban; 11 ciclos | verify-pr-final.log; no se omiten ni ignoran ciclos |
| docs:check y openspec:validate finales | 0 / 0; 41 ítems OpenSpec | docs-final.log / openspec-final.log |
| git diff --check | 0 | Sin errores; advertencia CRLF del script QA |

## Proceso y límites

Instalación aislada en .tmp/remediation-lint-clean con manifests/lockfile y después
2.385 fuentes/configuraciones versionadas copiadas por lista Git, sin .env ni
configuraciones personales; npm ci --ignore-scripts --offline. El
reintento habilita subprocesos/escritura de carpetas de dependencias, nunca toca
node_modules principal. Omitir lifecycle scripts no certifica build ni binarios.
Node local 24.19.0; runtime alternativo disponible 24.22.1; CI usa 22.

La QA inicial dentro del sandbox siguió viva sin resultado observable; se añadió
diagnóstico de etapas y manejo de error al abrir el servidor local. La ejecución
instrumentada fuera del sandbox aprobó. Después se retiraron exclusivamente el
proceso del script anterior y su hijo esbuild, con comando/parentesco verificados;
el handle 79323 terminó -1 por esa limpieza, no se contabiliza como prueba aprobada.
Dos probes acotados de esbuild (sandbox/no sandbox) aprueban; no se acredita causa
raíz del bloqueo anterior ni se atribuye a los imports. No quedan QA/instalación
anteriores en ejecución.

Todos los handles de verificaciones de esta unidad están terminales. No reiniciar
un proceso por timeout de observación; no quedan verificaciones esperando resultado.

Se preservan README.md, TECHNICAL_DEBT_AUDIT.md, docs/README.md,
docs/TECHNICAL_DEBT_ANALYSIS.md, docs/architecture/system-context.md y documentación
no versionada heredada. El plan principal recibe solo actualización de autorización
y enlaces de tableros. No hay SQL, despliegue, publicaciones ni proveedores pagados.

Checkpoint local: el commit que contiene este registro reúne solamente F0.2;
consultar git log para su identificador. Plan, hallazgos y auditoría heredados
se conservan fuera del commit. Pendiente: aceptación CI con lifecycle scripts.
Después F1.3.c.3.c
(subdividir producción por capacidad) y F0.3 (clasificar ciclos) quedan habilitados.
El alcance completo del objetivo sigue en docs/technical-debt/remediation-plan.md.

## Revisión y reversión

Revisión propia con adversarial-review; sin independencia. El baseline inicial
por cantidades permitía reemplazos de un warning por otro: corregido mediante
huellas y canario específico. El baseline no tolera más errores ni actualiza sus
entradas automáticamente; toda reducción exige retirar su permiso. Las huellas
no contienen código ni rutas absolutas. La equivalencia de reportes contrasta
efectivamente la portabilidad entre los dos árboles de dependencias.

Una huella identifica línea de código y regla, no semántica del AST completo:
cambios de formato dentro de la línea pueden exigir resolver el warning o revisar
su identidad. No prueba ausencia de deuda ni que cada warning sea inocuo. No se
ejecutaron build, audit de dependencias ni despliegue. No se certifica Windows como
equivalente a Ubuntu CI. Dos avisos del proveedor jsx-ast-utils siguen visibles.

Reversión: commit local de F0.2, conservando un gate bloqueante; no restaurar
quiet ni aumentar baseline para ocultar deuda. El hash SHA256 del lockfile
permanece 481690538CD0DF697BAC88EA65CF9339814FC771E823BFF38725B27662340538.
