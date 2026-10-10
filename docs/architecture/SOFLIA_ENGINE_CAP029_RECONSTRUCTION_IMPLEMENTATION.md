# CAP-029 — reconstrucción explícita como contenido nuevo

Decisión del usuario: reconstruir contenido histórico no admitido actualmente,
con revisión independiente, sin alterar archivo original ni borrador actual.
No denominar esta operación reproducción fiel o republicación histórica exacta.

Estado vigente2026-10-10: **I03 implementado/preparado; ambiente y QA pendientes**.
Recorrido privado, apertura independiente, CSS contextual estático y recursos
iniciales explícitos integrados. Cortes históricos abajo conservan su evidencia;
no son estado vigente. CAP029 sigue parcial por I02/I04/I05.

## Restricciones verificadas

- `20260812170000_create_video_composition_drafts.sql`: UNIQUE(composition_id), un
  solo borrador por composición. getOrCreate recupera ese borrador, no crea una rama.
- `20260904120000_enforce_single_active_video_composition.sql`: índice parcial de
  composición activa por componente. No crear otra composición con el componente
  original ni archivar/sustituir la existente para sortearlo.
- `initializeHyperframesDraft` requiere material_component_id y obtiene fuentes
  del componente. No usarlo para una derivación aislada que no debe importar o
  reconciliar automáticamente fuentes del proyecto actual.
- Aprobación histórica existente liga ZIP exacto. No aprobar una reconstrucción
  con ese recibo ni instalar pointers/grants extraídos del archivo antiguo.

## Implementación disponible

`composition-html-editing-historical-reconstruction.server.ts`:

- `readHtmlHistoricalReconstructionOrigin`: adquiere/inspecciona archivo fijado bajo
  autorización vigente y reautoriza antes de retornar procedencia metadata-only.
  No compila native histórico, exporta fuente, hereda grants ni ejecuta HTML.
  Admite únicamente formatos históricos reconocidos con identidad/bytes válidos;
  archivos desconocidos/corruptos no se convierten en candidatos por este camino.
- `prepareHtmlHistoricalReconstruction`: preparación pura y privada de contenido
  independiente, IDs nuevos y base/hash exactos sin pointers anteriores. Resuelve
  plantilla del catálogo confiable por organización/sourceSHA; usa inicialización
  y binding existentes para revision1. Fuente nueva debe superar admisión actual
  con grants/imageSources suministrados por el host, no por archive/browser.
- El preparador admite **múltiples diapositivas autocontenidas** con selección
  explícita de plantilla/version por clip. Exige cobertura exacta sin selecciones
  faltantes, extra o duplicadas; cada fuente supera admisión actual. Ordenar las
  selecciones de otra forma no cambia el hash del documento resultante.
- Revalida todos los pointers bajo el hash nativo final y los límites del compilador
  compartido; rechaza colisiones de IDs entre fragmentos y recursos no locales.
  No prefija IDs ni reescribe referencias para ocultar conflictos. La comprobación
  aquí corresponde a fragmentos; ensamblaje final con wrappers/overlays conserva
  sus gates existentes y deberá verificarse al producir el paquete nuevo.
- Medios y capas de texto/captions nativos admitidos con conjunto exacto de metadata
  adquirido por el host. MIME debe corresponder al kind; un UUID no puede representar
  simultáneamente recursos de tablas distintas. Font IDs/familias deben coincidir
  con el manifiesto actual, sin fuentes extra o faltantes. No basta un flag de bypass.
- deckStyles contextual estático sin dependencias CSS/fontUrls admitido bajo el
  perfil vigente, con scoping y presupuesto conjunto compartidos. No soporte de
  CSS global arbitrario; geometría/cascada efectiva sigue en I02. Selección inicial
  explícita de medios fuera del draft origen integrada y reautorizada actualmente.
- Retorna candidato y tres revisiones nuevas requeridas, nunca aprobado/guardado/
  activo. No escribe en DB/Storage ni verifica que los UUID nuevos no existan allí.

`composition-html-editing-reconstruction-archive.server.ts` y
`composition-html-editing-reconstruction-resources.server.ts`:

