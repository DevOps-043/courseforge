# Verificación de la adaptación del arnés de Coursegen

Fecha: 2026-10-15. Estado: implementación local; no integrada en staging.

Entorno local: Windows, Node 26.7.0, npm 11.19.0. El workflow conserva Node 22;
su ejecución remota no se acredita con las comprobaciones locales.

## Alcance y aislamiento

- Rama: codex/coursegen-harness.
- Base inicial: staging, commit 7e16e8c350b1b8c5453875bc26e67be4ab5b03b1.
- Worktree: C:/Users/fysg5/Desktop/SofLIA/Soflia Engine/.worktrees/coursegen-harness.
- Se preservó el checkout original y sus cambios de trabajo. staging avanzó
  durante la tarea; esta rama mantiene la base fijada al comenzar.
- No se modifican archivos de apps/, migraciones, .env ni configuración personal.
- El worktree se reubicó fuera del repositorio principal: npm consultaba el
  workspace padre mientras otro trabajo modificaba su package.json. La primera
  ejecución desde el worktree anidado se interrumpió; las verificaciones
  reportadas como completadas se ejecutaron en la ubicación aislada.

## Implementación

Router AGENTS.md, estándares con 17 áreas, contexto canónico, nueve skills y
27 wrappers para Codex/Claude/Antigravity; roles documentales sin permisos runtime.
OpenSpec 1.8.0 como dependencia de desarrollo, validadores de estructura/enlaces,
detección de wrappers huérfanos y compuertas npm. El CI añade el arnés y conserva
las comprobaciones de producto, compliance, QA visual, build y auditoría.

Las guías reemplazadas se conservaron como histórico. README, contexto operativo,
protocolo y auditor documental apuntan a las fuentes nuevas. La auditoría
generada sigue ignorada por Git; no se convierte en una tercera fuente canónica.

## Comprobaciones completadas

| Comando o inspección | Resultado |
| --- | --- |
| npm ci --ignore-scripts --no-audit --no-fund | Aprobado; instalación aislada sin ejecutar hooks. |
| Comparación de lockfile con HEAD | Ninguna versión existente modificada; 44 resoluciones nuevas de desarrollo. |
| npm run docs:audit | Aprobado; contraste y límites añadidos al reporte temporal. |
| npm run verify:harness | Aprobado: adaptadores, estructura, enlaces, OpenSpec y 16 pruebas. |
| npm run typecheck | Aprobado para web. |
| npm run lint:legacy-api | Aprobado: tsc --noEmit del API. |
| node --check sobre scripts nuevos | Aprobado. |
| git diff --check | Aprobado; avisos de normalización CRLF no son errores de whitespace. |
| git diff --quiet HEAD -- apps | Código 0: producto sin cambios. |
| npm run verify | Código 1 en lint por el defecto de la base descrito abajo. |
| npm run verify:pr, ejecución final | Código 1: adaptadores, estructura, enlaces, OpenSpec y las 16 pruebas del arnés aprobaron; se detuvo en el mismo lint de producto. |

Las 16 pruebas cubren sincronización determinista/CRLF, divergencia, huérfanos,
metadatos/rutas, destinos enlazados, archivos obligatorios, registro y exposición
runtime, estándar, archivos locales sensibles, enlaces con espacios, deuda
histórica, enlaces ya comprometidos frente a la base del PR, referencia base
inexistente, preservación de la compuerta de producto y parada con código real.

## Bloqueo demostrado de la base

ESLint informa @typescript-eslint/no-this-alias en
[composition-playback-boundaries.test.ts](../../../../apps/web/src/domains/production/composition-editor/__tests__/composition-playback-boundaries.test.ts),
línea 102, columna 20. Ese archivo no cambió respecto a HEAD.

Se reprodujo también analizando directamente el contenido de HEAD con ESLint:

```powershell
# Desde apps/web
git show HEAD:apps/web/src/domains/production/composition-editor/__tests__/composition-playback-boundaries.test.ts |
  node ../../node_modules/eslint/bin/eslint.js --stdin --stdin-filename src/domains/production/composition-editor/__tests__/composition-playback-boundaries.test.ts --quiet
```

Resultado: código 1 y la misma regla/ubicación. No se debilitaron reglas ni se
modificó la prueba ajena para obtener una compuerta verde. El gate de producto
se detiene en lint; sus pasos posteriores no se acreditan por esa ejecución.
Los chequeos de tipos web/API sí se ejecutaron de forma independiente.

## Revisión y límites

Revisión adversarial local por el mismo agente; no se presenta como independiente.
Se revisaron separación de runtime, rutas, enlaces, wrappers huérfanos, códigos de
salida, entorno de pruebas, base de comparación en CI y preservación de controles.
Los casos negativos se ejecutan en repositorios temporales con limpieza acotada.

La validación estructural no demuestra cumplimiento semántico de las reglas.
docs:check no prueba anclas ni disponibilidad web y conserva la deuda histórica
de enlaces no modificados. El contexto operativo heredado no fue una auditoría
funcional completa de cada capacidad del producto.

No se ejecutaron CI remoto, build, QA visual, publicación, render cloud ni
migraciones remotas. Los hooks de instalación omitidos no acreditan disponibilidad
de componentes nativos opcionales. Las herramientas del producto conservan sus
permisos; Markdown y registro JSON no conceden capacidades ejecutables.

## Reversión e integración

Revertir el commit de esta adaptación restaura routers, scripts, dependencia y CI;
no hay cambios de datos. Mantener este cambio OpenSpec activo hasta integrarlo,
sincronizar sus especificaciones y archivar. La rama principal y su trabajo
posterior requieren revisión de integración por separado.
