# CAP-029 — expediente de validación integral

Fecha: 2026-10-10. Estado: **implementación necesaria completa/preparada para QA; ambiente y QA manual pendientes**.
No certifica QA aprobado ni aceptación productiva. Último corte técnico
registrado:1074/1074 pruebas CAP029/contratos;24/24 dirigidas guard HTML/bridge;
63/63 dirigidas geometría/runtime/CSP/aislamiento/compilador del corte anterior;
29/29 dirigidas catálogo/bootstrap del corte anterior;
73/73 dirigidas de contextos del corte anterior,
propuesta/preset, recursos/issuer y compilador nativo;62/62 dirigidas de layout del corte anterior;
10/10 de selección inicial/ruta integrada de reconstrucción
del corte anterior;39/39 dirigidas de operador/adopción del corte anterior;
11/11 dirigidas del inventario legado del corte anterior;
34/34 dirigidas de biblioteca/editor/enlace del corte anterior;
56/56 dirigidas de persistencia y
compilador compartido del corte anterior; CLI legado3/3, reconstrucción3/3 e histórico3/3
(repetidos en el corte operativo); inspector offline5/5 del corte anterior; compilación/tipado
aprobados; perfiles vigentes static-fragment-v3-contextual-css/geometry-v11-computed-paint/isolation-v2-contained-box. Lint dirigido sin warnings; el componente
compartido tiene advertencias fuera del bloque modificado, sin errores.

[Primera métrica por entregables](SOFLIA_ENGINE_CAP029_IMPLEMENTATION_METRIC.md):
**100% de implementación necesaria preparada**, QA/instalación de ambiente excluidos. No es aceptación
productiva ni porcentaje derivado del conteo de pruebas.

Operador privado de reconstrucción conectado (workflow/factory/CLI) con journal
previo a revisión y consultas de recovery. Apertura UI y biblioteca vinculada
preparadas; no equivale a ejecución/revisión de browser ni SQL real.
[Uso y límites](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_OPERATOR_HANDOFF.md),
[orden de aplicación manual SQL](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).

CSS contextual estático sin recursos conectado a preview/render y reconstrucción;
la prueba de archivo completo verifica scopes y contrato común, no pixels/paridad
física. Fuentes URL y dependencias CSS siguen bloqueadas. SQL incremental paso23
preparado: comparación estática confirma preservación del cuerpo previo salvo
admisión acotada de deckStyles; no acredita RLS/locks/PostgreSQL real. La regresión
final no registra fallos, skipped ni cancelled. No se ejecutaron migraciones,
render ni QA manual. I01–I05 implementados/preparados según las auditorías enlazadas;
A01/A02 y Q01 siguen pendientes. Ningún caso manual se marca PASS por pruebas locales.

Último cierre I02 autorizado: guard de cuotas existentes en
composition-windows-render-worker-host.ts, antes de preparar/lanzar HTML editable
según documento del plan materializado. No bridge, valores, gates ni stores CAP025
modificados. Native sin pointers HTML conserva V1. Cuotas inválidas se rechazan;
presencia y valores quedan capturados al construir host/bridge. Seis casos nuevos,
24/24 guard/bridge y1074/1074 regresión, cero fallos/skipped/cancelled; compilación
de tests, tipos web/worker y lint dirigido aprobados. Proceso/materialización exterior
simulados: no ejecución de Job limits ni Chromium físico.

Operación: configurar cuotas antes de habilitar jobs. Si faltan, el ciclo owned
existente conserva cuarentena/fence aunque el guard haya impedido spawn. Aplicar
intervención/reconciliación existente antes de reintentar; no inferir cleanup ni
fabricar STOPPED. Últimos5 puntos acreditan el guard conectado, no conteos de tests.
[Auditoría vigente](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md).

## Evidencia histórica de cortes anteriores

Los porcentajes y pendientes siguientes corresponden a sus cortes. El estado
vigente es el encabezado y la puerta I01–I05/A01/A02/Q01, no esos conteos históricos.

Último corte I02: readiness espera fuentes/decode de imágenes y comprueba CSSOM
usado antes de READY/play/seek en preview; ambos targets emiten el mismo runtime.
Dimensiones/font/scroll/fragmentos/grid acotados y medición fresca por assert, sin
cachear observadores. Diez casos nuevos, regresión1030/1030 y dirigidas56/56 del
corte previo, sin fallos/skipped/cancelled; tipado/lint aprobados. DOM/recursos
simulados y VM no acreditan sizing/SVG/cascade/paint completos ni browser físico.
Métrica≈85% conservada. Perfil geometry-v10 requiere paquete vigente antes de
despliegue; históricos se diagnostican, no se reinterpretan. No SQL/flags/despliegue
habilitados ni QA manual. El usuario autorizó aquí los consumers HTML de executor,
propuestas/presets y catálogo UX; no política/stores CAP025 ni resto del worker.

