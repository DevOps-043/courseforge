# CAP-029 — expediente de validación integral

Fecha: 2026-10-08. Estado: **preparado, no habilitado para aceptación final**.
No certifica implementación completa ni QA aprobado. Último corte técnico
registrado:721/721 pruebas CAP029/contratos y5/5 offline; compilación/tipado
aprobados; perfil geometry-v8. Lint de módulos nuevos sin warnings; el componente
compartido tiene advertencias fuera del bloque modificado, sin errores.

## 1. Alcance y fuentes

Objetivo: HTML editable con fuente inmutable, manifest/tokens/overrides tipados,
operaciones OP021–028, historial/recuperación, sandbox e integración preview/render.
Fuentes de verdad: roadmap §4 y Fase4, requisitos R19–R22, plan de cierre CAP029.
El tester valida comportamiento observado, no cantidad de tests o porcentaje.

- [Roadmap](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md).
- [Cierre y cortes de implementación](SOFLIA_ENGINE_CAP029_COMPLETION_PLAN.md).
- [Reservas de trabajo](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_PARALLEL_DEVELOPMENT_HANDOFF.md).

Este expediente es propio de CAP029; no modifica trackers globales ni asignaciones.
Catálogo UX sigue reservado al compañero. CAP022/025/027 no se implementan aquí.
Conformidad visual utiliza el gate existente CAP027 cuando su dueño lo entregue;
no introducir otro motor de medición ni usar QA de strings como paridad visual.

### Estado consolidado para el tester

- Legado: instrumentación/verificación, preparación pura, repositorio/HTTP y RPC
  transaccional preparados con aprobación independiente, provenance y recibos.
  Migración propia sin aplicar; transporte/journal/coordinador recovery preparados,
  todavía sin revisión/confirmación/host/recovery center visibles conectados.
  Tests/fakes y revisión SQL estática no demuestran retención,
  rollback, RLS o concurrencia en PostgreSQL.
- Geometría: gramática SVG/path/viewBox, límites CSS/presentación/motion-path,
  shorthands y expansión solicitada de grid/columnas. No prueba layout/pintura
  efectivos, tracks implícitos, fragmentación ni contención física de ejecución.
- Histórico: diagnóstico offline y candidato V2 separado para revisión desde
  V1/perfil anterior; restore original rechazado. Falta inventario autorizado y
  publicación/recovery. Hash igual no acredita paridad visual ni permiso.
- Preview publicado: PAGE/RENEWAL verifica revisión tenant-scoped, bundle, medios
  y fuentes antes de descarga/firma. Host/runtime conservan revisión y playback
  durante renovación sobre MessagePorts reales; DOM/medios/HTTP son fixtures.
  UI compartida conecta revisionId de la publicación activa solo con hash exacto;
  comparación fija identidad al abrir y renovación la conserva desde la URL.
  Legacy editable sigue422 sin fallback. Selección de identidad probada con dos
  casos nuevos y regresión de transporte existente; no acredita recorrido
  browser/render real.
- Catálogo UX: entrega externa reservada, sin aceptación/integración acreditada.

Detalles y resultados de cada corte se conservan en el plan de cierre. Los
conteos históricos no son el estado vigente ni una prueba acumulada de aceptación.

## 2. Puerta de entrada: implementación vs ambiente vs QA