- Preparación privada del paquete completo de las diapositivas nuevas, sin crear
  un draft provisional para poder compilar. El ensamblador compartido ahora separa
  adquisición de contenido autorizado del ensamblaje; la ruta de snapshots guardados
  mantiene sus lecturas exactas. No crea un compilador ni un gate CAP027 alternativo.
- Adaptador concreto adquiere solamente imágenes realmente referenciadas en los
  fragmentos nuevos. Un alias escrito como texto no es un recurso. Reutiliza consultas
  acotadas de enlaces **actuales** del draft origen cuando no hay selección explícita;
  con ella usa RPC service-only de recursos vigentes del tenant y referencias exactas.
  No lee permisos del ZIP. Alias remoto/activo se rechaza antes de las consultas.
- Host aporta catálogo instalado y puertos de autoridad; nunca se aceptan estos
  puertos, paths, grants o bytes desde HTTP. El paquete incluye preview, render, bundle,
  manifiestos, contrato y hashes existentes. Recursos de imagen se fijan por identidad
  para materialización posterior: no se descargan ni decodifican imágenes aquí.
- Relee procedencia autorizada, catálogo y recursos después de compilar. Revocación,
  cambio de identidad o conjunto incompleto impiden devolver el resultado. Captura
  contenido/runtime/recursos antes de awaits, timeout cooperativo y admisión acotada.
- `createHtmlReconstructionCompositionResourceAcquirer` reutiliza el lector actual
  de medios enlazados al draft origen o el nuevo lector de selección explícita,
  y el adquirente de fuentes READY del tenant.
  Descarga fonts con MIME/tamaño/checksum verificados; refresh reautoriza metadata
  conservando bytes propios, sin segunda descarga ni caché global. Ensamblaje admite
  el conjunto mixto, conserva contratos nativos/font-usage y revalida identidades.
- Devuelve candidato + ZIP como **contenido reconstruido no aprobado/creado/publicado**.
  Procedencia del candidato está fuera del ZIP y se liga junto a esos bytes en el
  handoff/revisión propios descritos abajo. No instala una ruta/CLI ni almacena este
  resultado automáticamente. Su caller operativo está conectado mediante el factory
  privado; el host conserva explícitamente el handoff durante PREPARE.

`composition-html-editing-reconstruction-handoff.server.ts`:

- Conserva candidato/ZIP/procedencia bajo sello HMAC específico de reconstrucción,
  distinto del histórico; comparte únicamente el mecanismo seguro de archivos.
  Crea recibo al final, sin overwrite/adopción de parciales, y carga bytes idénticos
  tras reinicio sin recompilar ni ejecutar.
- Contrato propio liga candidateId, ZIP completo, metadata exacta de origen/destino,
  evidencia y tres revisiones al reviewer autenticado externamente por el host.
  Rechaza aprobación histórica. No crea una aprobación persistida, no reautoriza
  acceso actual ni autoriza la transacción de creación.
- [Límites operativos y evidencia](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_HANDOFF.md).

## Estado de los entregables obligatorios

1. Preparación multipágina con estilos estáticos y selección explícita de recursos
   nuevos fuera del draft origen implementada/preparada. Medios/fonts tienen adquisición y
   admisión propias. Ensamblaje completo y verificador estructural compartido probados
   para diapositivas, video y capas de texto/captions con fuente autorizada;
   no equivalen a materialización/decodificación/render ni comparación visual.
   No transportar estilos/recursos legados sin volver a admitirlos.
2. Handoff privado y enlace independiente de revisión implementados. Registro privado
   de revisión preparado con RPC/adapter y retirada explícita, descrito en el runbook.
   Persistencia de candidato, journal y creación aislada preparados en el corte de
   2026-10-10. Consumo operativo con autoridad actual integrado.
   El registro de revisión no demuestra persistencia/creación del contenido nuevo.
   No reutilizar el sello o schemas de publicación histórica como si describieran
   esta semántica diferente.
3. Persistencia transaccional create-only e idempotente, con journal/receipt preparada:
   reautorizar original, catálogo, reviewer, tenant, recursos y revisión exacta;
   crear composición aislada **sin sustituir el componente original**, nuevo draft,
   documento inicial, revisiones/bindings HTML nuevos, links de recursos y procedencia
   en una sola transacción. RPC propio crea el documento nativo final en versión1,
   registra subdocumentos HTML iniciales y verifica lectura exacta del NUEVO draft
   antes del receipt. No usa append en el draft original ni getOrCreate.
   Implementación/contratos preparados; SQL real/RLS/concurrencia aún no ejecutados.
   Resolver asignación posterior a material/componente como acción explícita, no
   cambiar automáticamente la selección/publicación original.