Conexión puntual del executor implementada: reader HTML CDP de la sesión original
independiente del lector de texto; espera ready y exige assert en todos los frames.
Repeticiones geométricas verificadas tras prepare; PNG repetidos verificados antes
y después del lease, descartados si fallan. Preview verifica antes de screenshot
tras cada seek. Native sin HTML conserva recorrido sin comandos adicionales.
Seis casos nuevos con puertos simulados/observer real leído de su fuente;
regresión1036/1036 y dirigidas62/62, cero fallos/skipped/cancelled. Compilación de
tests, tipado web y worker, lint dirigidos aprobados. No SDK/browser/render real.
No cambios al ABI/receta SDK, stores CAP025, SQL/flags/deploy. Perfil V10 y reader
nuevo requieren build/paquete del host antes de habilitación en ambiente.
En ese corte seguían pendientes I02/I04/I05 y métrica≈85%.

Último corte I04: propuesta/preset propios, pendientes/no expirados y sobre base
actual se proyectan desde bindings exactos autorizados al issuer común. UI calcula
identidad canónica de simulación, oculta URL previa durante digest y conecta frame
activo al canal privado; owner/URL/sesión exactos impiden reutilizar un canal viejo.
PAGE/RENEWAL/GET binario comparten selector/pins; cada recurso reautoriza estado /
creador/base/grants/metadata. Rutas genéricas rechazan HTML explícitamente, sin
fallback. No cambios de stores/política CAP025 ni permiso de append/publicación.
Regresión1050/1050, dirigidas73/73 y tipos/lint aprobados. UI inspeccionada/tipada,
recorrido página→renewal→binario con Storage/fetch simulados; no browser/SQL real.
I04 preparado y métrica≈90%±10 por cierre del consumer, no conteos de pruebas.
[Auditoría de contextos](SOFLIA_ENGINE_CAP029_PREVIEW_CONTEXT_AUDIT.md).

Último corte I05: catálogo UX implementado/preparado. Consulta explícita de
coincidencias exactas desde catálogo instalado, lectura bootstrap autorizada,
GET protegido y selector de identificador/versión/número de campos. No HTML,
manifest, grants ni opciones de otro tenant en HTTP. Metadata no concede permiso;
el envío durable anterior vuelve a validar fuente/rol/recursos/revocación.
Resultado/selección anterior no se reutilizan tras cambio de propietario/base,
refresh o cancelación, sin fetch/registro/retry automático. Doce casos nuevos y
regresión1062/1062, dirigidas29/29 catálogo/bootstrap, tipado/lint aprobados.
UI inspeccionada/tipada, recorrido cliente→handler→bootstrap con RPC simulado;
no PostgreSQL ni browser/QA manual reales. I01/I03/I04/I05 preparados; I02 parcial.
[Auditoría del catálogo](SOFLIA_ENGINE_CAP029_TEMPLATE_CATALOG_UX_AUDIT.md).

Corte anterior I02: medición fresca Element/Range, referencia SVG propia normalizada
respecto al parent nativo, CTM/BBox/stroke/miter, dimensiones intrínsecas y wrapper
block/paint containment/clip-margin0 conectados al runtime común. CSP autoriza el
estilo fijo de referencia por hash desde markup inerte, sin unsafe-inline.
Regresión1068/1068 y dirigidas63/63; tipos web/worker/tests y lint aprobados. I02 sigue parcial por
guard obligatorio de cuotas del lanzamiento HTML: el bridge existente las admite
pero permite omitirlas. Autorización puntual solicitada; worker host no modificado.
Métrica≈95% conservada. No browser/SDK/cuotas físicas ni QA manual observados.
[Detalle y límites](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md).

Auditoría de consumidores R20/R22 anterior al guard: ocho familias OP-021..028
conectadas a campos/staging/host coordinado/handlers/gateway/repository/CAS,
undo forward y proyección de referencias HTML en historial nativo. Compilación
viva/congelada comparte fragmentos exactos en ambos targets; no prueba de píxeles.
Compilación fresca de tests y selecciones51/51+74/74 aprobadas. R20 y derivación
compartida R22 preparados; DB/browser/paridad reales quedan A01/A02/Q01.
Sin nuevos comandos ni aumento de≈95%; I02 aún requiere autorización del guard.
[Auditoría de consumidores](SOFLIA_ENGINE_CAP029_EDITORIAL_CONSUMERS_AUDIT.md).