| ID | Pendiente | Clasificación | Evidencia necesaria para retirarlo |
| --- | --- | --- | --- |
| I01 | Inventario/migración piloto de legado y provenance source/template/renderer/sanitizer | Implementación e integración por auditar | Recorrido completo original→candidato revisado→instalación autorizada→native pointer; versiones verificables, sin sobrescribir original |
| I02 | Cobertura restante de geometría CSS/SVG implícita | Implementación por auditar | Política cerrada para sinks admitidos, incluidos viewBox→viewport y paths relativos; negativos dirigidos y límites de ejecución independientes |
| I03 | Continuidad histórica de snapshots V1 y perfiles de compilación anteriores | Compatibilidad funcional pendiente | Inventario autorizado: si hay V1 o perfiles previos, ejecutor histórico fijado o nueva publicación explícita revisada; nunca recompilar silenciosamente |
| I04 | Inspector/inicialización/publicación desde todos los contextos soportados | Integración por auditar | Matriz de consumers saved/current/baseline/preset/agent, contexto/owner correcto y rechazo explícito de casos no soportados |
| I05 | Catálogo UX del compañero | Entrega externa reservada | Contrato/entrega aceptados e integración por dueño acordado; no duplicar implementación |
| A01 | Migraciones y autorización transaccional en ambiente | Preparación/validación del ambiente | Historial de DB reconciliado; funciones/RLS/locks/grants instalados bajo autorización, pruebas tenant/concurrencia reales |
| A02 | Templates, flags y paquete runtime operativo | Preparación de ambiente | Instalación/versiones aprobadas, build repetible y archivo/input pins presentes en deploy |
| Q01 | Comportamiento browser, accesibilidad y paridad render | QA pendiente | Casos de este expediente con navegador, recursos y renderer reales; logs/evidencia reproducibles |

No mover I01–I05 a «solo QA» sin probar su entregable. Ausencia del tester no impide
cerrar implementación; tampoco autoriza decisiones de ambiente o trabajo reservado.
No cerrar CAP029 con I01–I05 abiertos. A01/A02 deben estar resueltos para ejecutar
QA auténtico, aunque no se desplieguen durante el trabajo de implementación.

### Decisiones de integración pendientes

1. Reserva de bloques HTML en NativeCompositionPreview/CompositionComparisonPane
   autorizada por el usuario el 2026-10-08 para pasar revisionId exacto a
   URL/host/renewal. El wiring se limita a NativeCompositionPreview; no es necesario
   editar el pane, que ya recibe URL y callback de conexión.
2. [Reserva transaccional de adopción](SOFLIA_ENGINE_CAP029_LEGACY_ADOPTION_INTEGRATION.md):
   repositorio/handlers/rutas HTML propios y numeración de migración para preparar,
   sin aplicarla, autorizados por el usuario el 2026-10-08. Backend/HTTP/migración
   preparados; integración cliente y aprobación real pendientes.
   Cambios de append/gateway compartido necesitan acuerdo aparte.
3. Contrato con dueño CAP027 para límites/evidencia efectiva de ejecución/layout;
   no crear un segundo motor ni tomar el estado inactivo de su chat como cesión.

Resolver estas decisiones no autoriza aplicar SQL, activar flags/templates,
desplegar ni aprobar catálogo. QA formal sigue separado del código faltante.

## 3. Preparación autorizada del ambiente

Usar tenant QA con dos usuarios reviewer, un usuario sin permiso y un tenant ajeno;
sin datos de producción. Crear dos drafts con clips distintos y un draft sin HTML
editable para regresión. Instalación y flags son tarea del operador, no instrucciones
para activarlos automáticamente. Mantener una versión anterior reproducible.

### Configuración inspeccionada en rutas actuales

| Función | Gate servidor | Gate público/condición cliente |
| --- | --- | --- |
| Inspector y preview seguro/resources/renew | `COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED` | `NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED` para inspector |
| Mutación | `COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED` + inspector | `NEXT_PUBLIC_COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED` |
| Receipts editoriales | `COMPOSITION_HTML_EDITING_OPERATION_RECEIPTS_ENABLED` + inspector; POST además mutations | `NEXT_PUBLIC_COMPOSITION_HTML_EDITING_OPERATION_RECEIPTS_ENABLED` |
| Inicialización | `COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED` | `NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED` |
| Receipts de inicialización | `COMPOSITION_HTML_EDITING_INITIALIZATION_RECEIPTS_ENABLED` + inspector; POST además initialization | El flujo durable usa el gate de inicialización; comprobar configuración servidor antes de ofrecerlo |
| Adopción legado | `COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED` + mutations + inspector + receipts de adopción | Transporte/journal/coordinador preparados; revisión/confirmación/host visibles pendientes |
| Receipts adopción legado | `COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED` + inspector; GET independiente de new-write y catálogo | Coordinador preparado; recovery center sin conectar; NOT_FOUND nunca concede retry |
| Publicación snapshot | `COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED` + recovery | `NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED` |
| Recovery snapshot | `COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED` | `NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED` |

