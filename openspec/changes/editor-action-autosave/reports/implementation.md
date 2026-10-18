# Implementación de autoguardado por interacción

Fecha: 2026-10-17. Rama: codex/fix-heygen-preset-handoff. Base: 64606f73.
Entrega local, sin integración ni despliegue. Se preservó el trabajo previo de
presets y guardado de escenas HeyGen.

## Resultado

Se retiraron las 13 instancias de Guardar inventariadas. Geometría, recorte,
profundidad, color, audio/fades/curva, velocidad, parámetros de animación, poses,
texto, captions e importaciones usan un controlador común. No se añaden llamadas
al proveedor ni generación de medios al editar una propiedad.

- `composition-interaction-autosave.ts`: sesión de edición, último valor por
  interacción, deduplicación, estado inválido/error y coordinador serial.
- `CompositionAutosaveBoundary.tsx`: integra eventos y snapshots de formularios;
  preview continuo, commit al terminar gesto o tras 600 ms de pausa, blur/Enter,
  composición IME y finalización de operaciones asincrónicas.
- Los controles conservan sus validaciones y emiten los patches existentes.
  Se filtran patches sin cambios efectivos antes de persistir una versión.
- Los inspectores no sincronizan valores remotos sobre un borrador local pendiente.
  Campos numéricos vacíos no se convierten automáticamente en cero.
- El toolbar distingue Pendiente de Guardado. Los errores se muestran localmente
  y las recuperaciones son acciones excepcionales explícitas, no guardados de rutina.
- Las acciones que calculan lotes (intro, reorganización, selección y cortes)
  vacían primero los formularios y releen el documento/clip vigente. No restauran
  un documento calculado antes de confirmar la edición pendiente.
- Deshacer/rehacer vacía primero las ediciones válidas. También se coordinan
  selección, cambio de pestaña/lección, comparación de presets, propuestas,
  publicación y operaciones de entrega. La navegación completa advierte si hay
  trabajo pendiente; un cierre forzado no puede garantizar preservar datos inválidos.

## Persistencia y recuperación

`composition-pending-edits.ts` conserva comandos admitidos en localStorage antes
de encolarlos, con schema, límite de 50 comandos/2 MiB y vigencia de 24 h. El
documento del servidor sigue siendo la fuente de verdad y mantiene CAS/If-Match,
validación, permisos y organización. La copia local no concede autoridad.

La cola existente continúa cancelando envíos posteriores ante un fallo; sus
descriptores todavía no enviados permanecen en la copia recuperable. Se muestran
sus resúmenes y una acción explícita de recuperación. Cada entrada se comprueba
contra la base vigente. Confirmar un comando sólo rebasa entradas de su misma
base; no reinterpreta automáticamente pendientes de otra sesión o versión.

La escritura en curso mantiene su journal de base/target/hash y usa la identidad
del comando pendiente. Si no se puede registrar ese seguimiento, no se envía.
Tras timeout/conflicto se consulta el documento antes de continuar. Si el target
ya está confirmado, se limpia sólo el borrador asociado; si la base cambió se
conserva el conflicto y su revisión explícita. No hay reintento por rerender.

Las sesiones desmontadas conservan borradores fallidos hasta resolverlos; los
registros confirmados se liberan. El editor se identifica por draftId para no
mezclar coordinadores al cambiar de composición.

## HTML

Los campos escalares, rangos declarados, gráficos y orden de slots se validan y
guardan mediante el puerto editorial existente. Se retiran Preparar y Guardar
lote. Restaurar un elemento completo sigue siendo una acción atómica explícita.
Permanecen host autorizado, hashes, recibos, adopción de revisión y deshacer/rehacer
HTML; no se escribe esa revisión mediante el PUT genérico del documento.

Se conservan las decisiones de inicializar/adoptar recursos, aplicar propuestas,
procesar audio, crear presets, preparar/aprobar snapshots, renderizar y publicar.
No se intenta revertir cargos, archivos físicos ni procesos externos con undo.

## Verificación ejecutada

- `npm run test:composition-autosave --workspace=apps/web`: salida 0, 21/21.
  Incluye regresiones de aislamiento de base, serialización de controles y
  confirmación del borrador concreto tras comprobar persistencia remota.