Biblioteca del borrador independiente conectada al selector existente, sin
importación ni anexado: pages<=20, total<=250, metadata/response bounded, validación
de owner/cursor/hash/version, refresh explícito y cancelación. SQL paso24 reutiliza
autoridad actual de apertura y unicidad/index de links. El tester debe validar
selección/reinserción/reemplazo tras guardar, cursor obsoleto, sesión/tenant cambiado,
revocación de recursos, unmount y vacío/error, constatando original intacto. Pruebas
de montaje son inspección estática, no interacción browser observada; no thumbnails
ni signed URLs desde este lector. El corte siguiente añade enlace explícito posterior
a creación por UUID de un medio registrado del tenant: autorización actual, pin del
recurso/base, confirmación, journal previo, un POST y recibo durable. No copia el
original ni cambia el documento. GET recupera/permite cerrar solo un resultado
confirmado, incluso rechazo BASE_CHANGED/RESOURCE_CHANGED/LIMIT; NOT_FOUND o
journal corrupto nunca permiten repetir ni borrar. SQL25–26 preparados, sin aplicar.
La preparación inicial independiente y revisión operativa integral están conectadas;
ver auditoría I03 abajo. No confundir con instalación/revisión humana ejecutadas.

Inventario actual del legado conectado al recovery center con consulta explícita,
metadatos de fuentes/pointers/registros, página20/cota500, cursor ordinal ligado a
hash+versión nativa. Rechazo de cambio de base exige reinicio; consulta fallida
descarta la página anterior, unmount cancela y keys de owner/tenant/draft separan
paneles. SQL27 preparado y flags nuevos cerrados; no ejecución de HTML, migración
automática ni paquetes/grants/URLs en respuesta. Pruebas UI son estructurales.
QA deberá observar: vacío, último cursor, cambio de save entre páginas, tenant/
sesión cambiado, registro revocado/ausente/fuente distinta, revisión de emisión
ausente, error/quota/cancelación y ausencia de writes. SQL real no ejecutado.
Auditoría I01 actualizada: operador workflow/factory/CLI concretos conectados al
preparador/repositorio existentes. Preparación/handoff íntegros, intención durable
previa a registro, reviewer actual y catálogo instalado independiente; recuperación
histórica READ_REGISTRATION sin source/grants/catálogo/compiler ni reenvío. SQL28
preparado, sin aplicar. I01 completo a nivel de implementación, con A01/A02/Q01
separados, no evidencia de revisión/instalación/DB/browser reales.
[Procedimiento privado](SOFLIA_ENGINE_CAP029_LEGACY_OPERATOR_HANDOFF.md).

## 1. Alcance y fuentes

Objetivo: HTML editable con fuente inmutable, manifest/tokens/overrides tipados,
operaciones OP021–028, historial/recuperación, sandbox e integración preview/render.
Fuentes de verdad: roadmap §4 y Fase4, requisitos R19–R22, plan de cierre CAP029.
El tester valida comportamiento observado, no cantidad de tests o porcentaje.

- [Roadmap](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md).
- [Cierre y cortes de implementación](SOFLIA_ENGINE_CAP029_COMPLETION_PLAN.md).
- [Reservas de trabajo](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_PARALLEL_DEVELOPMENT_HANDOFF.md).

Este expediente es propio de CAP029; no modifica trackers globales ni asignaciones.
Catálogo UX autorizado aquí; integración HTML puntual al executor autorizada.
No se implementan políticas/stores CAP025, CAP022 ni resto del worker CAP027.
Conformidad visual utiliza el gate existente CAP027 cuando su dueño lo entregue;
no introducir otro motor de medición ni usar QA de strings como paridad visual.

### Estado consolidado para el tester