Todos exigen literal `true`. Un flag público no concede permiso servidor. No añadir
flags ficticios para resolver ausencia de permisos o activar fallback legacy.

- `COMPOSITION_HTML_EDITING_CATALOG_JSON`: configuración privada tenant-scoped del
  operador, templates/version/source SHA exactos, no JSON del usuario.
- `COMPOSITION_HTML_EDITING_PREVIEW_DELIVERY_KEY`: clave dedicada de 32 bytes,
  representación hexadecimal canónica de 64 caracteres minúsculos. No copiarla en
  expediente, logs, capturas, comandos compartidos ni variables `NEXT_PUBLIC_*`.
- `COMPOSITION_HTML_EDITING_PREVIEW_PARENT_ORIGIN`: origen canónico del host QA,
  no derivado del request. `NEXT_PUBLIC_SUPABASE_URL` identifica origen Storage.
- `COMPOSITION_HTML_SNAPSHOT_EXECUTION_CONTRACT_JSON`: pins operativos independientes,
  no prueba de ejecución por el mero hecho de existir.
- Desde `apps/web`, construir `node tools/html-preview/build-runtime.mjs` y empaquetar
  outputs de `.tmp/html-preview-runtime` **y los inputs fijados**. `.tmp` ignorado no
  se despliega automáticamente. Rebuild después de cambiar cualquier input.

Migraciones relacionadas inspeccionadas: `20261005200000` a `20261005230000` y
`20261006000000` a `20261006090000`, archivos HTML específicos existentes. Son un
inventario, **no orden suficiente de despliegue**: reconciliar dependencias y prefijos
del historial completo antes de aplicar. No renombrar/borrar SQL del compañero.
Adopción legado añade `20261008100000_html_editing_legacy_adoption.sql`, reservada
localmente y sin aplicar. Validar dependencias/historial de ambiente y rollback
transaccional real antes de habilitar staging o rutas; no aprobar pilotos por
compilación ni usar el método operator-owned como endpoint de aprobación libre.

### Datos de prueba mínimos

1. Fuente propia estática con texto, imagen, theme/range, atributo y visibilidad;
   campos independientes compartiendo un nodo y defaults conocidos.
2. Slots anidados con anchors texto/comentarios; gráficas bar/line/area/proportion
   según tipos realmente soportados por contrato.
3. Imagen default revocable, reemplazo permitido, fuente propia licenciada y media
   real con checksum conocido. No usar URLs externas para simular assets internos.
4. Fuente legado sin IDs para candidato offline: preservar bytes/SHA original,
   comparar visualmente candidato y revisar manifest antes de instalación.
5. Snapshot V2 del perfil actual; V1 solo fixture histórico identificado. Nunca
   editar archivos privados productivos para provocar fallos.

## 4. Casos funcionales y recuperación

Todos los casos empiezan PENDIENTE. Registrar PASS/FAIL/BLOCKED por caso, sin
sumar fixtures automáticas como ejecución manual. FAIL/BLOCKED incluyen causa.