4. Transporte/CLI privado y recuperación de resultado incierto implementados en
   el corte operativo 2026-10-10, sin segundo create, recompilar fuente después de
   aprobación ni compensar borrando contenido. Instalación/configuración diferida.
5. Integración de revisión/consulta del contenido nuevo y apertura en editor con
   identidad propia, sin reconciliación automática desde fuentes del componente
   original. Confirmación separada antes de crear; creación no implica publicación.
6. Tests completos de persistencia/recuperación/consumers y expediente para QA;
   instalación SQL/config/ACL y evidencia real bajo autorización del ambiente.

El preparador puro no sustituye ninguno de estos pasos. No aplicar migraciones,
activar flags, registrar templates ni realizar writes externos durante desarrollo.
CAP027/025, catálogo UX externo y persistencia compartida mantienen reservas.

## Corte de persistencia preparada — 2026-10-10

- `composition-html-editing-reconstruction-candidate.server.ts`: descriptor estricto
  y digest canónico transportable por JSONB, con límite propio16MiB (no el mayor del
  handoff). Reutiliza el constructor común de registro/conformidad del snapshot.
  No compila fuente aprobada ni reconstruye ZIP. El preparador/sello acreditan esos
  bytes; el descriptor no sustituye esa procedencia ni otorga permisos.
- `composition-html-editing-reconstruction-authority.server.ts`: catálogo instalado
  vigente, origen exacto, imágenes/medios actualmente enlazados y fonts READY del
  tenant. No descarga de nuevo fonts/medios ni compila native histórico. Catálogo
  es configuración confiable del host, no un registro SQL linealizable inventado.
- `composition-html-editing-reconstruction-repository.server.ts`: journal privado
  obligatorio antes del claim remoto; claim nuevo antes de upload create-only con
  readback; candidato inmutable y reautorización después del upload. Una admisión de
  staging por proceso, sin cola. Creación exige candidato durable y otro intento
  privado preservado antes del único RPC. Replay/recuperación leen receipt primero,
  sin compiler/Storage ni segunda creación. No instala ruta/CLI automáticamente.
- `composition-html-editing-reconstruction-journal.server.ts`: root privado distinto
  del handoff y clave externa, operación UUID, archivos fijos create-only, HMAC de
  dominio/fase propios, fsync/readback. Mantiene parciales; no adopción/resume/borrado.
  Windows requiere ACL real; el journal no constituye éxito remoto ni aprobación.
- SQL propios `20261010100000_html_reconstruction_candidates.sql` y
  `20261010110000_create_html_reconstruction.sql`, prefijos libres comprobados, sin
  aplicar. Revisión/recursos/origen revalidados bajo locks, espera2s y serialización
  por operación. Contenido nuevo por INSERT sin UPSERT, componenteNULL y activeNULL.
  Procedencia en source_manifest y auditoría privada ligada a revisión/receipt;
  manifest de la revisión inicial se conserva exacto para no romper reuse en una
  publicación explícita posterior. No se actualiza/borrar/archiva el original.

La creación preparada admite recursos del draft origen; no resuelve todavía la
selección fuera de él, CSS global ni apertura UI aislada. El comando operativo
privado ya está conectado; ver runbook propio. No
declarar esos faltantes como QA. La configuración de journaling no se instaló en
un ambiente y no hubo writes de DB/Storage; ver corte del plan para pruebas ejecutadas.

## Validación disponible y límites

Casos dirigidos cubren procedencia sin compilar native histórico, candidato con
plantilla actual y scope separado, múltiples páginas, cobertura exacta, versiones/
fuentes instaladas, IDs globales, aliases locales y grants actuales. Original/stale/
pointers/vecinos no declarados/styles se rechazan. Autoridad/DB/Storage son fixtures.
Contrato puro cubre imagen/audio/branding/SFX y colisión de UUID entre tablas; el
paquete mixto completo probado contiene video, texto y captions con fuente sintética.
Pérdida del enlace de video (sin revocar la imagen), font no READY y bytes/MIME de
font inválidos rechazan el paquete. No extrapolar el fixture a decode/render real.
No prueba reconstrucción humana, permisos SQL reales, comparación visual, fonts
decode, persistencia nueva ni UI/browser. Ver el último corte del plan de cierre
para el resultado ejecutado y el total de regresión.