- Legado: instrumentación/verificación, preparación pura, repositorio/HTTP y RPC
  transaccional preparados con aprobación independiente, provenance y recibos.
  Migración propia sin aplicar; transporte/journal/coordinador recovery preparados,
  host y recovery center conectados; lectura autorizada de candidato, diff textual
  y confirmación explícita conectados al inspector. Auditoría integral I01 de
  implementación completa, incluido operador privado y registro recuperable.
  Tests/fakes y revisión SQL estática no demuestran retención,
  rollback, RLS o concurrencia en PostgreSQL.
  Coordinación cliente validada con pérdida de ACK→GET sin segundo POST, owner
  drift, grants/native incompatibles, aceptación fallida y cierre histórico
  explícito. Host instala estado verificado antes de cerrar journal, bloquea
  edición/inicialización/publicación ante adopción pendiente o corrupta, y
  conserva seguimiento ante cambio de owner/payload. Recovery center expone
  consulta actual o histórica sin reenviar; falta QA de browser/accesibilidad.
- Geometría: gramática SVG/path/viewBox, límites CSS/presentación/motion-path,
  shorthands y expansión solicitada de grid/columnas. No prueba layout/pintura
  efectivos, tracks implícitos, fragmentación ni contención física de ejecución.
- Histórico: diagnóstico offline y candidato V2 separado para revisión desde
  V1/perfil anterior; restore original rechazado. Inventario metadata autorizado
  conectado; inspección autorizada de ZIP integrada sin ejecutar HTML; auditoría
  histórica completada a nivel de implementación preparada. Handoff, workflow y CLI privado para
  entregar el archivo al operador y recoger aprobación independiente implementados
  (ver runbook privado); no configurados ni aprobados en un ambiente real. Repositorio,
  transporte, journal, coordinador y panel de publicación/recovery históricos
  están conectados; no equivalen a instalación/revisión humana/QA reales. Modo elegido:
  revisión nueva sin activar ni
  cambiar el borrador actual, incluso si difiere del estado histórico.
  Hash igual no acredita paridad visual ni permiso.
  Lector de inventario paginado y RPC service-only preparados, sin aplicar:
  20 registros, watermark/keyset y reautorización por página. No compila historia
  para poder listar metadatos. Mantiene visibles registros sin pin; pin válido
  significa «requiere inspección de bytes», no compatibilidad. Ruta GET propia y
  panel draft-level conectados; páginas por acción, reinicio y errores visibles,
  sin descargar source al browser ni render/restauración/activación. Inspección
  adquiere ZIP privado con hash/tamaño exactos, preflight y lectura acotada del
  bundle; reautoriza antes/después y entrega solo diagnóstico. Cuotas y una lectura
  concurrente por proceso, sin cola. GET de revisión prepara un bundle separado
  usando documento/pointers históricos exactos y permisos vigentes revalidados;
  UI muestra perfiles y comparaciones de pins, no prueba visual. El preparador privado
  ensambla el archivo completo desde el documento histórico exacto, medios y fuentes
  autorizados; el staging exige aprobación del SHA del ZIP completo. Handoff privado
  persistido, workflow y entrypoint preparados; configuración del ambiente pendiente. No
  sustituir la revisión independiente por aprobación en
  browser ni reconstruir el ZIP después de aprobarlo. Publicación/recovery no activos
  y cierre explícito del journal local están implementados; QA real pendiente.
- Preview publicado: PAGE/RENEWAL verifica revisión tenant-scoped, bundle, medios
  y fuentes antes de descarga/firma. Host/runtime conservan revisión y playback
  durante renovación sobre MessagePorts reales; DOM/medios/HTTP son fixtures.
  UI compartida conecta revisionId de la publicación activa solo con hash exacto;
  comparación fija identidad al abrir y renovación la conserva desde la URL.
  Legacy editable sigue422 sin fallback. Selección de identidad probada con dos
  casos nuevos y regresión de transporte existente; no acredita recorrido
  browser/render real.
- Catálogo UX: implementado/preparado local bajo autorización. Coincidencias
  exactas de fuente guardada desde catálogo servidor, GET autenticado y selector
  de versión/campos conectados al envío durable; sin registro/activación automática.

Detalles y resultados de cada corte se conservan en el plan de cierre. Los
conteos históricos no son el estado vigente ni una prueba acumulada de aceptación.

## 2. Puerta de entrada: implementación vs ambiente vs QA