| Caso | Acción | Resultado observable requerido |
| --- | --- | --- |
| F01 | Inicializar una plantilla autorizada en DECK compatible | ID/digest antes de un POST; ACK/relecturas exactos; fuente/timing originales intactos; ningún registro implícito desde cliente |
| F02 | Cortar respuesta de inicialización después del dispatch | Seguimiento durable conservado, sin retry/fallback; recovery GET por mismo ID y digest |
| F03 | Resolver receipt inicial con clip cambiado/eliminado | Cierre histórico explícito, sin restaurar/adoptar contenido ni afirmar que receipt es estado actual |
| F04 | OP021 texto Unicode, vacío, multiline y locale/RTL declarado | Valor inerte, límites correctos, locale/direction atómicos; no HTML/XSS; una revisión |
| F05 | OP022 atributo permitido y valor inválido/on*/style/URL | Solo declarado se modifica; inválido rechazado sin aplicar otros campos |
| F06 | OP023 enum/range y OP024 imagen/fit | Opciones/rango/grid/grants efectivos; no clamping/coerción/URL libre |
| F07 | OP025 ocultar/mostrar y reset | No se elimina contenido/recursos; display y accesibilidad conforme a declaración; original exacto al reset |
| F08 | OP026 permutar slots con anchors/subárboles | Orden exacto, sin clonar ni perder texto/comentarios; membresía inválida rechazada |
| F09 | OP027 cada tipo de chart y dataset límite | Renderer existente determinista; exceso/celdas/tipos/labels inválidos rechazados |
| F10 | Multifield sobre mismo nodo | Texto/size/opacity/atributo/visibilidad coexisten; no se pierde un override al guardar otro |
| F11 | OP028 campo individual y «original del elemento» | Individual conserva otros campos; conjunto prepara un lote sin publicar; guardar restaura salida original; otros nodos conservan intención |
| F12 | Reset conjunto con imagen default revocada o lote >50 | Error explícito; draft local anterior intacto, ningún reset parcial/truncamiento |
| F13 | Guardar lote y undo/redo | Un commit/CAS y entrada lógica; source inmutable; versions crecen y salida se reconstruye exactamente |
| F14 | Dos reviewers editan misma base | Conflicto preservado; no last-write-wins oculto/retry/merge automático |
| F15 | ACK editorial perdido, remount y recovery | Mismo ID/receipt, bloqueo coherente; ningún POST de recuperación ni segundo journal |
| F16 | Revocar tenant/rol/grant entre preparación y commit/recovery | Reautorización actual rechaza; receipt local no concede permiso |
| F17 | Publicar snapshot y cortar respuesta | Tracking previo al dispatch, objeto create-only y receipt exacto; recovery no reactiva snapshot superseded |
| F18 | Snapshot V2 alterado/profile drift/compiled SHA diferente | Ambos consumers preview/render rechazan antes de entregar página; no regeneración silenciosa |
| F19 | Snapshot V1 histórico | Rechazo explícito actual; comprobar continuidad por procedimiento I03 antes de aceptación productiva |
| F20 | Aprobar candidato legado y cortar ACK de adopción | Journal previo al POST único; GET histórico sin reactivar ni repetir append; original/revisión/provenance/receipt persistidos atómicamente |
| F21 | Revocar candidato/reviewer/grant o cambiar base durante adopción | Rechazo seguro; ninguna publicación parcial, nunca aprobación desde source/grants cliente |

## 5. Sandbox, recursos y continuidad

| Caso | Acción | Resultado requerido |
| --- | --- | --- |
| S01 | Fuente con script/handler/foreignObject/import/recurso remoto | Rechazo antes de abrir/renderizar; sin «limpieza» que aparente plantilla aprobada |
| S02 | Límites HTML/CSS/nodos/depth/edits/chart | Fallo seguro y bounded; sin stack/source sensible ni publicación parcial |
| S03 | Inspeccionar iframe y respuesta HTTP en browser real | `allow-scripts` únicamente, sin same-origin; CSP final hashes efectivos, sin red arbitraria/storage/top navigation/forms |
| S04 | Mensaje global/puerto ajeno, replay, sesión/hash/generation incorrecta | Ningún command/event aceptado; canal cerrado según contrato, sin fallback |
| S05 | Dos clips con mismas clases y host/overlays | CSS del editable no selecciona vecinos; layers separados; contención/clipping efectivo y ausencia de cambio colateral |
| S06 | Geometría excesiva, grupos/transforms SVG anidados | Rechazo seguro por policy; quotas ejecutor independientes verificadas, no solo valores finitos |
| S07 | Capability alterada/expirada/tenant o draft ajeno | Rechazo, sin bytes privados ni path/Storage URL en error/log |
| S08 | Range cerrado/abierto/suffix, inválido, EOF/cancel/abort | Bytes/digest correctos, 200/206/416 según contrato; spool/budget liberados cuando cleanup confirmado |
| S09 | Dos renovaciones con media reproduciendo/pausada/buffering | Misma posición e intención mediante controller existente; loadedmetadata usa posición actual tras seek; sin segundo reloj ni promesa de READY por ACK |
| S10 | Revocación/owner drift/expiración durante renovación | No apply de URLs nuevas, no retry; frame se cierra/about:blank y error seguro visible |
| S11 | Recurso/font real y comparación baseline | Cada frame usa su propia sesión/hash/generation/nonce; readiness de baseline no acredita primaria |