- `npm run typecheck`: salida 0 tras los ajustes de recuperación y coordinación.
- ESLint directo `--quiet` sobre los archivos del cambio: salida 0.
- Comprobación final sin `--quiet` de NativeCompositionPreview, CompositionInspector
  y CompositionTextControls: salida 0, sin errores y con 25 advertencias de hooks,
  efectos y variables sin uso. No se declara lint libre de advertencias.
- QA de interacción en Chrome headless: 10 escenarios pasaron. Incluye texto
  con pausa/blur sin duplicación, cambio asincrónico, error sin reintento automático,
  recuperación explícita, posición del inspector, número vacío y corrección,
  25 eventos de recorte con un solo patch, profundidad con Enter+blur, color,
  campo HTML y cierre con cambio pendiente (algunos escenarios agrupan comprobaciones).
- El fixture usa componentes reales pero persistencia simulada y clases CSS
  vacías para aislar interacción. No es QA visual del producto autenticado ni una
  prueba de su API/BD. No se contactó a HeyGen ni se consumieron créditos.
- Script reproducible: `apps/web/tools/qa/composition-autosave.smoke.mjs`.
  Requiere suites TS compiladas, Playwright y un navegador instalado. En este
  entorno se usó el runtime de dependencias proporcionado por Codex y el canal
  Chrome mediante AUTOSAVE_QA_BROWSER_CHANNEL. Resultados/screenshot en
  `apps/web/.tmp/autosave-qa/` (artefactos locales ignorados).
- `npm run test:hyperframes --workspace=apps/web`: falla en
  composition-agent-model-output.test por MODULE_NOT_FOUND del alias
  `@/lib/server/outbound-http` en composition-agent-provider.service, ambos fuera
  del diff. No se afirmó suite completa aprobada ni se modificó su configuración.
- `npm run verify:pr`: adapters:check, harness:validate y docs:check pasaron
  (80 documentos); la compuerta se detuvo porque no está instalada la CLI
  OpenSpec declarada por el proyecto. No se afirmó aprobación de verify:pr.
- `git diff --check`: salida 0; se corrigieron espacios residuales y se verificó
  el conteo de controles, sin botones Guardar de los 13 tipos inventariados.
- Ejecución independiente de pruebas de edición, preview, telemetría, medios
  standalone y contratos/historia HTML: 154 casos pasan; el módulo adicional de
  recuperación del agente falla por el mismo alias no resuelto. No se oculta ese fallo.
- Compilaciones/fixtures iniciales fallaron durante el desarrollo por un cierre
  JSX y por dependencias de Node/CSS en el fixture browser. Se corrigieron el JSX
  y el fixture sin debilitar validación del producto. El fixture no empaqueta
  servicios Node dentro del navegador.

## Revisión adversarial del mismo autor

- Se revisaron respuestas tardías, reinicios por props, entradas incompletas,
  callbacks desmontados, escrituras concurrentes, fallos de almacenamiento y
  reintentos tras resultado desconocido.
- Se corrigieron retención de sesiones limpias, deduplicación durante un commit,
  la asociación de cada copia con su borrador y el rebase indebido de otra base.
- Los comandos en localStorage se validan antes de recuperar y todas las
  operaciones conservan las autorizaciones y pertenencia a organización del API.
- No se cambiaron dependencias, tablas, licencias, SDKs, rutas del proveedor,
  credenciales ni el contrato editable V2. No hay nuevas excepciones de lint.

## Límites y validación pendiente

No se ejecutó una sesión autenticada, SQL remoto ni render real. CI y QA deben
comprobar end-to-end la composición completa con red lenta, 409/403, dos pestañas,
las capacidades opt-in y las recuperaciones de recibos HTML. Los tests del fixture
no prueban todos los controles condicionales ni el host remoto de HTML.

Se conservan los límites del historial: 50 acciones/20 MiB de sesión, consulta de
20 versiones persistidas. El editor sigue bloqueando controles incompatibles
durante una escritura. No se promete edición offline ilimitada ni sincronización
colaborativa. La copia local depende de que el navegador permita almacenamiento.

Al cancelar un pointer en un control nativo se finaliza el último valor válido,
en lugar de prometer una reversión visual genérica que el control no implementa.
Esta precisión sustituye la propuesta inicial de cancelar cualquier gesto.

Rollback: revertir los componentes y controlador de autoguardado; conservar los
documentos V2 ya persistidos. No se deben borrar automáticamente copias locales
pendientes ni reescribir versiones históricas.