| ID | Pendiente | Clasificación | Evidencia necesaria para retirarlo |
| --- | --- | --- | --- |
| I01 | Inventario/migración piloto de legado y provenance source/template/renderer/sanitizer | **Implementación completa/preparada; ambiente y QA pendientes**. Inventario, operador autenticado/HMAC/intención previa/recovery histórico, review/adopción/native pointer/recibo y auditoría conectados | [Auditoría de trazabilidad](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md); evidencia local39/39 + CLI3/3. PostgreSQL/ACL/piloto real en A01/A02; paridad visual/browser en Q01/CAP027, no acreditados por este cierre |
| I02 | Geometría CSS/SVG usada y cuotas independientes | **Implementación completa/preparada; ambiente y QA pendientes**. Admisión, Element/Range/SVG normalizada, recursos/containment, consumers preview/executor y guard HTML autorizado de cuotas existentes conectados | [Auditoría geométrica](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md).24/24 guard/bridge y1074/1074 regresión; no sustituir cuotas por medición/timer ni crear otro renderer/gate. Instalación física/browser en A02/Q01; rechazo owned mantiene cuarentena/fence |
| I03 | Continuidad histórica de snapshots V1 y perfiles de compilación anteriores | **Implementación completa/preparada; ambiente y QA pendientes**. Histórico revisado inactivo y reconstrucción explícita: selección inicial exacta de recursos vigentes del tenant, paquete/handoff/revisión/journals, candidato/create-only/receipt/recovery/opening/editor y biblioteca/enlace conectados. CSS estático sin recursos; no soporte arbitrario/fontUrls | [Auditoría histórica](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md) y [ruta de reconstrucción](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_IMPLEMENTATION.md). Ruta integrada concreta con RPC/Storage simulados y10/10 nuevos casos; SQL29 preparado. DB/ACL/revisión humana/browser reales en A01/A02/Q01 |
| I04 | Inspector/inicialización/publicación desde todos los contextos soportados | **Implementación completa/preparada; ambiente y QA pendientes**. Candidatos actuales propios y fuente/ref exactas, issuer/CSP/canal/recursos/renewal comunes; propuestas/presets no conceden append/publicación | [Auditoría I04](SOFLIA_ENGINE_CAP029_PREVIEW_CONTEXT_AUDIT.md), regresión1050/1050 y dirigidas73/73. UI tipada/inspeccionada, no browser observado; SQL/ACL/ambiente en A01/A02/Q01 |
| I05 | Catálogo UX HTML autorizado local | **Implementación completa/preparada; ambiente y QA pendientes** | [Auditoría I05](SOFLIA_ENGINE_CAP029_TEMPLATE_CATALOG_UX_AUDIT.md). GET→bootstrap/catálogo→selector→envío durable conectados, regresión1062/1062 y dirigidas29/29; UI inspeccionada/tipada, no browser observado. Metadata no concede grants/registro/activación |
| A01 | Migraciones y autorización transaccional en ambiente | Preparación/validación del ambiente | Historial de DB reconciliado; funciones/RLS/locks/grants instalados bajo autorización, pruebas tenant/concurrencia reales |
| A02 | Templates, flags, cuotas y paquete runtime operativo | Preparación de ambiente | Instalación/versiones aprobadas, build repetible e input pins presentes; WINDOWS_JOB_RESOURCE_LIMITS_V1 válido configurado antes de jobs HTML, aplicación/readback de Job limits existentes comprobados en ambiente |
| Q01 | Comportamiento browser, accesibilidad y paridad render | QA pendiente | Casos de este expediente con navegador, recursos y renderer reales; logs/evidencia reproducibles |

No mover I01–I05 a «solo QA» sin probar su entregable. Ausencia del tester no impide
cerrar implementación; tampoco autoriza decisiones de ambiente o trabajo reservado.
No cerrar CAP029 con I01–I05 abiertos. A01/A02 deben estar resueltos para ejecutar
QA auténtico, aunque no se desplieguen durante el trabajo de implementación.
En el corte vigente, las cinco auditorías acreditan I01–I05 preparados. A01/A02/Q01
no se retiran ni se califican como aprobados por ese cierre de implementación.

### Acuerdos de integración y validaciones de ambiente

I03: SQL29 después de28, sin aplicar; selector inicial no hereda links/grants del
origen ni registra recursos. Validar en staging: conjunto exacto y pins/clases/MIME,
tenant/origen ajeno denegados, revocación durante prepare/stage/create, fonts READY,
branding intro/outro, rollback y lost ACK. Revisar bytes NUEVOS de forma independiente;
contenido antiguo incompatible permanece preservado/no ejecutado. CLI cerrado hasta
instalación/ACL/configuración autorizadas. Casos de QA reales no se marcan PASS por fixtures.

1. Reserva de bloques HTML en NativeCompositionPreview/CompositionComparisonPane
   autorizada por el usuario el 2026-10-08 para pasar revisionId exacto a
   URL/host/renewal. El wiring se limita a NativeCompositionPreview; no es necesario
   editar el pane, que ya recibe URL y callback de conexión.
