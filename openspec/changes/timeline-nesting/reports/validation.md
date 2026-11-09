# Verificación de anidación del timeline — 2026-11-03

## Resultado y alcance

Implementación local en el checkout principal. Agrupar conserva clips visibles;
anidar guarda `timelineMode: "NESTED"` y muestra un solo bloque por contenedor.
El contenido conserva IDs, huecos, pistas, offsets, audio y motion. Doble clic o
Enter abre el contenido, Escape regresa al padre y desanidar promueve los hijos.
Un grupo ordinario que contiene una anidación conserva la selección y movimiento
de su unidad completa en el nivel actual.

La nueva proyección resuelve transiciones sobre el documento completo antes de
ocultar miembros. Evita fallos cuando una transición cruza el contenedor. La
duplicación y extracción narrativa conservan el modo en TypeScript y SQL.

## Evidencia ejecutada

| Verificación | Resultado |
| --- | --- |
| `npm run test:composition-nested-groups` | 22 pruebas aprobadas; incluye equivalencia exacta de HTML de preview/render, rango con huecos, duplicación, compatibilidad, capacidad, transiciones y recuperación. |
| `npm run test:composition-nested-groups:sql` | 7 pruebas aprobadas en PGlite local: modos inválidos, grafo, profundidad, límites, append, conflicto, permisos privados y delta narrativo sin pérdida del modo. |
| `npm run typecheck` | Exit 0 sobre la implementación final. |
| ESLint dirigido a los archivos TS/TSX del cambio, desde `apps/web` | Exit 0, sin relajar reglas. |
| QA Chromium del fixture existente ampliado | Exit 0: capacidad desactivada, agrupación visible, bloque único, movimiento por teclado y arrastre real, Enter, Escape y desanidación. |
| `npm run db:migrations:check` | Exit 0; 214 migraciones y colisiones históricas conservadas. |
| `git diff --check` del alcance | Exit 0. |

La QA se ejecutó con el runner compilado
`node .tmp/hyperframes-tests/domains/production/composition-editor/qa/run-composition-nested-groups-smoke.js`
desde `apps/web`, fuera del sandbox para iniciar Chromium headless. El fixture
usa componentes reales y persistencia en memoria; no acredita una sesión
autenticada, escritura Supabase remota ni fidelidad visual de la aplicación
completa. La captura del bloque y los logs quedan en `.tmp/` local.

PGlite se instaló exclusivamente en `.tmp/sql-verification`; no se agregó una
dependencia de producto. La ejecución SQL usa las funciones PostgreSQL reales
de las migraciones, con tablas mínimas sintéticas, sin conectar con producción.

## Compuertas amplias con fallos fuera del alcance

- `npm run verify:pr`: exit 1. Adaptadores, arnés y enlaces aprobaron; OpenSpec
  aprobó `timeline-nesting` y se detuvo por `diagnose-font-catalog`, un cambio
  ya versionado sin deltas de especificación. Se comprobó con
  `openspec validate diagnose-font-catalog --type change --strict --no-interactive`.
- `npm run verify`: exit 1 en lint global: 1646 errores, incluidos `require()`
  en JS generado bajo `apps/web/dist/composition-worker` y
  `html-editing/.tmp/unit`. No llegó a ejecutar el resto de su cadena.
- `npm run test:hyperframes --workspace=apps/web`: exit 1 al resolver
  `@/lib/server/outbound-http` desde `composition-agent-provider.service.js`.
- Regresión adicional de compilador, reducer y portapapeles: 127/128 aprobadas.
  La expectativa fallida exige la etiqueta antigua `SofLIA - Engine remote asset`;
  el HTML usa la identidad actual `SofLIA Architect remote asset`. No se modificó
  el compilador, la identidad ni esa expectativa para ocultar el fallo.

Los errores amplios están en archivos y expectativas ajenos al cambio. No se
ejecutó una segunda línea base aislada, por lo que no se afirma una certificación
integral del repositorio. Se conserva el trabajo ajeno del área de usuarios y
los reportes encontrados al iniciar.

## Revisión adversarial propia

- Esquemas estrictos rechazan modos desconocidos y requieren groupingVersion 2.
- Servidor comprueba capacidad SQL además de identidad, organización y hash
  existentes; ocultar un botón no concede autorización.
- La creación sigue limitada a operaciones USER; no amplía herramientas del agente.
- Desactivar creación permite leer, mover y desanidar documentos existentes.
- Ningún clip oculto se elimina del documento audiovisual ni de sus transiciones.
- La capacidad nueva no se anuncia en SQL hasta instalar la validación y la copia
  narrativa compatibles, dentro de una transacción.
- Revisión realizada por el mismo agente; no es una revisión independiente.

## Activación, límites y reversión

Aplicar con autorización la migración
`supabase/migrations/20261103010000_timeline_nesting.sql`, después de las dos
migraciones jerárquicas de 2026-10-29, y desplegar lectores/servidor/UI compatibles.
Requiere `COMPOSITION_NESTED_GROUPS_ENABLED=true`; el RPC debe anunciar
`timelineNesting: true`. La caché de capacidad dura 30 segundos.

No se aplicó SQL remoto, no se modificaron secretos ni configuración local, no
se desplegó ni se ejecutó render pagado. Para rollout, comprobar en destino
anidar → guardar → recargar → mover → abrir → desanidar y deshacer/rehacer con
un usuario autorizado y un borrador de prueba.

No hay rasterización ni recorte/efectos sobre el contenedor. Para recortar se
abre su contenido. El rango se calcula sobre las unidades seleccionadas, sin
capturar otros clips que se crucen temporalmente. Durante rollback deshabilitar
la creación y conservar lectores/migración mientras existan documentos con modo.

## Seguimiento del 2026-11-07

Anidar un único grupo completo conserva su ID y sus miembros. La operación
`group.nest` utiliza el guardado versionado y la capacidad de anidación
existentes. En Chromium se verificó que «Agrupar selección» queda deshabilitado
para ese caso, «Anidar selección» muestra un bloque, los clips ajenos siguen
visibles y el bloque se puede abrir tras recargar el documento del fixture.

- `npm run test:composition-nested-groups`: 24 pruebas aprobadas.
- `npm run test:composition-nested-groups:sql`: 7 pruebas aprobadas en PGlite.
- `npm run qa:composition-nested-groups --workspace=apps/web`: exit 0 con
  Chromium headless y persistencia en memoria.
- `npm run test:hyperframes --workspace=apps/web` y `npm run typecheck`: exit 0.
- ESLint dirigido: 0 errores y 17 avisos en código ajeno al cambio.
- `npm run docs:check` y validación estricta de `timeline-nesting`: exit 0.
- `npm run verify:pr`: exit 0 fuera del sandbox. El primer intento falló porque
  el sandbox impidió inicializar los repositorios temporales del arnés. El lint
  global del reintento terminó con cero errores y cero diferencias con el baseline.

La verificación corresponde al checkout local. El entorno de la captura requiere
despliegue compatible y confirmación de la capacidad SQL para guardar el modo.