## 6. Paridad, accesibilidad y regresiones

- Misma revisión/pointers/assets/fonts y perfil de compilación para preview/render;
  capturar frames relevantes con herramientas CAP027 acordadas, no otro gate.
- RTL/Unicode/shaping, fuentes reales, line wrapping, original vs candidato legado,
  layout/scoping/visibility y charts. Registrar viewport/DPR/navegador/renderer/pins.
- Teclado, labels, foco tras error/recovery, lectores de pantalla, cambio de owner,
  desmontaje y cancelación. Inputs no interceptan shortcuts globales del editor.
- Regresión documento no editable, timeline/native undo, transporte y comparación.
  Preset/agent deben declarar soporte o fallo explícito tras I04, nunca eludir sandbox.
- Medir tiempos de preparación, bytes/rangos repetidos, buffering, memoria/spool y
  cuotas. Cada renovación verifica portfolio; cada Range puede reacquirir/hash del
  original. No declarar escala de100000 usuarios por tests simulados o cuota local.

## 7. Evidencia y criterio de salida

Por caso registrar: identificador, build/commit/base con dirty diff conocido,
template/version/profile, actor/tenant QA anonimizados, pasos, esperado/observado,
timestamp, request/correlation/operation ID cuando aplique, browser/runtime/renderer
pins, salida PASS/FAIL/BLOCKED y enlace seguro a evidencia. No exportar tokens,
cap URLs, cookies, service keys, PII, source privado o credenciales en capturas.

Entrega «implementación completa, QA manual pendiente» requiere I01–I05 cerrados
con evidencia y checklist/ambiente definido. Aceptación QA exige ejecutar casos,
resolver bugs críticos/altos, comprobar regresiones y firmar resultado con responsable.
No aplicar rollback borrando receipts/source/historia: deshabilitar nuevas escrituras
por procedimiento autorizado conservando recovery/read, y respetar I03/versiones.

## 8. Validación técnica reproducible (no QA formal)

Desde `apps/web`, con dependencias ya instaladas, sin descargar ni iniciar renderer:

```powershell
node tools/html-preview/build-runtime.mjs
node ../../node_modules/typescript/bin/tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
$cap029Tests = @(rg --files .tmp/cap029-tests/domains/production/composition-editor/__tests__ | Where-Object { $_ -match 'composition-html.*\.test\.js$' })
$htmlContractTests = @(rg --files .tmp/cap029-tests/domains/production/composition-editor/html-editing | Where-Object { $_ -match '\.test\.js$' })
node --test --test-isolation=none @cap029Tests @htmlContractTests
node ../../node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .tmp/cap029-web.tsbuildinfo
```

Esperar compilación exit0 antes de tests: JS emitido incluso tras errores no prueba
el source actual. Salida `.tmp` dedicada no sobrescribe el build común del compañero.
El conteo puede cambiar: conservar resultado real de esa ejecución, no exigir641
como aceptación. Fakes de autoridad/DB/DOM no prueban RLS/CSP/decoding/paridad reales.