2. [Reserva transaccional de adopción](SOFLIA_ENGINE_CAP029_LEGACY_ADOPTION_INTEGRATION.md):
   repositorio/handlers/rutas HTML propios y numeración de migración para preparar,
   sin aplicarla, autorizados por el usuario el 2026-10-08. Backend/HTTP/migración
   preparados y cliente conectado según auditoría I01; aprobación real pendiente.
   Cambios de append/gateway compartido necesitan acuerdo aparte.
3. Consumers HTML de layout y guard de cuotas existentes autorizados expresamente
   por el usuario y conectados. Evidencia física de ejecución/layout pendiente en
   A02/Q01; no segundo motor ni cesión del resto de CAP027 por inactividad del chat.

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
| Catálogo de plantillas para inicialización | inspector + initialization existentes; `COMPOSITION_HTML_EDITING_CATALOG_JSON` privado instalado | Panel de inicialización existente, consulta explícita; no nuevos flags ni instalación/registro automático |
| Receipts de inicialización | `COMPOSITION_HTML_EDITING_INITIALIZATION_RECEIPTS_ENABLED` + inspector; POST además initialization | El flujo durable usa el gate de inicialización; comprobar configuración servidor antes de ofrecerlo |
| Adopción legado | `COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED` + mutations + inspector + receipts de adopción | Host/diff/confirmación conectados; flags públicos homólogos necesarios para ofrecer SEND, sin activarlos |
| Receipts adopción legado | `COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED` + inspector; GET receipt independiente de new-write y catálogo | Recovery center conectado; NOT_FOUND nunca concede retry. Consulta de candidato usa gates GET, pero sí revalida catálogo y grants |
| Publicación snapshot | `COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED` + recovery | `NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED` |
| Recovery snapshot | `COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED` | `NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED` |
| Inventario histórico metadata | inspector + recovery snapshot existentes | Flags públicos homólogos; consulta no los activa ni concede compatibilidad |
| Inspección histórica de archive | inspector + recovery snapshot existentes | Acción explícita desde inventario; no render/restore/publicación. Mismos gates públicos |
| Preparación de revisión histórica | inspector + recovery snapshot existentes | Acción explícita tras V1/perfil antiguo; no approval ni publicación. Mismos gates públicos |

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
Inventario/inspección añaden `20261009110000_read_html_editing_snapshot_history.sql`
y `20261009120000_read_html_editing_snapshot_archive.sql`, preparados sin aplicar.
Reutilizan private.assert_html_editing_actor y tablas existentes. Validar instalación,
RLS/grants/revocación/concurrencia reales y límites/timeout de hosting antes de habilitar.

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
| F01 | Consultar catálogo para DECK guardado y seleccionar/inicializar una plantilla instalada | Solo coincidencias exactas, vacío/error explícitos; versiones y campos visibles sin fuente/grants, sin selección/envío automático. Cambio de owner/base/clip cancela y oculta opciones. ID/digest antes de un POST; ACK/relecturas exactos; fuente/timing originales intactos; ningún registro implícito desde cliente |
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
| F19a | Inventario→inspección de archivo V1/perfil antiguo/vigente | GET sin ejecutar/restaurar, identidad/hashes exactos y diagnóstico no autorizante; pin distinto de página obliga reiniciar; cancelar/unmount no instala resultado |
| F19b | ZIP ambiguo/duplicado/traversal/symlink, sizes manipulados o revocación durante descarga | Fallo seguro, sin source/path/URL privada en HTTP/logs ni writes; reautorización final obligatoria; formatos fuera del perfil explícitamente no admitidos |
| F19c | Lecturas simultáneas y archivo máximo en hosting real | Sin cola de buffers por proceso; cuotas tenant/actor independientes; medir memoria/CPU/duración y cancelación. Dimensionar hosting antes de habilitar; pruebas de fixtures no acreditan rendimiento real |
| F19d | Inspección→preparar candidato V1/perfil anterior; revocar grants/cambiar pins durante preparación | Documento/pointers por hash guardado exacto, perfil candidato actual separado y reautorización final. Source privado no sale a HTTP. Pin igual no registra revisión visual/approval; no draft/active/history mutation |
| F19e | Republicar estado distinto del borrador actual, tras aprobación autorizada del archivo completo | Nueva revisión histórica, sin cambiar active_revision_id ni documento/undo del borrador. Recibo/recovery propios; implementación preparada, instalación y ejecución real de este caso pendientes |
| F20 | Operador registra candidato revisado; consultar UUID/diff, confirmar y cortar ACK de adopción | GET de revisión no escribe; source inerte como texto, evidencia/fields/base exactos; confirmación reiniciada al releer/cambiar candidato. Journal previo al POST único; recovery GET sin repetir append; cierre histórico no restaura; original/revisión/provenance/receipt persistidos atómicamente |
| F21 | Revocar candidato/reviewer/grant o cambiar base durante adopción | Rechazo seguro; ninguna publicación parcial, nunca aprobación desde source/grants cliente |