Estado vigente: **I03 implementado/preparado**, reconstrucción conectada al operador;
instalación/revisión humana/QA reales pendientes. No listo para QA final CAP029 por I02/I04/I05.

## Corte operativo — 2026-10-10

Workflow y factory concretos conectan preparador, handoff, revisión, recurso/store,
repositorio, journals y recovery sin rutas públicas. CLI autenticado cerrado:
PREPARE, REVIEW, READ_REVIEW, WITHDRAW_REVIEW, STAGE, READ_STAGING, CREATE y
READ_CREATION. Confirmación separada para crear contenido independiente inactivo.
Journal de revisión create-only/HMAC/fsync/readback antes del primer RPC de
attestation; resultado incierto se consulta por candidateId, nunca se repite.
Roots privados disjuntos; autenticación JWT/rol actual y configuración host-owned.
No abre editor, aplica SQL, activa flags/catálogos ni ejecuta HTML histórico.

Ocho tests dirigidos aprobados; regresión931/931, CLI reconstrucción3/3 e histórico3/3,
TypeScript y lint aprobados. Fixtures de autoridad/remoto, no RLS/Storage reales.
[Runbook](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_OPERATOR_HANDOFF.md) y
[SQL manual](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md). Métrica conservada≈75%.

## Preparación de CSS contextual — 2026-10-10

`composition-html-editing-deck-styles.server.ts` prepara una derivación acotada
del stylesheet bajo las mismas identidades de scope que los fragmentos. Reutiliza
la verificación exacta native/revisions; no cambia sourceHtml, pointers ni hashes.
Extraído el mecanismo de selectors/layers de aislamiento, conservando el resultado
previo de fragmentos. El parser comparte presupuesto CSS entre stylesheet contextual
y estilos locales, sin dos allowances independientes.

Se rechazan fuentes por URL, dependencias CSS sin ledger, HTML vecino sin binding,
document-root selectors, nesting y clocks/inputs interactivos; no se strippea CSS
ni se concede autoridad a un alias disponible. CSS de recursos y font adaptation
siguen siendo requisitos por integrar, no se declaran resueltos por este preparador.
Su validación estática no demuestra geometría/cascada/painting físicos.

El corte de preparación inicial no habilitaba reconstrucción. El siguiente corte
conecta la derivación en el compilador compartido (preview y render), el preparador
y el adquirente de reconstrucción. Perfil nuevo
`courseforge-html-static-fragment-v3-contextual-css`: snapshots de perfiles antiguos
no se reinterpretan silenciosamente. La fuente y CSS original permanecen intactos;
solo el output derivado se aísla por binding. La revisión posterior conserva el ZIP
aprobado, sin recompilarlo durante staging/creación.

La migración adicional `20261010130000_html_reconstruction_contextual_css.sql`
(paso23) actualiza el validador privado sin editar migraciones anteriores ni relajar
los checks de identidad, revisión y recursos. Preparada, no aplicada. Solo estilos
estáticos sin dependencias CSS/fontUrls; no soporte global arbitrario, ni cierre
de geometría/cascada física I02. Recursos nuevos y revisión browser de I03 pendientes.
Legacy sin bindings conserva su compilación anterior. Métrica≈75% conservada.

## Recursos vinculados en apertura independiente — 2026-10-10

Corregida biblioteca vacía de la página independiente: carga autorizada de los
medios ya enlazados a su nuevo draft y entrega al selector existente. RPC de lectura
reutiliza autorización/provenance actual y locks de apertura, une links/registro con
organization_id, filtra recursos disponibles y limita consulta a21/página de20.
No offset, N+1, consulta global de componentes ni índice duplicado. Metadatos
acotados; sin HTML, bucket/path o URL firmada en respuesta.

Cliente/colección verifican owner, orden, cursor, hash/version y presupuesto<=250;
la página SSR y las consultas explícitas reautorizan. Base modificada requiere
actualización, fallo elimina metadata obsoleta del selector sin alterar el documento.
La UI aborta consultas al desmontarse y no reintenta/importa/inicializa enlaces.
SQL incremental20261010140000 (paso24) preparado, no aplicado.

