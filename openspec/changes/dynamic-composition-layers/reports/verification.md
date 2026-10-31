# Evidencia — 2026-10-31

## Entrega local

El inspector incorpora gestión de capas independiente de la selección de clips.
El documento registra extras vacías y ocupadas; el selector y las flechas usan
únicamente profundidades disponibles. Las capas base y los defaults no cambian.
La validación compartida limita la profundidad a 1000, exige registro previo y
reserva altas/bajas al usuario. El agente conserva su allowlist anterior.

Quitar una capa ocupada usa dos confirmaciones nativas, cuenta elementos ocultos
y envía IDs exactos. El dominio valida ocupación y bloqueos antes de quitar clips;
los errores no mutan el documento original. Se reutilizan limpieza de referencias,
historial, cola local y precondiciones ETag. No se agregaron dependencias ni SQL.

## Verificaciones

- `npm run typecheck`: aprobado después de los cambios de interfaz y QA.
- Compilación `tsc -p apps/web/tsconfig.hyperframes-test.json`: aprobada.
- `editor-patch.service.test.js`: 83/83 aprobadas, incluidas cinco pruebas nuevas
  de capas, lectura serializada, restauración, confirmación obsoleta, bloqueo,
  entradas inválidas y rechazo atómico si se eliminara el último clip automático.
- Prueba `preview y render conservan la profundidad adicional registrada`:
  aprobada para ambos destinos de compilación.
- `npm run qa:composition-layers --workspace=apps/web`: aprobado con Chromium;
  altas 11/12, selector real con autoguardado, flechas que saltan una capa quitada,
  baja vacía sin renumerar, cancelación en cada confirmación, baja ocupada y bloqueo.
  El sandbox dejó las ejecuciones de navegador sin completar: se interrumpieron
  esas ejecuciones y se repitió el script con permiso de procesos ampliado.
- ESLint focalizado en gestor, selector, contrato, patches y QA: aprobado.
- `npm run test:remotion --workspace=apps/web`: aprobado.
- `npm run docs:check`: aprobado, 181 documentos en la revisión final.
- `openspec validate dynamic-composition-layers --type change --strict --no-interactive`:
  aprobado.
- `git diff --check`: aprobado.

## Bloqueos generales observados

- `npm run architecture:cycles`: interrumpido sin resultado tras permanecer en
  `Finding files`; no se declara aprobado. Las salidas locales de los comandos
  se conservaron en `.tmp/dynamic-composition-layers/` (no versionadas).

- `npm run verify:pr`: código 1 al validar `diagnose-font-catalog`, un cambio
  OpenSpec ajeno. Adaptadores, arnés y enlaces pasaron; el cambio nuevo pasó
  OpenSpec. La compuerta no llegó a todas sus fases de producto.
- `npm run test:hyperframes --workspace=apps/web`: código 1 al cargar
  `@/lib/server/outbound-http` desde `composition-agent-provider.service` en
  `composition-agent-model-output.test`. El import ya existe en HEAD y no se
  modificó. La primera corrida detectó además una expectativa 0–10 propia del
  contrato anterior; se actualizó a profundidades extra y límite técnico.
- Regresiones seleccionadas de 13 archivos compilados, con `node --test
  --test-concurrency=1`: 218/219 aprobadas. El único fallo exige el texto
  `SofLIA - Engine remote asset` en el compilador, mientras el producto genera
  `SofLIA Architect remote asset`. La expectativa antigua se comprobó en HEAD.
  Esta corrida precede la quinta prueba de capas; la repetición final del archivo
  de patches pasó sus 83 pruebas. No se relajaron verificadores.

## Revisión adversarial y límites

Revisión propia, sin agente independiente: comprobados mínimos/máximos, capas
base protegidas, registro ordenado/único, ocupación oculta, IDs obsoletos, pistas
bloqueadas, rollback sin efectos parciales y política del agente. No se leyeron
secretos ni se mutaron servicios remotos.

La QA usa los componentes reales y el reducer con documento sintético; no acredita
guardado en Supabase, flujo completo autenticado, build de producción, render cloud
ni comparación de MP4. El test de lectura es un roundtrip JSON y validación, no
una consulta remota. El rollback debe mantener lectores compatibles si ya hay
documentos con `extraLayerDepths`. Integración, despliegue y archivo pendientes.