## 5. Sandbox, recursos y continuidad

| Caso | Acción | Resultado requerido |
| --- | --- | --- |
| S01 | Fuente con script/handler/foreignObject/import/recurso remoto | Rechazo antes de abrir/renderizar; sin «limpieza» que aparente plantilla aprobada |
| S02 | Límites HTML/CSS/nodos/depth/edits/chart | Fallo seguro y bounded; sin stack/source sensible ni publicación parcial |
| S03 | Inspeccionar iframe y respuesta HTTP en browser real | `allow-scripts` únicamente, sin same-origin; CSP final hashes efectivos, sin red arbitraria/storage/top navigation/forms |
| S04 | Mensaje global/puerto ajeno, replay, sesión/hash/generation incorrecta | Ningún command/event aceptado; canal cerrado según contrato, sin fallback |
| S05 | Dos clips con mismas clases y host/overlays | CSS del editable no selecciona vecinos; layers separados; contención/clipping efectivo y ausencia de cambio colateral |
| S06 | Geometría excesiva, Element/Range/SVG/paint, cuotas ausentes/ inválidas y agotamiento CPU/memoria | Rechazo seguro por policy y guard antes de spawn; quotas kernel independientes verificadas, no solo valores finitos. Rechazo owned sin handle conserva cuarentena/fence: validar intervención/reconciliación, sin fallback ni STOPPED ficticio |
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
  Preset/agent HTML usan canal privado y hash del candidato, edición/staging bloqueados.
  Digest/load/renewal durante dismiss/nuevo candidato/owner cambiado no reutilizan
  canal viejo ni cierran el nuevo. Base/status/expiry/creator/grants revocados bloquean
  recursos actuales. URL/capability no concede apply/publicación; sin fallback genérico.
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

### Registro histórico no activo — corte 2026-10-09

Backend preparado según decisión del usuario; no aplicado ni integrado aún al
cliente durable. Candidato aprobado debe fijar ZIP completo y procedencia original.
Verificar en entorno autorizado que commit crea revisión+links+recibo atómicos y
no cambia active_revision_id, borrador ni documentos. Repetición con misma operación
recupera recibo, identidad distinta falla; candidato/grants/reviewer revocados
impiden nuevas escrituras. Recovery describe el commit, no autoridad actual.

Pruebas locales: 12 casos nuevos incluidos en **802/802**, más inspector **5/5**;
compilación/tipado/lint aprobados. No equivalen a RLS/concurrencia/rollback/Storage
ni QA visual. Pendientes: recuperación de staging incierto, revisión operator-owned
del ZIP completo y cliente durable. No repetir uploads/POST ni borrar archivos
huérfanos automáticamente si una respuesta fue incierta.

### Locator previo y recuperación de staging — corte posterior 2026-10-09

Adaptador privado y migración preparada `20261009140000_read_html_historical_staging.sql`:
claim durable antes de upload, ACK exacto con `created`, reutilización bloqueada,
trigger de claim previo al candidato. Recovery de metadata distingue ausencia,
locator registrado con staging incierto y candidato registrado/revocado. No prueba
aprobación actual, existencia del ZIP ni autoridad de ejecución. No reupload/retry,
regeneración o borrado automático ante cualquiera de esos resultados.

Validación local: **20/20** casos históricos, **810/810** regresión y **5/5** inspector;
compilación/tipado/lint aprobados. Añadir a QA autorizado: caída antes/después del
claim/upload/INSERT, ACK perdido, dos claims concurrentes, identidades sustituidas,
revocación y separación entre recibo metadata y autorización de nuevo commit.
Migración sin aplicar; evidencia SQL actual solo estática. Handoff operator-owned,
cliente durable/HTTP, reconciliación autorizada de huérfanos e I01–I05 pendientes.

## 8. Validación técnica reproducible (no QA formal)

### Panel histórico y cierre local — 2026-10-09