Este corte permite seleccionar/reinsertar/reemplazar medios YA vinculados usando
los handlers existentes, que mantienen sus checks de autoridad. No es catálogo de
plantillas, herramienta de anexado externo ni soporte de URLs/thumbnail. Selección
de recursos nuevos fuera del draft de origen y revisión operativa siguen pendientes.

## Enlace explícito de medios del tenant — 2026-10-10

Después de crear/abrir el nuevo contenido, el usuario puede consultar por UUID un
medio ya registrado de su empresa, revisar identidad y confirmar su enlace solo
al nuevo borrador. No crea uploads ni otro catálogo; reutiliza la biblioteca e
inserción/reemplazo existentes. Selección/enlace no son aprobación ni publicación.
SQL25 centraliza la misma admisión/proyección de24;26 agrega RPC service-only,
tabla privada sin acceso directo y recibos inmutables. Gate cerrado por defecto.

Journal bajo lock existente precede el único POST. SQL reautoriza y serializa contra
save, compara base/recurso, limita enlaces y registra éxito/rechazo en una sola
transacción. Solo inserta un link del nuevo draft; no modifica source/native/version,
original, revisión activa ni Storage. Pérdida de ACK se recupera por GET, nunca
otro POST. Cierre local requiere GET actual, identidad exacta y tracking inalterado;
NOT_FOUND/corrupto mantienen el seguimiento. Recibo histórico no es grant actual.

Labels admiten200 codepoints de SQL; adaptación al selector nativo respeta200
unidades UTF16 sin cortar pares de sustitutos. No altera el label almacenado.
Evidencia:34/34 dirigidas,980/980 regresión, tipado/lint aprobados. SQL estático y
RPC simulados, no ejecución PostgreSQL, interacción browser ni paridad física.
I03 parcial: adquisición inicial sigue source-draft scoped y revisión operativa
requiere integración completa; CSS con recursos/fontUrls continúa rechazado.

## Cierre de preparación inicial y recorrido operativo — 2026-10-10

Contrato opcional `target.resourceSelection`: UUIDs y placements explícitos, sin
paths/grants/actor/runtime. Ausencia conserva la semántica previa, no migra metadata
persistida ni amplía autoridad. Analizador de referencias reales extraído del
adquirente previo, compartido por ambas rutas; comprueba exactitud de selección y
tipo de fuente, rechaza aliases solo textuales y placements contradictorios.

Lector actual de selección: una RPC service-only bajo origen/actor/tenant vigente,
metadata bounded, conjunto/pins/placements/MIME exactos. Obtiene imagen/video/audio/
branding/SFX no enlazados al origen; fuentes mantienen política READY y adquisición
verificada. Preparer y verificador de staging/create usan el mismo contrato;
refresh final detecta cambio/revocación, sin rehacer candidato aprobado. SQL29
preparado actualiza helpers existentes, conserva autoridad/reviews/pins/CSS/font
checks y creación atómica/link solo nuevo contenido. No escribir ni ejecutar original.

Prueba integrada utiliza factory, preparador/compiler, handoff, repositorios,
journals y store concretos, filesystem temporal y RPC/Storage simulados: seis
recursos nuevos y font READY; revisión durable antes de RPC; pérdida de ACK/reinicio
recuperable; stage→un upload con readback→create aislado→receipt/opening, sin repetir
writes ni depender de medios vigentes para consultar el receipt histórico.
Nueve casos de selección/autoridad complementan el recorrido. Regresión1012/1012,
CLI9/9, tipado web/lint dirigidos aprobados. Reproducción fiel de HTML incompatible
sigue bloqueada; contenido nuevo requiere autoría/revisión independientes.

I03 retirado de implementación pendiente, no del ambiente/QA. A01/A02/Q01 incluyen
DB/RLS/locks/concurrencia/rollback, ACL/flags/runtime/catalogue instalados, revisión
humana, interacción browser, decode/render y comparación real. I02/I04/I05 siguen
parciales/externos. [Auditoría](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md),
[operación](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_OPERATOR_HANDOFF.md) y
[SQL manual](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md) describen límites vigentes.