Panel conectado al recovery center del draft en NativeCompositionPreview. ID/SHA
operator-owned → consulta aprobada → confirmación explícita → coordinator durable.
Tras recargar, journal pendiente ofrece GET del recibo; no otro SEND. Escrituras
deshabilitadas no ocultan pendiente. Web Locks ausente/storage inválido bloquean
coordinación y muestran limitación. Contexto keyed, store fence, cancelación y
storage events del journal impiden adoptar respuesta de otro contexto.

Cierre separado con confirmación, GET autorizado nuevo y comprobación de identidad
justo antes de borrar únicamente seguimiento local. No borrado de revisión/recibo
backend ni cambios en draft/active/undo. UNIQUE(org,candidate) y rechazo de candidato
ya registrado preparados en migración13, **sin aplicar**. Recovery existente no
depende de esa vista de candidato ni de su aprobación vigente.

Pendientes inmediatos anteriores panel/cierre resueltos en código; persisten flujo
operator-owned, auditoría del preparador completo y cierre integral I01–I05.
Evidencia: cinco casos nuevos, **842/842**, inspector **5/5**, compilación/tipado/lint
de siete archivos aprobados. Test de UI es estructural y no prueba interacción.
Tester debe observar foco/labels/confirmaciones, scroll del recovery center, refresh,
tabs/storage events, cambio de sesión y borrador/active/undo intactos. Sin browser,
accesibilidad, PostgreSQL/RLS/locks/Storage reales ni QA manual ejecutados.

### Candidato autorizado y coordinación durable — corte posterior 2026-10-09

GET `drafts/[draftId]/html-historical-candidates/[candidateId]` expone solo vista
cerrada de aprobación/procedencia/hashes y revalida autoridad antes de responder.
No confundir con GET del recibo: este último describe un commit histórico y no
recompila ni valida autoridad actual de ejecución. Commit vuelve a reautorizar.

Journal y coordinador browser preparados: confirmación histórica explícita,
reconsulta del candidato, lock existente, journal previo/readback/digest, un POST,
ACK ligado al ZIP/original y RECOVER siempre GET incluso con ACK cacheado. No
adoptan documentos/revisiones/undo en el editor. Al fallar preservan seguimiento;
NOT_FOUND y storage corrupto no dan permiso para sobrescribir/reintentar/borrar.

Pendientes de implementación: panel/wiring al host y cierre histórico explícito
del journal mediante nuevo GET autorizado; operación/handoff del aprobador y
auditoría integral I01–I05. No habilitado aún para aceptación final.

Casos reales pendientes para tester: dos tabs y storage events, cambio de sesión/
empresa durante GET/POST, navegador sin Web Locks, cuota/storage denegados,
refresh tras pérdida de ACK, candidato/reviewer/grants revocados durante lectura,
recibo correspondiente a otro ZIP y ausencia de cambio en active/draft/undo.

Evidencia local de este corte: 16 casos añadidos; **837/837** regresión, cero skipped;
inspector **5/5**. Compilación/tipado web y lint de16 archivos propios aprobados.
No pruebas de browser/RLS/Storage reales ni aplicación de migraciones/flags.

### Transporte histórico preparado — 2026-10-09

Ruta nueva GET/POST `drafts/[draftId]/html-historical-publications/[operationId]`.
POST recibe solo compositionId/candidateId/candidateSha256; GET añade requestSha256.
Actor/empresa desde sesión, reviewer obligatorio, cuotas separadas, origen y payload
cerrados, respuesta no-store. Gates existentes: inspector+snapshot recovery para
leer; publication+mutations adicionales para escribir. Ninguno fue activado.

Cliente transporta una solicitud y comprueba digest/correlación/recibo inactivo;
no instala estado en editor. No conectar SEND hasta implementar journal durable
antes de POST, consulta de candidato aprobado, confirmación y recuperación UI.
Operador sigue siendo dueño de la aprobación/ZIP; HTTP no acepta esos payloads.

Once pruebas nuevas validan handler+cliente con sesión/repositorio simulados.
Regresión **821/821**, cero skipped; compilación/tipado web/lint de cinco módulos
nuevos aprobados, sin warnings. Sin rebuild/deploy de runtime ni writes externos.
QA real debe cubrir sesión expirada/cambio de empresa, CSRF/origen, cuotas reales,
ACK perdido tras commit y recuperación GET con escrituras deshabilitadas, comprobando
ausencia de cambio en borrador/active. No inferir aprobación de QA o SQL real.

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
