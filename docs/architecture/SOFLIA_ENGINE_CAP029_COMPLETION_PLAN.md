# CAP-029 — cierre de implementación y entrega a QA manual

## Objetivo y límites

Completar HTML editable (R19–R22) hasta una entrega verificable para QA manual.
No declarar cierre por tests aislados ni por metadata de sandbox. Las migraciones,
activación de flags, registro de plantillas y despliegue requieren su procedimiento
de ambiente; no se ejecutan implícitamente durante desarrollo.

Fuente arquitectónica: `SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md`.
Reparto: `SOFLIA_ENGINE_MULTIMEDIA_EDITOR_PARALLEL_DEVELOPMENT_HANDOFF.md`.
Buenas prácticas: `../prompt_maestro.md`.

## Reserva de esta conversación

- Inicialización durable cliente, journal, recovery y sus pruebas.
- Panel de seguimiento inicial; no catálogo UX de plantillas reservado al compañero.
- Auditoría y cierre incremental del aislamiento HTML y contratos de integración.
- Nota propia de seguimiento para no editar simultáneamente los trackers globales.

No tocar CAP-022 ni los módulos asignados CAP-025. No tocar `composition-editor/qa/**`,
`tools/controlled-hyperframes/**` ni configuración worker de CAP-027. Cualquier
integración que requiera esos módulos debe acordar contrato y archivos primero.

## Matriz de cierre (sin porcentaje artificial)

| Requisito | Evidencia existente / pendiente real | Estado |
| --- | --- | --- |
| R19: fuente, template/version y assets inmutables; instrumentación legada | Bootstrap y persistencia existentes; instrumentador legado offline genera candidato separado y validado, sin instalación/adopción. Falta circuito de revisión e instalación piloto autorizado y auditoría de provenance/versiones | Parcial |
| R20: manifest, overrides/tokens, OP-021..028, gateway/OCC/undo | Las ocho familias, multifield y reset conjunto explícito conectados a contratos/compiler/inspector/staging/UI; falta auditoría final de consumidores y requisitos. Integración real/QA pendiente | Parcial |
| R21: sanitización, CSP, iframe aislado y protocolo | Admisión estática/geometría, scoping y contención del fragmento en compilador común, CSP por hashes, recursos autorizados, canal privado y renovación conectados; falta completar auditoría y evidencia browser. No equiparar selectors/CSS emitido con aislamiento efectivo observado | Parcial |
| R22: inspector y salida idéntica preview/render | Consumidores y snapshots existentes; comprobar integración exacta y separar validación automática de paridad visual manual | Parcial |
| Inicialización durable y recuperación sin ACK | Transporte, digest compartido, journal previo al POST y GET de recibo conectado al host; panel habilita consulta de identidad durable | Implementado; QA manual pendiente |
| Recuperación inicial histórica con documento cambiado | Acción explícita reautoriza recibo incluso con ACK cacheado y verifica native cargado; sin inspector, restauración ni adopción | Implementado; QA manual pendiente |
| Catálogo UX reservado al compañero | No duplicar; auditar interfaz/entrega y coordinar integración cuando esté disponible | Externo/reservado |
| Entrega QA | [Expediente integral](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md) con30 casos, prerequisites/config/rutas inspeccionados, formato de evidencia y puerta I01–I05; aún no habilitado para aceptación final | Preparado; implementación integral pendiente |

## Corte de implementación — 2026-10-07

La inicialización nueva usa `/initialize/operations/{operationId}` sin fallback legacy.
Persiste ID/digest/request antes del único POST. Valida recibo histórico por owner,
draft, clip, operación, request exacto y digest derivado en browser con el mismo
preimage del servidor. `created=true` histórico usa HTTP 200, no exige HTTP 201.

Recuperación explícita consulta GET únicamente si el journal durable no tiene ACK;
NOT_FOUND, denegación, sustitución o fallo conservan seguimiento y bloqueo. Luego
requiere lecturas autorizadas de native e inspector antes del cierre. Los intentos
legacy sin digest no se convierten retrospectivamente en operaciones durables.
No se modifica fuente, documento, undo ni se adopta automáticamente otro payload.

El cierre histórico es una acción separada: reautoriza siempre por GET el recibo
durable y valida hash/version del native ya cargado. Devuelve `null`, no un inspector
que aparenta estado actual. Puede cerrar tras eliminación del clip o reemplazo de
fuente; no adopta ni reconstruye revisión/undo, y el panel explica esa distinción.

Validación inicial: compilación `tsconfig.hyperframes-test.json` en salida aislada
`.tmp/cap029-tests`; 59/59 tests dirigidos de transporte/journal/host aprobados,
incluyendo NOT_FOUND, digest corrupto, autorización denegada, owner/cancelación,
source reemplazado, clip eliminado y payload stale. No es QA manual ni SQL/HTTP real.
Regresión ampliada de tests `composition-html*.test.js` y contratos `html-editing`:
468/468 aprobados. Incluye simulaciones de repositorio/materialización/supervisor;
no se ejecutó un renderer físico. `git diff --check` de los archivos modificados pasa.
Tipado web completo aprobado con `tsc --noEmit --incremental --tsBuildInfoFile
.tmp/cap029-web.tsbuildinfo`, reejecutado después del cambio de contrato histórico
para incluir el panel React. La salida/cache aislada evita sobrescribir builds ajenos.

Prerrequisitos para habilitar el flujo: migración de receipts y gates existentes de
inspector/receipts/initialization debidamente aprobados en el ambiente. No se activó
ningún flag ni se aplicó ninguna migración en este corte.

## Corte R21 — admisión estática y complejidad

El adaptador editable valida antes de los walkers recursivos de recursos/DOM:
HTML 250 KiB, 1.500 nodos incluidos texto/comentarios, profundidad 40, presupuesto
CSS acumulado 250 KiB, 4.096 nodos AST y profundidad 16. Usa recorrido iterativo;
errores PostCSS son códigos seguros, sin contenido suministrado. Preserva source,
no elimina silenciosamente comportamientos de una plantilla incompatible.

Rechaza keyframes, declaraciones animation/transition (también vendor prefixes),
at-rules fuera de media/supports/layer y selectores hover/focus/active/visited/target/
checked/indeterminate. El movimiento pertenece al evaluator nativo, no a relojes
CSS importados. Condiciones de preferencias personales, hover/pointer y capacidades
interactivas se rechazan; condiciones estáticas de viewport siguen permitidas.
Valida el mismo adaptador reutilizado al verificar revisiones para
preview y render; no se editaron módulos QA/renderer de CAP-027.

20/20 pruebas dirigidas de parser/compilador estático aprobadas, incluidas condiciones
personales/interactivas y evasiones por comentarios/escapes CSS. Compilación de pruebas
y regresión CAP-029 actuales 476/476 aprobadas; tipado web completo aprobado en este
corte antes de la última ampliación del parser, cuya compilación dirigida también
está aprobada. Esto no prueba iframe/CSP/browser real,
aislamiento de selectores globales, límites completos de geometría ni transporte
de recursos del preview: R21 permanece parcial. Fuentes anteriormente aceptadas
que excedan estos límites o dependan de CSS autónomo se rechazan explícitamente;
no se reescriben ni se cambian hashes de las fuentes persistidas.

## Auditoría de operaciones pendientes

El catálogo OP-021..028 de arquitectura no puede darse por cubierto con solo los
tres tipos TEXT/IMAGE/THEME del manifest actual. Cerrar explícitamente:

- OP-021: texto y locale/dirección declarados conectados en una misma operación; QA manual pendiente.
- OP-022: implementado para atributos declarados title/aria-label/aria-description/lang/dir, texto acotado o enum; prohibidos on*, style, IDs y atributos URL.
- OP-023: tokens enumerados existentes y rangos numéricos declarados conectados; QA manual pendiente.
- OP-024: imagen organizacional y fit existentes.
- OP-025: visibilidad declarada implementada, con display explícito y restauración exacta; no edición DOM arbitraria.
- OP-026: orden de slots repetibles tipados e índices acotados implementado; QA manual pendiente.
- OP-027: dataset tipado conectado al renderer SVG existente; límite global de 2.000 celdas, con límites específicos menores del renderer; QA manual pendiente.
- OP-028: reset por propiedad y ALL comprobados para el campo declarado V1; sin saltar permisos de imágenes al restaurar defaults.

Las extensiones deben evolucionar manifest/state/reducer/compiler/inspector/history
en conjunto, con compatibilidad versionada y sin ampliar unilateralmente CAP-025.
No introducir handlers de atributos genéricos ni CSS libre para simular cobertura.

## Corte R20 — atributos y visibilidad conectados

Manifest/state/command admiten ATTRIBUTE y VISIBILITY de forma aditiva: los documentos
anteriores mantienen sus campos y digests; las nuevas declaraciones requieren selección
de un template/version aprobado por el operador. No se registró ningún template ni se
activaron flags. Clientes anteriores rechazan kinds desconocidos, no hacen fallback.

ATTRIBUTE declara un nombre cerrado (`title`, `aria-label`, `aria-description`, `lang`,
`dir`), máximo de caracteres y enum opcional. Sin enum permite texto inerte acotado,
no markup/controles/saltos de línea. `dir` admite ltr/rtl/auto y `lang` un subconjunto
acotado de tags de idioma; no se ofrece acceso a on*, style, src/href, IDs, atributos
del runtime ni aria-hidden genérico. El nombre recibido debe ser el declarado.
Los defaults originales también se validan; RESET vuelve al source, incluida ausencia
original del atributo. React presenta JSON como texto/inputs, nunca como HTML.

VISIBILITY exige display inline original explícito y compatible con el display
visible declarado. Ocultar fija `display:none !important`, hidden y aria-hidden;
mostrar restaura el display declarado, elimina hidden y refleja aria-hidden=false.
No elimina nodos ni recursos; ocultar no exime de grants, checksum ni validación de
dependencias. RESET/undo reconstruyen exactamente el output original desde source.

Los campos nuevos participan en staging por lote, preflight, CAS, versiones crecientes,
historial y recuperación ya existentes. No hay una segunda ruta de mutación ni cambios
en agentes CAP-025. Se probaron el lote/ACK incierto con repository simulado y la
restauración a versiones 3/4 sin reescritura del source. `RESET ALL` se normaliza al
campo de ese nodo, rechaza duplicados y mantiene la comprobación de imagen revocada.

Límite explícito del modelo V1: un campo declarado por elementId, sin declaraciones
ambiguas duplicadas sobre un mismo nodo. Varias propiedades del mismo nodo requieren
una evolución de manifest/state/staging, no sobrescribir overrides anteriores. La
ampliación no prueba montaje React, DB/HTTP real ni paridad visual; siguen para QA.

47/47 pruebas dirigidas y regresión ampliada 487/487 aprobadas; compilación de pruebas,
tipado web completo y diff-check pasan. Sin render físico, migraciones,
registro de templates, activación de flags ni cambios en los archivos CAP-027 reservados.

## Corte R20 — slots repetibles conectados

Manifest SLOTS declara hasta 128 IDs únicos de hijos inmediatos en su orden original.
SET_SLOT_ORDER exige una permutación completa: no inserción, eliminación, duplicación
ni traslado entre contenedores. El compilador mueve los mismos nodos y subárboles,
conservando posiciones de texto/comentarios; no modifica la fuente inmutable.
Se corrigió la llamada `detach` incompatible con Cheerio usando `remove` seguido
de reinserción de las referencias verificadas, sin serializar/clonar HTML.

Inspector proyecta defaults del source; UI aislada prepara orden por subir/bajar
con índices enteros acotados y reset. Usa el staging/command/CAS existente, sin
una ruta de persistencia alternativa. Orden original es no-op canónico cuando
no hay override; RESET e historial conservan versiones crecientes al cambiar estado.

Validación: siete pruebas nuevas pasan (cliente puro y servidor), incluyendo
identidad de nodos, anchors, listas anidadas, membresía inválida sin mutación,
edición conjunta de texto, no-op, RESET/undo/redo y fuente intacta.
Regresión ampliada CAP-029: **494/494** aprobadas, sin skipped.
`npx tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests` y
`npx tsc --noEmit --incremental --tsBuildInfoFile .tmp/cap029-web.tsbuildinfo`
aprobados; diff-check dirigido pasa. El runner con subprocesos falló por
`spawn EPERM`; repetición `node --test --test-isolation=none` ejecutó todos los
casos en un proceso. No se considera ese fallo de infraestructura un test funcional.

Sin montaje React/browser real, SQL/RLS/HTTP real ni renderer físico. No se editaron
CAP-027/022/025, catálogo reservado ni trackers globales. No migraciones/flags/deploy.
OP-026 queda implementado con QA manual pendiente; CAP-029 completo sigue parcial
por OP-027, auditoría locale/tokens-rango, aislamiento efectivo e integración final.

## Corte R20 — datasets de gráficos y renderer existente

CHART/SET_CHART_DATA reutilizan `slides/charts/svg-chart-renderer.service.ts`
sin modificarlo ni añadir motor/dependencias. Soportan bar/line/area/proportion.
Manifest fija identidad, tipo, metadatos y dos colores hex; comandos solo datos.
Schemas strict rechazan claves ajenas, markup/controles, coerción numérica,
valores no finitos o fuera de ±1e9, cambio de tipo y series sin labels alineados.
Proporciones deben cumplir 0 <= value <= total, total positivo: no clamp silencioso.

El techo del roadmap es 2.000 celdas (se cuentan también labels). Se conservan los
límites ya soportados por el renderer: 12 puntos en barras, 24 por serie, cuatro
series en líneas y dos en áreas. No se amplían artificialmente para afirmar soporte
de datasets de 2.000 celdas. Ampliarlos requeriría diseño de layout/LOD y mediciones.

Enrollment exige un div dedicado con SVG original idéntico a la salida normalizada
del renderer/template aprobado. No admite SVG arbitrario ni editables descendientes.
Cada cambio reconstruye desde la fuente inmutable; inspector proyecta defaults
inertes y la UI ofrece edición JSON acotada del dataset, preparación y reset por
el lote/CAS existente. No editor de código ni runtime importado. Un formulario
tabular sería una mejora de usabilidad posterior; montaje/foco/usabilidad real
del formulario JSON siguen sin probar y deben figurar en QA.

Orden/datos originales se normalizan a ausencia de override; no-op preserva digest.
RESET ALL/undo/redo reconstruyen el SVG original o editado con versiones crecientes.
La salida compilada vuelve a comprobar el presupuesto global DOM/CSS: no basta
que cada gráfico cumpla individualmente. Se amplió rootDir del build unitario a
production para incluir los dos módulos existentes de slides realmente reutilizados.

Cinco tests nuevos: cuatro tipos y determinismo/admisión, edición/inspector,
reset/no-op/undo/redo, sustitución de SVG y entradas malformadas. **499/499** en
regresión CAP-029 con `node --test --test-isolation=none`, sin skipped.
Build de pruebas y tipado web completo aprobados después de cambios de producción;
build unitario aprobado antes de los dos últimos tests, que sí compilaron en el
build completo final. Diff-check dirigido pasa. Sin browser/render físico,
DB/HTTP/RLS reales, flags, registro de templates, migraciones ni deployment.
CAP-022/025/027, catálogo reservado y trackers globales permanecen sin modificaciones
desde este bloque. CAP-029 sigue parcial: no extrapolar estos tests a R21/R22 efectivos.

## Corte R20 — tokens numéricos por rango

RANGE_TOKEN/SET_STYLE_RANGE amplían OP-023 sin cambiar las declaraciones THEME
existentes ni sus hashes. Template declara tokenId, propiedad cerrada, minimum,
maximum, step y defaultValue. Solo font-size (8–144 px), letter-spacing (-8–32 px),
line-height (0.5–4 sin unidad), opacity (0–1) y border-radius (0–128 px).
El rango de cada plantilla puede ser más estrecho, nunca ampliar estos límites.
Máximo/default alineados al paso; máximo un millón de posiciones para evitar pasos
inutilizables. Tolerancia decimal numérica de 1e-8 posiciones, sin clamp/coerción.

Source debe declarar el valor original inline exactamente en la unidad canónica
y no sustituir tokenId. El compiler solo cambia esa propiedad a número+unidad
controlados con !important, no introduce CSS/URLs/var/calc/handlers proporcionados
por cliente. Inspector presenta el default inerte; campo React prepara número y
reset por el mismo staging/CAS. Default es no-op canónico; RESET ALL y restore
conservan fuente y reconstruyen output original a versiones crecientes.

Cuatro pruebas nuevas de compiler/inspector, no-op/reset/undo/redo, rechazos de
comando/source y política de los cinco rangos; **503/503** regresión CAP-029,
sin skipped, usando runner en proceso único. Build de pruebas, tipado web completo
y diff-check dirigido aprobados. No montaje React/browser/render físico,
DB/HTTP/RLS reales, flags/migraciones/registro de templates/deploy.
No archivos reservados CAP-022/025/027, catálogo ni trackers globales modificados.
Persiste el límite V1 de un campo por elementId; no se presenta como soporte de
varias propiedades simultáneas del mismo nodo. R19–R22 siguen parciales: locale,
aislamiento efectivo, integración autorizada y entrega final todavía no cerrados.

## Corte R20 — texto con idioma y dirección

TEXT agrega localePolicy opcional, sin defaults insertados en manifiestos existentes.
Declara hasta 32 combinaciones únicas de language/direction y un default incluido.
Language admite tags canónicos validados por Intl (subconjunto acotado, máximo
64 caracteres); direction es ltr/rtl/auto. No se infiere dirección del idioma.
El source inscrito exige lang/dir explícitos iguales al default de la plantilla.

SET_TEXT agrega locale opcional en el wire histórico, pero obligatorio para una
declaración con localePolicy. Las declaraciones anteriores rechazan locale en el
comando: no adquieren nuevos permisos. Texto+locale constituyen un único override,
sin duplicar declaraciones elementId ni segunda operación de atributos. Compiler
usa texto inerte y lang/dir, no markup. Manifest/override digests incorporan las
nuevas opciones solo si están presentes; snapshots anteriores conservan su forma.

Inspector proyecta locale original únicamente cuando hay policy; rechaza defaults
sustituidos. UI ofrece selector autorizado y aplica lang/dir también al input para
edición RTL/LTR. RESET ALL/undo/redo reconstruyen texto y atributos originales a
versiones crecientes, sin cambiar source. No se afirma garantía de shaping, layout,
cobertura/fallback de fuentes o accesibilidad visual por la sola presencia de dir.

Cuatro pruebas nuevas: operación atómica RTL/Unicode+inspector, reset/undo/redo,
compatibilidad legacy y rechazos de source/policy/opciones. Regresión **507/507**
sin skipped, build de pruebas y tipado web completo aprobados; diff-check dirigido
pasa. Sin browser/renderer físico, SQL/RLS/HTTP reales, migraciones/flags/templates
ni deploy. No se tocaron CAP-022/025/027, catálogo ni trackers globales.
OP-021 queda implementado con QA manual pendiente. CAP-029 sigue parcial por
aislamiento efectivo, integración autorizada y auditoría/handoff final.

## Corte R21 — CSP del preview editable exitoso

`composition-html-editing-preview-csp.server.ts` deriva hashes SHA-256 del runtime
inline empaquetado, style blocks y atributos style de la página compilada por host.
No altera HTML/whitespace ni fuente. Esta función NO es sanitizador: jamás llamarla
con HTML bruto recibido del cliente. Los scripts importados ya deben haber sido
rechazados por admission del compiler; hacer hash de un script arbitrario le daría
permiso. La llamada está después del compiler en la ruta GET del draft, solo con
punteros HTML editables. Legacy conserva su política anterior; no fallback amplio
si la política editable falla (422 seguro/correlacionado sin retry).

Directivas: default-src none, scripts exactos por hash, script-src-attr none,
styles exactos por hash (unsafe-hashes solo para atributos), img/media/font self
y blob, connect/worker/frame/object none, frame-ancestors self, base/form/navigation
none y sandbox allow-scripts SIN same-origin/forms/popups/downloads. Page4MiB,
20.000 nodos de página y cabecera12KiB; exceso rechaza sin relajar permisos.
Scripts externos y handlers inline se rechazan. No HTTPS/data generales ni eval.
Las propiedades style asignadas directamente por JavaScript y el mecanismo hash
de atributos se contrastaron con [MDN style-src-attr](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr).
Esto no sustituye pruebas de CSP/runtime/GSAP/browser ni acredita procedencia del SDK.

Cuatro tests nuevos: hashes exactos, whitespace/entities/deduplicación, rechazo de
handlers/scripts externos/presupuestos y lector RPC simulado→compiler interactivo
real→política. **14/14** selección dirigida; **511/511** regresión CAP-029 sin skipped.
Build de pruebas, tipado web completo y diff-check pasan. Ningún browser/renderer,
DB/HTTP real, migración, flags, registro de templates ni despliegue ejecutado.

Brecha actual explícita: la ruta de preview todavía no suministra al compiler el
contexto HTML de `read_html_editing_compilation` ni materializa recursos locales
entregables al browser. Con punteros editables, continúa rechazando CONTEXT_REQUIRED;
la cabecera nueva NO transforma ese flujo en un preview funcional ni cierra R22.
`conformance-media/{UUID}` son aliases lógicos, no URLs entregadas ni permisos.
El reader/service existente revalida versión exacta/tenant/grants; hay que conectar
una entrega acotada de recursos y fuente autorizada sin firmar URLs arbitrarias.
También quedan MessagePort+nonce/source/version/sequence y aislamiento de CSS/geometry.
CAP-027/022/025, catálogo reservado y trackers globales no se editaron en este bloque.

## Corte R21/R22 — adquisición de bytes de imágenes para preview

`composition-html-editing-preview-images.server.ts` reutiliza el productor de
snapshot/images existente: revisión histórica exacta por RPC, grants actuales,
links de draft y registros de imágenes. No duplica catálogo/manifest ni crea jobs.
Adquiere solo las imágenes efectivamente utilizadas; no publica URLs de Storage.
Firma privada de 60s resuelta por host contra origen Storage configurado, HTTPS
(HTTP únicamente localhost/127.0.0.1), path exacto de objeto autorizado y token único.
No redirects, credenciales de navegador ni cache. HTTP200/body/MIME exacto,
sin codificación comprimida ni entrega parcial; Content-Length, cuando exista,
debe coincidir. Stream cuenta bytes y hash incremental, rechaza exceso/truncamiento/
sustitución y cancela lecturas incompletas. Copia chunks para evitar mutación externa.

Presupuesto: máximo32MiB por identidad del schema reutilizado, total128MiB, lectura
secuencial, señal de15s y abort del solicitante. Metadata Sharp (dependencia ya
instalada) coteja PNG/JPEG/WebP, dimensiones positivas, edge8192, pixels16.777.216
y una página. Parser acotado de containers rechaza animación APNG/WebP, longitudes
malformadas/extra y exceso de16.384chunks. No transcoding, extracción de thumbnails,
decodificación física completa de píxeles, QA visual ni garantía de seguridad del
decoder por estos checks. La firma Storage y metadata Sharp no son preemptables
por la señal en esta implementación; no anunciar deadline integral del ensamblado.

Tras descargar, una segunda preparación autorizada coteja bundle exacto/grants y
todas las identidades (checksum/tamaño/MIME/bucket/path). Drift/revocación retienen
el rechazo, sin retry. Devuelve bytes locales y scope explícito de NO evidencia
de render. No concede un lease permanente de permisos para servirlos después.

Seis tests nuevos con PNGs generados por Sharp, tamaño real y crypto; fetch/Storage/
RPC simulados. Incluyen éxito, origen/path/token sustituidos antes de fetch,
status/MIME/size/hash/format erróneos, pre-abort, geometría/animación y revocación/
drift después de descarga. **6/6** dirigidos y **517/517** regresión CAP-029 sin
skipped; build de pruebas y tipado web completo aprobados.

La ruta de preview aún no consume este ensamblador: no se declara cierre de R22
por disponer de bytes de imágenes. Falta integrar el reader nativo-media existente
(`composition-html-editing-snapshot-media.server.ts`), fuentes y transporte browser,
cuotas/deadline del handler, entrega exacta/reautorizada y canal seguro. No usar
URLs firmadas como sustituto de identidad ni entregar aliases lógicos como URLs.
No DB/HTTP reales, browser/render físico, migraciones/flags/templates/deploy.
CAP-022/025/027, catálogo y trackers globales no fueron modificados.

## Transporte compartido y fuentes nativas del preview — 2026-10-07

Se extrajo `composition-html-editing-preview-storage.server.ts` desde el lector de
imágenes, conservando comprobación de origen/path/token, HTTP/MIME/tamaño/SHA y
cancelación. Ahora imágenes y fuentes usan la misma adquisición. La identidad es
host-owned y procede de lectores autorizados, nunca de campos de un request.
Admite los buckets fuente existentes y `organization-fonts`; no abre otros buckets.
Techo de contenido bufferizado por recurso:64MiB antes de firmar. Este techo no es
un límite de memoria pico: chunks y copias pueden coexistir. No acredita soporte
de videos grandes; falta transporte streaming/spool y presupuesto global del host.

`composition-html-editing-preview-fonts.server.ts` reutiliza el reader tenant-scoped
de fuentes nativas y los contratos existentes de familia/identidad: máximo32
referencias,50MiB por fuente y128MiB acumulados. Solo uploaded/READY, MIME cerrado
WOFF/WOFF2/TTF/OTF y bucket `organization-fonts`. Descarga secuencial con hash/tamaño
verificados, alias local SHA+extensión y deduplicación de contenido idéntico. Tras
descarga relee registros y coteja ID/familia/checksum/tamaño/MIME/status/bucket/path;
revocación o drift rechazan sin retry. Retorna recursos/compiled fonts con scope
que excluye evidencia de glifos/render. No demuestra permisos duraderos ni valida
el documento original del caller: el host debe autorizar primero su versión exacta.
La lectura DB/firma no es preemptable por la señal; siguen pendientes timeout integral
y reautorización de la entrega. Fuentes de plantillas no se inventan desde CSS remoto.

Cuatro tests nuevos usan bytes sintéticos explícitamente NO decodificables como
font, cliente Supabase/fetch simulados y checks reales de SHA/contratos. Cubren
salida local, revocación/hash/path posteriores, bucket/MIME/familia/tamaño/abort y
rechazo del buffer/path/bucket antes de firmar. **4/4** dirigidos; **521/521**
regresión CAP-029 sin skipped. Comandos ejecutados desde `apps/web`:

```powershell
npx tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
npx tsc --noEmit --incremental --tsBuildInfoFile .tmp/cap029-web.tsbuildinfo
$cap029Tests = @(rg --files .tmp/cap029-tests/domains/production/composition-editor/__tests__ | Where-Object { $_ -match 'composition-html.*\.test\.js$' })
$htmlContractTests = @(rg --files .tmp/cap029-tests/domains/production/composition-editor/html-editing | Where-Object { $_ -match '\.test\.js$' })
node --test --test-isolation=none @cap029Tests @htmlContractTests
```

Ambas compilaciones aprobadas. No browser/HTTP/DB/RLS/font decoder/render físico
ni QA formal; sin migraciones/flags/registro/deploy. No se editaron catálogo,
CAP-022/025/027 ni trackers globales. R21/R22 siguen parciales: el handler actual
todavía no consume contexto editorial ni estos recursos. Próximo bloque necesario:
adquisición nativa-media con reader existente, entrega browser-compatible de bytes
exactos bajo cuotas y canal seguro; no aliases como URLs ni permisos desde el SHA.

## Adquisición nativa y spool privado para preview — 2026-10-07

`composition-html-editing-preview-storage.server.ts` ahora separa el stream
verificado hacia un sink host-owned del lector bufferizado. Nunca servir chunks
antes de confirmar tamaño/hash completos. Rechaza chunks de más de1MiB antes de
copiarlos/escribirlos y parámetros de firma distintos de token. El lector pequeño
conserva techo64MiB y señal15s, pero usa un único buffer de contenido en lugar de
retener chunks+concatenación. Stream tiene señal120s; no aumenta el buffer para
admitir videos grandes. Buffers internos de fetch/runtime no quedan certificados
por el límite del chunk ni por tests; firma y filesystem requieren cooperación.

`composition-html-editing-preview-spool.server.ts` adquiere en un directorio
temporal generado por el host y archivo exclusivo `wx`, modos700/600. No recibe
ruta de destino ni copia URL/credenciales al descriptor. Devuelve identidad frozen
y archivo solo después de verificar bytes, con scope sin decode/render. Cleanup
concurrente/idempotente elimina exclusivamente archivo y directorio conocidos,
sin recursive delete. Lectura pequeña posterior usa descriptor/size/lectura acotada/
EOF/SHA para detectar alteraciones del spool antes de retornar bytes. No usa
readFile sin límites para imágenes. Modos POSIX NO garantizan ACL/aislamiento en
Windows; permisos temporales operativos, cuotas globales y retención tras caída
del proceso deben definirse antes de habilitar una ruta productiva.

`composition-html-editing-preview-native-media.server.ts` reutiliza
`readHtmlSnapshotNativeMedia` para production/branding/sound y dependencias deck.
Captura copia validada del documento del host, coteja ámbito/vínculos/status y
admite identidades de Storage, no URLs públicas como autoridad. Presupuesto de
contenido/disk por preparación:2GiB acumulados (el límite individual sigue el
manifest existente),180s de señal global, adquisición secuencial y cleanup al
fallar. Raster PNG/JPEG/WebP usa exactamente schema/metadata/container del lector
de imágenes existente; SVG no se habilita por este adapter. Al terminar relee
manifiestos y coteja ID/checksum/tamaño/MIME/bucket/path/mapping de deck; drift o
revocación rechazan sin retry. Inventario de cleanup interno independiente del Map
devuelto. Aliases `conformance-media/UUID` siguen siendo claves de compilador,
NO URLs browser. El caller debe autorizar antes el documento exacto y reautorizar
antes de servir; este adapter no obtiene un permiso permanente ni reemplaza RPC.

Diez tests nuevos de native media/spool, **531/531** regresión CAP-029 sin skipped;
build de tests y tipado web completo aprobados con los comandos del corte anterior.
Incluyen scope/link/hash/path drift, presupuestos acumulados antes de firmar,
raster Sharp real y bytes inválidos, abort, integridad/EOF, sinks fallidos, chunk
excesivo, cleanup concurrente incluso tras vaciar el Map y alteración de disco.
Un test escribe realmente64MiB+1 usando bloques64KiB, verifica tamaño/tail y limpia;
Storage/fetch son puertos simulados y el contenido NO es un video decodificable.
No extrapolar ese caso a prueba de2GiB, benchmark RSS/disco, codec o reproducción.

Siguiente integración obligatoria: inventario conjunto imágenes/nativo/fonts,
conflictos de identidad/aliases y presupuesto global, contexto editorial exacto,
entrega browser-compatible y canal seguro. El handler todavía no consume estos
adapters. R21/R22 y CAP-029 siguen parciales; no se declara QA-ready por completar
adquisición. Sin navegador/render físico/DB reales, QA formal, migraciones,
flags/registro/deploy. Catálogo UX, CAP-022/025/027 y trackers globales intactos.

## Portfolio único y compilación autorizada del preview — 2026-10-07

`composition-html-editing-preview-inventory.server.ts` unifica las identidades
autorizadas de imágenes HTML, medios nativos y fuentes. No es otro catálogo ni
una autoridad: consume registros de los lectores existentes. Rechaza UUID de
media compartido con checksum/tamaño/MIME/bucket/path contradictorios y colisión
HTML-production contra branding/sound. Media/font mantienen namespaces separados.
Font aliases idénticos SHA+extensión coalescen con elección determinista de fuente
de adquisición; cada registro y familia independiente quedan en el fingerprint.
Mismo alias con tamaño contradictorio rechaza. Mappings de URLs deck son únicamente
keys de reemplazo, no permisos ni URLs de descarga.

Presupuesto conjunto antes de firmar: máximo250 identidades media+32 fonts,
2GiB de contenido acumulado de recursos únicos. Mantiene128MiB de imágenes HTML y
128MiB de registros font, límites raster32MiB/font50MiB y buckets existentes.
El techo es por preparación, no una cuota global de disco/concurrencia entre
usuarios. Fingerprint incluye recursos, fuentes y sus ubicaciones, familias y
bindings/mappings; no usarlo como permiso, ni loggear ubicaciones privadas.

`composition-html-editing-preview-resources.server.ts` ahora ofrece una entrada
host-only de preparación conjunta: RPC exacta+productor images → reader nativo →
reader font → preflight → adquisición única por alias → raster admission común →
relectura de todo el portfolio → compiler existente con contexto editorial fresco
y recursos locales → otra relectura completa antes de devolver. Source y grants
nunca vienen del cliente. Detecta revocación y drift incluso durante la compilación
asíncrona. Usa spool común en vez de acumular todos los binarios en RAM; inventario
de cleanup privado independiente de Maps expuestos. Fallos limpian archivos conocidos,
sin retry/cache/jobs/copias Storage ni cambiar documento/historial.

Salida: preview HTML con overrides reales, fuentes locales y aliases, más archivos
verificados y contexto/bundle; scope explícito de NO entrega browser ni evidencia
de render. No entregar ese HTML aún como preview funcional: faltan transporte,
canal seguro/CSP final y reautorización de serving. La relectura es puntual, no lease
permanente ni transacción única entre todas las tablas. Firma/DB/filesystem deben
cooperar con señal180s; no se anuncia deadline físico garantizado.

Nueve pruebas nuevas: coalescencia namespaces/fuentes/medios, fingerprint estable,
conflictos, presupuesto global, mapping keys y preparación conjunta real. Esta
última usa reducer/command de producción para SET_TEXT, verifica contenido del DOM
compilado, comparte una imagen HTML/native en una sola descarga y adquiere imagen,
video/font en tres downloads cuando son distintos. Revocación/native/font drift en
tercera lectura (después de compile) rechazan; presupuesto/conflicto no firman.
Cleanup concurrente de archivos reales comprobado incluso tras vaciar Map público.
Sharp PNG/crypto/filesystem/compiler son reales; RPC/DB/fetch son simulados, video
y font son bytes sintéticos NO decodificables. No prueba permisos SQL, transporte
browser, font shaping/codec ni paridad visual/audio.

**540/540** regresión CAP-029 sin skipped; build de pruebas y tipado web completo
aprobados con comandos del corte anterior. No QA formal, migraciones/flags/registro/
deploy ni cambios en catálogo, CAP-022/025/027 o trackers globales. Preparación
conjunta implementada; R21/R22 y CAP-029 completos todavía parciales.
Siguiente bloque: entrega exacta de esos recursos al iframe de origen opaco y
MessagePort/source/nonce/version/hash/secuencia/rate/ACK, sin URLs firmadas genéricas
ni tratar aliases como recursos ya disponibles.

## Contrato y endpoint MessagePort del preview editable — 2026-10-07

Añadidos `composition-html-editing-preview-channel.contract.ts` y
`composition-html-editing-preview-channel.client.ts`. Reutilizan schemas de
commands/events del preview existente: no segundo player, gateway ni persistencia.
Sesión fija version1/nonce aleatorio256bits/hash exacto/generación; nueva revisión
requiere un nuevo contexto de sesión, no cambiar el nonce/hash en un endpoint vivo.
Handshake verifica source esperado, origin configurado (incluido null opaco),
sesión completa y exactamente un port; conexión repetida rechaza. null nunca basta
como autoridad. El caller mantiene ownership del handshake y exclusividad del port.

Endpoint tiene solo listeners del MessagePort; no consume window messages.
JSON UTF-8 máximo64KiB, schema estricto y bindings internos ready/load-error/
visual-patch comprobados. Secuencias independientes exactas y monotónicas por
dirección, sin gaps/replay; rate60/s por dirección cuenta ACKs. Stop-and-wait limita
a un data packet pendiente por extremo; no cola ni retry. ACK también usa secuencia
y referencia exacta, pero no produce ACK recursivo. Timeout5s cierra y conserva
semántica incierta; errores de handler producen REJECTED seguro, sin stack privado.
ACK ACCEPTED significa únicamente que terminó el handler, NO commit, media ready,
paridad visual ni permisos de edición. Intenciones siguen requiriendo policy/gateway.

Abort/context teardown cancela scope del callback, cierra port y rechaza ACK pendiente.
Callback no cooperativo puede completar efectos propios; no se anuncia rollback ni
preemption. Su final tardío no emite ACK ni reabre sesión. Manejo de ACK mientras
otro callback sigue activo no libera accidentalmente la exclusión del data packet.

Nueve tests nuevos con MessageChannel/ports reales de Node: nonce, handshake source/
origin/session/replay/ports, payload UTF-8/ciclos/extras/stale, commands/events/ACK,
BUSY/rechazo, secuencias/dirección/ACK inesperado, rate y cancelación. Timeout5s real
y completion tardío comprobados; callbacks no disparan otro command automáticamente.
No navegador/iframe/CSP/montaje React ni fuente audiovisual física.

Build acotado `npx tsc -p tsconfig.html-preview-channel-test.json` y sus9/9 pasan.
Es un config nuevo propio que hereda opciones de test existentes, no modifica
config worker ni reduce la suite global. Inicialmente hubo errores transitorios
en archivos reservados CAP-027 (owned-executor y windows comparison ports); no se
corrigieron desde este bloque. Revalidación final de build conjunto y tipado web
pasa. **549/549** regresión CAP-029 sin skipped con los comandos anteriores.

Este endpoint aún NO está montado en host/runtime: el preview existente conserva
su comunicación legacy hasta el wiring correspondiente. Binary delivery tampoco
se resuelve con el codec JSON de este bloque. Falta unir sandbox de origen opaco,
runtime/ACK existentes y recursos exactos sin rutas lógicas sin resolver, así como
auditoría de CSS/geometry y handoff final. R21/R22 siguen parciales, no QA-ready.
Sin migraciones/flags/registro/deploy/QA formal. Catálogo, CAP-022/025/027, compiler/
protocol compartidos y trackers globales no fueron modificados.

## Corte R21 — montaje seguro del runtime, 2026-10-08

El paquete propio `tools/html-preview/build-runtime.mjs` empaqueta el adaptador
browser con esbuild ya instalado, sin dependencia nueva ni compilación por request.
Bundle actual379.805bytes/111inputs fijados por SHA; máximos512KiB/bundle,
128KiB/manifest,4MiB/input y32MiB/suma. Lecturas acotadas por descriptor rechazan
crecimiento/EOF/tamaño; hash de bundle y cada input rechazan package stale. No es
attestation firmada ni sandbox OS. `.tmp` ignorado exige packaging explícito de
artefactos e inputs; no se cambió package/lock/config común ni despliegue.

`composition-html-editing-preview-runtime.client.ts` recibe un único handshake
ligado a parent/source/origin/session; captura autoridad antes de instalar listener.
Elimina listener global al conectar; los comandos delegan en el controlador
existente y los eventos pasan por MessagePort. Cola128/coalescencia solo estados
transitorios/cadencia100ms, pagehide/errores/overflow cierran sin retry. Se corrigió
timer stale que detenía los eventos tras vaciar cola; validación session/generación
antes de encolar. ACK conserva significado de handler completado, no media ready.

Montaje servidor adapta únicamente dos fragmentos exactos del transporte del
controlador compilado: post y listener. Comprueba hash/generación/ABI; cualquier
drift rechaza, sin fallback legacy. Conserva escena/estilos/timeline; recompone CSP
por hashes de todos los scripts. Compiler/protocol/render compartidos intactos.

`prepareCompositionHtmlEditingSecurePreview` valida origin/session y carga el
runtime ANTES de autorizar/firmar recursos. Reutiliza preparación única, rechecks
de cartera y compilación exacta; monta síncronamente tras última autorización y
dispone spools si falla. El consumidor debe disponer también cada resultado válido.
No hay permiso lease: una entrega futura debe comprobar su propia autoridad.

Siete pruebas nuevas: cola/drenaje/cadencia, origen/generación/overflow, montaje de
salida real del compiler con CSP y sintaxis, lectura de package actual, ejecución
del bundle real en VM con puertos Node, fixtures de filesystem con pins stale/
duplicados/traversal/manifest sobredimensionado, y preparación integrada con HTML
editado/media/font y tres rechecks. Supabase/descargas simuladas; no decoding de
video/font, enforcement CSP en navegador ni HTTP/DB/RLS real.

Comandos desde `apps/web`: `node tools/html-preview/build-runtime.mjs`,
`npx tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests`, regresión
CAP029/contratos con selección `composition-html*.test.js` + `html-editing/*.test.js`
y `node --test --test-isolation=none`: **556/556**, sin skipped. Tipado web
`npx tsc --noEmit --incremental --tsBuildInfoFile .tmp/cap029-web.tsbuildinfo` pasa.
Instrucciones reproducibles y límites en `tools/html-preview/README.md`.

**R21/R22 siguen parciales:** montaje preparado no equivale a preview servido.
Falta entrega binaria exacta que resuelva aliases, adopción del port en el host
parent, auditoría CSS/geometry y handoff completo. No se activaron rutas/flags,
migraciones, catálogo ni deploy; CAP022/025/027 y trackers globales preservados.

## Corte R21/R22 — entrega HTTP binaria preparada, 2026-10-08

Se añadió ruta propia GET `drafts/{draftId}/html-preview/resources?cap=...`,
handler separado, capacidades de lectura HMAC, servicio de autorización/adquisición,
stream de archivo/rangos y presupuesto por instancia. No se modificó la ruta
legacy de preview, `NativeCompositionPreview`, compiler/protocol, catálogo UX,
CAP-022/025/027 ni trackers globales. No se habilitó flag ni se configuraron claves.

La capacidad180s liga actor/tenant/draft, session nonce/hash/generación, app audience,
bundle SHA, fingerprint de TODA la cartera y alias/checksum/tamaño/MIME del recurso.
Clave dedicada32bytes del operador compartida entre instancias; MAC con dominio
propio/constant-time/codificación canónica/payload estricto/4KiB. No reutilizar keys
Auth/Supabase ni aceptar claims/paths/grants desde request. Firma no sustituye
autorización actual: readPortfolio se reutiliza antes de adquirir y después de
verificar spool, incluyendo RPC exacto de actor/roles/templates/grants y lectores
de links/media/fonts. Se verifica expiración otra vez antes de servir.

Ruta exige capacidad antes de crear cliente privilegiado, consume cuotas compartidas
actor/org existentes y rechaza origin externo, query extra/duplicada, IDs ajenos y
destinos document/script/navigation. `Origin:null` solo habilita CORS del binario ya
autorizado; no hay allowance de credentials/cookies. Respuestas private/no-store,
no-referrer/nosniff y errores seguros sin token ni detalles del proveedor. La clave,
audience del operador y redacción `cap` en logs de proxy/CDN son prerrequisitos de
ambiente, NO configuración tomada de Host/request ni activación realizada aquí.

Antes del primer byte se verifica el archivo COMPLETO por size/SHA en el MISMO
descriptor, aun para un rango pequeño. Reautorización posterior y stat detectan
cambio durante la comprobación. Pulls64KiB/backpressure sin concatenación del video;
HTTP200/206, rangos únicos cerrados/open/suffix,416 en rangos inválidos. EOF/cancel/
abort/error cierran descriptor y eliminan spool propio. Snapshot al inicio de stream
no implica lease permanente ni reautorización continua de cada chunk ya servido.

Presupuesto del pool de entrega:4lecturas/2GiB privado por instancia, liberación
idempotente tras cleanup confirmado; fallo de cleanup de adquisición conserva
reserva incierta. No es cuota de TODOS los preparadores ni admisión distribuida ni
recuperación tras crash. Se reutiliza infraestructura de cuotas, sin motor nuevo
de jobs, cache de autorización o dependencia. Range GET actualmente readquiere y
verifica el original completo: coste de seek/load requiere medición e integración
coordinada, no prometer escalabilidad productiva por tests pequeños.

Ocho tests nuevos: MAC/scope/expiry/codificación/oversize, rangos, streaming de
archivo real con límite chunk y cleanup, tamper/revocation/cancel/abort, presupuesto,
handler/request/quota/navegación,429/416/503 seguros y servicio combinado con cartera
HTML/video/font donde revocación/drift/expiración final rechazan antes de responder.
No FFmpeg/decoder/font real ni HTTP desplegado/browser/DB/RLS/migraciones ejecutados.

Build propio `npx tsc -p tsconfig.html-preview-test.json` incluye la ruta y ambient
declaración compartida existente, salida propia `.tmp/html-preview-tests`;
**56/56** preview tests pasan. Inicialmente compile común/web bloqueado por tipado
transitorio `composition-controlled-event-seek.test.ts` del frente CAP027; no se
editó ese archivo. Revalidación final compile común y tipado web pasan. Regresión
CAP029 + contratos con comandos registrados: **564/564**, sin skipped.
Detalle operativo/comandos/configuración/restricciones: `tools/html-preview/README.md`.

Decisión de transporte sustentada en
[MDN, partición de Blob URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob#storage_partitioning):
no asumir Blob URL creada por el padre accesible desde frame opaco.
[CSP3](https://www.w3.org/TR/CSP/) conserva aislamiento; enforcement/browser queda
para validación real, no lo certifican headers ni puertos Node.

**CAP-029/R21/R22 permanecen parciales:** endpoint preparado no es el preview
completo. Falta issuer autenticado conectado a snapshot/inventario, sustitución
estricta de aliases/CSP por URLs de esta ruta, conexión parent/runtime al canal,
auditoría CSS/geometry/R19-R20 y handoff final. Secret/packaging/log redaction,
retención/reclamación por crash y mediciones son gates explícitos, no trabajo oculto
del tester ni excusa para marcar implementación completa. Se preserva QA formal
diferido y se mantiene el objetivo completo.

## Corte R21/R22 — issuer autenticado y aliases resueltos, 2026-10-08

Ruta propia GET `drafts/{draftId}/html-preview` acepta exclusivamente hash/r/nonce
de handshake; deriva actor/tenant/reviewer de autenticación del servidor y consume
cuotas compartidas antes de preparar. Configuración dedicada de operador compartida
con ruta binaria valida key/audience/storageOrigin; nunca se toma del request.
Nonce suministrado por host se valida contra hash/generación, no concede permisos.
No fallback a latest, raw HTML, grants, paths ni fuente serializada por el cliente.

Issuer compone preparación segura y emite capacidades ONLY desde snapshot/cartera
autorizados después del último recheck. Liga bundle/fingerprint/recurso/session y
expira180s. Binding host-only cambia atributos DOM de recurso y sinks CSS URL por
la ruta binaria exacta del draft; no reemplazo global de texto/script/CSSquoted-content
ni IDs/fragments/hash nativo. Reutiliza PostCSS; scanner acotado distingue comentarios
y strings con gramática url() ya admitida. Referencias desconocidas/remotas/variables,
import/namespace o destinos no comprobados rechazan, sin fallback.

CSP recompuesta permite image/media/font ONLY desde endpoint local EXACTO; no self/
blob/Storage genéricos en el modo bound ni tokens dentro del header. Hashes efectivos
de scripts/style/atributos, sandbox allow-scripts sin same-origin y restricciones
connect/worker/frame/object conservadas. Se eliminan spools antes de retornar HTML;
entrega de cada recurso usa sus rechecks independientes. No tocar render/core/protocol.

Preparación conjunta y entrega binaria comparten admisión por instancia4operaciones/
2GiB ANTES de cualquier firma; páginas sin recursos reservan slot0bytes. Cleanup
confirmado libera reserva; adquisición con cleanup incierto la conserva. No afirmar
cuota sobre standalone preparers, fleet admission ni recuperación por crash.

Ocho tests nuevos: preservación de texto/script/stylequoted-content/SVG al bind,
rechazos de referencias/destinos/CSP, página autenticada y sesiones exactas, query/
origen/identidad inyectada, anonymous/role/tenant/quota, configuración, issuer real
de fixture HTML/video/font→capacidad→GETbinario/rango y backpressure de preparación
compartido con entrega. Snapshot/video/font/roles de Supabase simulados, archivos/
bytes/crypto reales; no navegador/HTTPdesplegado/SQLRLS/renderer/QA formal.

Validación final: build propio `tsconfig.html-preview-test.json` incluye ambas rutas
y handlers; **64/64** preview tests. Compile común `tsconfig.hyperframes-test.json`
y tipado web pasan. Regresión CAP029+contratos **572/572**, sin skipped. Las dos
fallas iniciales del nuevo fixture eran role `admin` en vez del contrato `ADMIN`;
se corrigió fixture sin ampliar REVIEWER_ROLE_SET. Tipo de config ahora explícito
Uint8Array, sin acoplar contrato de key a Buffer. Documentación/comandos operativos
actualizados en `tools/html-preview/README.md`; sin cambios a package/config común.

**CAP029 sigue parcial:** ruta compilada/bound no equivale al editor conectado.
Falta adopción por host visible, lifecycle/ACK por canal y renovación/expiración
para long-play/seek, audit CSS/geometry/R19/R20 completo y handoff final. Gates de
secrets/packaging/log redaction, crash retention y mediciones pendientes explícitos.
No se activaron flags, SQL, catálogo, deployment ni QA manual. NativeCompositionPreview
y CAP022/025/027/trackers globales preservados.

## Corte host visible y lifecycle — 2026-10-08

El host guardado selecciona la ruta segura solo para documentos con HTML editable.
La comparación conserva el tipo de su snapshot, hash y sesión propios; no cambia
de ruta al editar la revisión actual. Presets/agentes/no-HTML conservan las rutas
existentes. Wiring acotado en NativeCompositionPreview y callbacks opcionales de
viewport/comparison; no compiler/protocol/worker ni módulos CAP022/025/catálogo.

Host independiente transfiere un solo MessagePort, reutiliza el handler existente
y rechaza eventos window para frames seguros. Cola64, cadence50ms y timeout10s;
solo coalesce comandos idempotentes adyacentes, nunca play/pause/visual patches.
Admisión no significa ACK visual ni persistencia: coordinator existente sigue
esperando el evento de resultado. Sesión estable evita recargas por edición live.

Factory/bootstrap/callback rechazados cierran sin retry; load repetido no sustituye
un canal vivo. Identidad se captura antes de navegar, no al recibir load tardío.
Suscripciones auth/tenant invalidan inmediatamente canales idle y borran la página
del iframe; se retiran en teardown. Navegación about:blank no puede reconnectar al
runtime anterior. Error iframe seguro se reporta aunque el flag legacy syncV2 esté
apagado. Runtime pausa su controller existente al cerrar/pagehide; no nuevo reloj.

Siete tests nuevos host: URL, puertos reales/orden/coalescence, transferencia única,
overflow, factory/bootstrap error, owner idle/callback capturado, callback fallido
y timeout con reloj controlado. Test runtime verifica pause al pagehide. Build
runtime379881bytes/111inputs fijados; compile scoped/común y regresiones **71/71**
preview, **579/579** CAP029+contratos, sin skipped. Estos resultados NO acreditan
montaje React, browser/cookies/CSP/CORS, sesión HTTP/SQLRLS ni render físico/QA manual.

**CAP029 continúa parcial:** falta renovación de capacidades para long-play/seek,
audit R19–R22 completo y entrega final reproducible. No secrets/flags/migraciones/
templates/deployment/QA activados ni cambios a trackers globales. Las reservas del
compañero permanecen vigentes; este corte sustituye el pendiente de host adoption
de la nota anterior, no sus limitaciones de expiración o entorno.

## Corte emisor de renovación y cliente — 2026-10-08

Endpoint propio GET html-preview/renew reutiliza el handler autenticado y la misma
preparación del snapshot exacto; roles/tenant/quota compartidos, sin claims de
autoridad del cliente. Factory server propia evita duplicar configuración/auth de
rutas. Respuesta JSON strict/acotada contiene sesión, bundle/inventario, tiempos y
aliases/capacidades, no HTML/source/Storage/keys. URLs solo endpoint del draft,
sin query extra, duplicados, credenciales ni fragmentos. Errores safe sin valores
Zod/capabilities. Lifetime centralizado180s; cleanup tardío/clock rollback rechazan.

Cliente separado reutiliza lector JSON streaming acotado, GET único credentialed,
no-store/redirect:error, timeout/abort y validación exacta; exige30s de vida restante.
No cambia documento, no programa refresh, no reintenta. Renovación vuelve a adquirir
y verificar portfolio: coste/latencia siguen pendientes de medición; no CAP022cache.

Validación previa del emisor: **77/77** preview y **585/585** CAP029/contratos, compile
scoped/común y tipado web aprobados antes de añadir el helper cliente. Seis pruebas
nuevas cubren contrato/HTTP y emisor real con bytes/crypto: capacidad anterior expira,
nueva conserva sesión/inventario, revocación impide firma, cleanup tardío y rollback.
Proveedor/Supabase simulados, no browser/SQL/render físico ni QA formal. Tests cliente
y revalidación final se registran al terminar; no extrapolar esa evidencia previa.

Revalidación final tras el helper: cuatro tests contrato/cliente aprobados (dos
nuevos cliente); compilación scoped/común y tipado web aprobados. Regresión completa
**587/587** CAP029+contratos, sin skipped. Todos los comandos terminales. Diff check
sin findings usando cr-at-eol para el checkout Windows; advertencias LF/CRLF no
son errores de whitespace. No se realizaron pruebas físicas de navegador/render.

**Pendiente funcional:** entregar/aplicar URLs por port dentro del frame conservando
media y hash base; scheduler/expiry/ACK/cancelación/revocación integrada. Endpoint y
helper NO equivalen a renovación automática operativa. R19–R22/handoff siguen abiertos.
No flags/secrets/migraciones/templates/QA/deploy ni módulos reservados modificados.

## Corte controlador de vigencia — 2026-10-08

Controlador cliente propio mantiene una consulta activa, margen60s y timer duro de
expiración independiente. Parte del manifest inicial validado, verifica sesión,
bundle/inventario y conjunto exacto de aliases. Rechaza replay/timestamps no crecientes,
clock rollback y retroceso monotónico. Solo instala nueva vigencia DESPUÉS de que
apply confirme aplicación en frame; HTTP exitoso no cuenta. Caducidad aborta consultas
o apply atascados, callback tardío no revive estado. Fallo/revocación/owner drift
cierran una vez sin retry; dispose externo aborta y suprime callbacks tardíos.

Seis tests con relojes controlados verifican confirmación antes de ampliar vigencia,
no concurrencia/segundo ciclo, apply atascado/ACK tardío, owner/revocación/drift/alias
omitido/replay/rollback, aborto de consulta, fallo apply/guard e inicial inválido/
expirado/preabort. Compile scoped/común y tipado web pasan; regresión preview **85/85**,
CAP029+contratos **593/593**, sin skipped. No browser ni render/HTTP/SQL reales.

No monta scheduler en NativeCompositionPreview hasta tener adapter de aplicación
real por puerto y manifest inicial del frame. No se ofrece refresh mediante reload
que pierda visual patches o timeline. Quedan aplicación DOM/media preservando estado,
integración host/runtime, evidencia long-play/seek y auditoría R19–R22/handoff. No QA,
flags/migraciones/despliegue ni cambios a módulos reservados del compañero.

## Corte transporte privado de recursos — 2026-10-08

Paquetes propios RESOURCE_STATE(frame→host)/RESOURCE_UPDATE(host→frame) opt-in,
rechazados por canales anteriores sin permiso explícito. No se modifica protocolo
preview común. Contrato de sesión extraído a módulo propio con reexports compatibles
para evitar ciclo channel→wire→renewal→channel. BEGIN contiene metadata/count,
BATCH máximo4resources, COMMIT confirma onCommit awaited. Límites512/2MiB/48KiB,
envelope64KiB preservado; cadencia50ms y stop-and-wait, sin retry. Receptor no aplica
durante staging; valida orden, alias, URL, sesión, bundle/inventario, timestamps;
timeout15s/cancelación limpian y abortan, copia privada resiste mutación del callback.

Seis tests nuevos incluyen inventario512en130mensajes, presupuesto combinado,
sesión interior, chunks incompletos/gaps/replay/alias/duplicados, timeout/abort,
puertos reales y ACK retenido hasta aplicación, dirección/opt-out y abort pending.
Primer intento detectó .omit sobre schema con refinements de Zod; se deriva shape
strict y se conserva verificación completa en receptor, sin retirar invariantes.
Build runtime381975bytes/114inputs, compile scoped/común y tipado web pasan.
Regresión preview **91/91**, sin skipped. No browser/renderer/SQL/QA físicos.
Regresión conjunta final **599/599** CAP029+contratos, sin skipped. Comandos
terminales; diff check sin findings salvo avisos LF/CRLF del checkout Windows.

**No integración completa todavía:** host/runtime siguen opt-out hasta conectar
manifest inicial, serialización con colas existentes y aplicación DOM/media real.
No afirmar renovación visible por aprobar transferencia con callback de prueba.
CAP029 parcial; catálogo/CAP022/025/027/trackers/flags/migraciones/deploy preservados.

## Corte renovación conectada host/runtime — 2026-10-08

Emisor inserta manifest inicial como script CSP-hashed antes del controller.
Runtime envía RESOURCE_STATE por cola propia; host monta receptor y controlador
de vigencia. RESOURCE_UPDATE comparte exclusividad/cadencia con comandos existentes;
no busy paralelo ni retry. COMMIT del frame espera aplicación efectiva de URLs,
no readiness audiovisual. Señal validada de recursos acredita runtime vivo, sin
marcar READY ni dejar que manifest grande dispare handshake legacy5s. Sesión/hash
compilados preservados. Saved HTML y baseline usan esta integración; no presets/
agentes/renderer/core/protocol/CAP022/025/027/catálogo ni trackers globales editados.

Updater de frame preflight DOM/attrs/CSSOM antes de escribir, con presupuestos
50knodos/16krules/131kproperties. Comparte lexer CSSurl con emisor, sin reemplazo
global ni innerHTML/script/style-text. Preserva prioridades y namespaces SVG;
media src/source cambian y load una vez. Error parcial terminal: no rollback a
capabilities expiradas. Native blankea frame ante fallo seguro. Runtime mantiene
hard expiry propio, aborta listeners/pending y pausa controller al cerrar.

Runtime reutiliza pause/seek/play originales conservando posición e intención,
incluido buffering; no nuevo reloj ni bypass readiness. Al llegar loadedmetadata
resincroniza intención ACTUAL, respetando seek posterior del usuario. Listeners
anteriores cancelados por nueva renovación/dispose. URLs en módulo puro con
reexports compatibles evitan ciclo host→controller→client→host.

Siete tests nuevos: tres updater DOM/CSSOM fixtures (sinks/fuentes/text/script,
preflight sin writes/expiry/identidad/límites y fail terminal), cuatro integración
host/runtime por puertos REALES y reloj controlado: playing/paused/buffering en
dos ciclos, caducidad original superada, revocación sin renovación/retry y metadata
tardía después de seek. Test emisor verifica bootstrap exacto y hash CSP real.
Build391059bytes/117inputs. No browser/decodificación/HTTP/SQL/render físicos.

Esto sustituye pendientes de scheduler/transporte/aplicación EN CÓDIGO de cortes
anteriores, no acredita continuidad perceptual ni aceptación de QA. CAP029 parcial
por auditoría integral R19–R22 y handoff; prerrequisitos de ambiente y QA pendientes.
No flags/keys/migraciones/templates/deploy activados. Resultados finales abajo.

Revalidación final: **98/98** preview y **606/606** CAP029+contratos, sin skipped;
compile scoped/común y tipado web finales aprobados, todos los comandos terminales.
Diff check sin findings salvo avisos LF/CRLF. No QA ni aceptación browser/renderer.
Riesgo operativo explícito: cada renovación verifica portfolio y recarga recursos;
latencia, buffering, Range requests, cuotas bajo carga y fuentes requieren medición
real. No afirmar reproducción imperceptiblemente continua por una simulación.

## Corte R19 — instrumentación legada offline y auditoría inicial (2026-10-08)

La inspección directa de bootstrap/compiler confirmó una brecha, no únicamente
QA pendiente: el bootstrap admitía plantillas con IDs ya declarados, sin producir
el candidato legado previsto por el roadmap §4/Fase 4. Se añadió
`html-editing/html-editing-legacy-instrumentation.server.ts` y su suite propia.

`prepareLegacyHtmlEditingPilot` es authoring offline, sin HTTP/Storage/DB ni UI de
catálogo. Recibe fuente, namespace/version y ancla/inventario independientes del
host; devuelve `REVIEW_REQUIRED`, original byte-exacto con SHA, candidato separado
con SHA, template V1 y targets con paths semánticos para revisión. Conserva IDs
existentes compatibles, nunca renombra referencias; IDs nuevos usan hash del
namespace + tag/role/ancestros/ocurrencia entre hermanos equivalentes, no nth-child
global. Calcula todos los paths antes de mutar el DOM. Insertar un hermano de otro
tipo no desplaza IDs; reordenar hermanos anónimos equivalentes exige nueva revisión
humana/versionado. Rechaza duplicados, colisiones y fuente ya instrumentada.

Descubre texto hoja de tags editoriales e imágenes cuyo src corresponde a un asset
local suministrado por el host. No aplana contenido mixto, convierte URLs, descarga
recursos ni deduce grants. Texto original respeta contrato de valores; fuentes
sin candidatos y exceso de targets fallan explícitamente, sin truncamiento. Reutiliza
bootstrap/compilador para validar el candidato completo: scripts/handlers/SVG activo,
recursos ajenos/revocados, complejidad y defaults. Fuente original queda como rollback.

**No instala ni migra un DECK guardado.** La serialización y añadir IDs pueden
afectar CSS basado en atributos/selectores; compilación determinista no prueba
equivalencia visual. Se exigen comparación visual, revisión del manifest/accesibilidad
e instalación autorizada antes de admitir el candidato como template del operador.
El catálogo UX reservado no se modificó. El resultado no otorga autorización de
publicación ni binding nuevo a un documento cuyo source todavía sea el original.

Evidencia: **108/108** tests del módulo HTML, incluidos siete nuevos; compilación
aislada, compilación común, tipado web completo y lint de los dos archivos nuevos
pasan. Regresión ampliada CAP029+contratos ejecutada con salida dot: exit 0;
no se atribuye aquí un conteo nuevo a ese reporter. Todos los procesos terminales.
Casos nuevos comprueban
determinismo/rollback, estabilidad y unicidad de IDs, preservación de subárboles,
grants independientes, contenido activo, límites sin truncar y bootstrap→edición→
restore con salida exacta. Cheerio/crypto/compilador/reducer reales, no navegador,
SQL, codecs ni instalación piloto. No se ejecutó QA formal ni se activaron flags,
migraciones, templates o despliegues.

### Hallazgos que dirigen el siguiente cierre (no aceptación final)

| Requisito | Evidencia inspeccionada | Trabajo aún no acreditado |
| --- | --- | --- |
| R19 | Bootstrap exige source/template SHA exactos; nuevo instrumentador produce original/candidato separado con declaración validada | Inventario/revisión/instalación piloto y provenance sanitizer/renderer a través de todo el ciclo. No confundir el helper offline con migración aplicada |
| R20 | Manifest declara las ocho familias de operación; state/compiler conservan un campo por elementId en V1 | Resolver cobertura de varias propiedades del mismo nodo frente al contrato original antes de declarar cierre; no ampliar unilateralmente política CAP025 |
| R21 | Parser limita bytes/nodos/CSS y relojes; CSP empaquetado y canal privado presentes | Reglas de geometría/contención y scoping de CSS aún no demostradas integralmente. El parser estático inspeccionado no limita valores arbitrarios de position/size; las clases deck-scope del wrapper no prueban aislamiento de selectores |
| R22 | `compileCompositionHtmlEditingFragments` verifica pointers exactos y source; compiler común se usa para ambos targets y rechaza IDs duplicados de página | Auditar consumidores congelados y estados de UI; salida común de fragmentos no equivale a paridad browser/render ni a handoff QA completo |

Esta tabla identifica brechas concretas tras inspección de fuentes; no constituye
auditoría exhaustiva ni nuevos requisitos externos al roadmap. Los trackers
globales y módulos reservados CAP022/025/027 no se editaron en este corte.

## Corte R21 — geometría declarativa y aislamiento CSS en compilación (2026-10-08)

Se añadieron `html-editing-geometry.server.ts` e
`html-editing-isolation.server.ts`, con suites independientes. El parser estático
invoca geometría antes de admitir fuente o salida; el compilador común invoca
aislamiento después de aplicar overrides. No hay ruta alternativa preview/render,
mutación de source, cambio del documento nativo ni escritura de revisions por este
paso. No se tocaron compiler/protocol compartidos, módulos CAP027 ni catálogo UX.

Geometría: dimensiones CSS estáticas conocidas hasta 8192px, 1000% y 128em/rem;
font-size requiere px hasta 512 para evitar amplificación por anidamiento, y
line-height queda acotado. Se admiten shorthands de longitudes/radios y tamaños
intrínsecos definidos. Posición static/relative/absolute; fixed/sticky y transforms/
perspective/backdrop del source se rechazan, no se eliminan ni claman. Movimiento
debe continuar en el evaluator nativo. Las propiedades geométricas cubiertas no
admiten calc/var/env, unidades viewport o keywords de herencia; font shorthand
requiere adaptación a longhands. SVG viewBox/coordenadas/dimensiones conocidas se
validan independientemente, manteniendo atributos originales sin reescritura.

**Límite de esta admisión:** no es un intérprete completo de CSS ni mide layout
computado. No acredita presupuesto de raster/GPU para todos los filtros/shadows,
paths/transforms SVG, tamaños intrínsecos ni estilos heredados del resto de página.
Los presupuestos de medios/fuentes y límites OS del renderer siguen siendo
independientes. No declarar control completo de abuso geométrico solo por estos
predicados; completar auditoría de sinks restantes y evidencia de ambiente.

Scoping: cada rama de selector se deriva como `:where(scope) :is(subject)`;
before/after/first-line/first-letter/marker soportados quedan fuera de :is para
preservar semántica de pseudo-elemento. Comas dentro de funciones las separa
PostCSS, no split manual. Scope SHA depende de org/draft/clip/template/version/
source. No se prefijan IDs ni se rompen referencias SVG. Layer names y statements
de orden se namespacen, también at-rules con mayúsculas; las capas anidadas,
document-root selectors, :scope, nesting y pseudo-elementos no soportados se
rechazan explícitamente para revisión de plantilla, sin perder reglas en silencio.

El wrapper derivado establece position/width/height, contain layout/paint/style,
isolation y overflow:hidden con prioridad important. Las reglas del source solo
seleccionan descendientes, no ese wrapper protegido; marcador de scope importado
se rechaza. Se vuelven a comprobar bytes/nodos/CSS y recursos de toda la salida,
incluyendo costes de wrappers y selectores derivados. CSP/renewal ya operan sobre
esa salida final. Runtime reconstruido: **391059 bytes, 117 inputs fijados**.

Compatibilidad: cambia el output derivado y su SHA, no el source ni el digest de
revision editorial. Templates con CSS antes admitido pero ahora no demostrable se
rechazan de forma segura. Snapshots que fijen compiled SHA anterior deben seguir
su procedimiento versionado; no se activa fallback ni se presume que un rollout
sea compatible sin reconciliar renderer/sanitizer/provenance y gates.

Pruebas nuevas: cuatro de geometría y seis de aislamiento. Usan Cheerio/PostCSS,
crypto y compilador reales para comprobar todas las ramas, funciones con comas,
dos clips+host, contención emitida, pseudo-elementos, namespace/order, spoofing,
fuente/hash inmutables, límites CSS/SVG y fallos explícitos. No prueban cascada
computada, paint, clipping efectivo ni browser/SDK/FFmpeg reales. Regresión inicial
**623/623**, sin skipped, reejecutada tras ampliar límites font/line-height;
**118/118** del módulo HTML reejecutadas tras centralizar la constante de line-height.
Compilación común y aislada, tipado web y lint dirigido pasan; todos los procesos
terminales. Diff-check sin findings de whitespace, solo avisos LF/CRLF.

Este corte sustituye la ausencia de scoping/contención EN CÓDIGO identificada en
la tabla anterior, no toda la auditoría R21 ni la aceptación visual del tester.
R19 (instalación piloto/provenance), R20 (cobertura multifield), R21 (sinks restantes
y entorno) y R22/handoff continúan parciales. Sin migraciones/flags/templates/deploy.

## Corte R22 — perfil y salida congelada de compilación (2026-10-08)

Auditoría del bundle mostró que V1 congelaba revisiones/source, pero rederivaba el
fragmento sin identificar las reglas de compilación ni fijar su output SHA. La
misma revision editorial podía producir una salida distinta al actualizar el
compilador. Se incorporó `html-editing-compilation-profile.ts`, independiente de
la revisión de contenido, y se centralizó en él la versión de aislamiento.

El emisor ahora produce `courseforge-html-editable-snapshot-bundle-v2`, schema2,
con perfil compiler/geometry/isolation y SHA256 por clip del fragmento realmente
compilado. Perfil y pins participan en los bytes canónicos/hash del bundle; no
guardan grants, URL de entrega, tokens o permisos. El restore autorizado y el
verificador de contenido offline comparan perfil exacto y salida recompilada
para todos los clips; el verificador offline sigue sin otorgar acceso. Compiler
targets preview/render consumen ese restore común antes de producir página.

V1 se rechaza explícitamente con `COMPILATION_VERSION_MISMATCH`, nunca upgrade
silencioso; output drift con perfil idéntico falla `COMPILATION_OUTPUT_MISMATCH`.
Estas comprobaciones no reemplazan el SHA externo confiable, pointers nativos,
autorización actual ni verificación de media/fonts. Un atacante que cambie todos
los bytes/pins necesita igualmente sustituir la identidad congelada confiable.

**Compatibilidad operativa pendiente:** conservar archives V1 y sus receipts;
no sobrescribir Storage ni publicar un nuevo snapshot como recuperación implícita.
Antes de habilitar V2 inventariar snapshots instalados. Si existen V1 que deban
seguir renderizando, hace falta un ejecutor legado fijado y autorizado o una nueva
publicación explícita con comparación/revisión; no afirmar que este rechazo
cumple por sí solo el requisito de continuidad de render histórico. No se aplica
migración, cambia el formato de la revisión editorial, borra source, altera CAS ni
modifica worker CAP027. El archivo interno mantiene `html-editing-revisions.json`;
el descriptor de archive sigue fijando sus bytes completos.

Pruebas dirigidas iniciales 14/14, con cuatro casos nuevos: V1, todos los campos
de perfil, digest/clip pins alterados con checksum válido, descriptors ausentes/
duplicados/ajenos. Prueba adicional en ambos targets reales del compiler añadida;
regresión final **628/628**, sin skipped; compilación común, tipado web y lint
dirigido pasan. Todos los procesos terminales; diff-check sin findings de
whitespace, solo avisos LF/CRLF. Cheerio/crypto/compiler reales, autoridad y
repositorio de fixtures: no SQL, navegador ni renderer físico. No QA formal ni
activación de flags/templates/deploy. Resultados finales consultados directamente,
no presumidos a partir del historial.

Este corte hace explícito un gate de compatibilidad del snapshot congelado; no
resuelve todavía provenance de revisiones live/templates, geometría completa,
multifield ni el handoff global QA. CAP029 permanece parcial.

## Corte R21 — sinks de efectos y presentación SVG (2026-10-08)

Inspección de `html-editing-geometry.server.ts` y el renderer SVG existente reveló
vías no cubiertas por las longitudes CSS previas: stroke/font por atributo, paths
con números no finitos, transformaciones SVG y efectos con radios arbitrarios.
Se ampliaron los predicados del mismo parser común, sin nuevos renderers ni cambios
en charts/source/documento/DB. El perfil geométrico ahora es
`courseforge-html-static-geometry-v2`: snapshots con reglas V1 no se reinterpretan
como V2 bajo el mismo pin.

Filtro CSS o presentación SVG: none, referencia interna sujeta a policy de recursos,
o un blur px finito hasta128. Filter chains/vars/funciones ajenas y sombras CSS no
triviales requieren adapter tipado; no se eliminan ni claman en silencio. SVG
stroke/font/espaciados pasan por límites declarativos; d/points/dasharray acotan
cantidad numérica4096 y magnitud8192/rechazan no finitos. No se anuncia un parser
completo de path SVG: la sintaxis efectiva y raster siguen obligaciones distintas.

Transforms SVG permiten hasta ocho translate/scale/rotate con aridad y números
finitos acotados; rotate de la gráfica donut existente continúa admitida.
Matrices/skew/funciones/colillas inesperadas se rechazan; un valor individual
bounded no prueba la magnitud compuesta de transformaciones anidadas. Ésta y los
otros sinks CSS/shorthands aún no auditados siguen brechas explícitas, no solo QA.
Clip paint containment no sustituye cuotas de memoria/CPU/raster del ejecutor.

Tres tests nuevos cubren efectos/atributos, transforms preservados y malformed,
path/point numeric budget, y bypass inline/presentación; regresión inicial
**631/631** aprobada y reejecutada tras comprobar filtro como atributo SVG;
compilación común, tipado web completo y lint dirigido pasan. Todos los procesos
terminales. Diff-check sin findings de whitespace, solo avisos LF/CRLF.
Compilador/PostCSS/Cheerio reales, no navegador/SDK/FFmpeg ni QA formal. Sin flags,
migraciones, instalación de templates, deploy o cambios a CAP022/025/027/catálogo.

## Corte R21 — presupuesto acumulado de transformaciones SVG (2026-10-08)

Se cerró la vía específica scale/translate acumulados identificada en el corte
anterior. `html-editing-geometry.server.ts` deriva un envelope conservador con
factor de escala y radio de traslación para cada lista admitida; el recorrido
iterativo del parser propaga ese presupuesto por ancestros hasta los descendientes,
también a través de SVG anidados, sin compartirlo entre hermanos. Escala acumulada
máxima16 y radio de traslación8192, sin no-finitos. Rotación tiene norma1 y giro
con centro incorpora hasta dos veces su radio. Gradient/pattern transforms se
comprueban contra el presupuesto acumulado sin alterar el de otros nodos.

No resta cancelaciones ni usa shrink para recuperar presupuesto: puede rechazar
fuentes que una matriz exacta dejaría dentro del área, pero no acepta una cancelación
como excusa para superar los límites intermedios. No se reescribe ninguna lista
SVG, se elimina movimiento ni se añade otro evaluator. Preserva la rotación donut
del renderer existente. Perfil geométrico pasa a V3, por lo que snapshots V2 de
reglas anteriores fallan el pin en vez de reinterpretarse con reglas nuevas.

Dos tests nuevos comprueban listas y grupos anidados, desplazamiento amplificado,
SVG anidado, hermanos independientes, cancelación/shrink y gradientTransform.
Regresión ampliada final **633/633**, sin skipped; compilación común, tipado web
completo y lint dirigido aprobados. Todos los procesos terminales.

**Alcance preciso:** esto verifica el envelope de transformaciones declaradas,
no las matrices implícitas viewBox→viewport, longitud real de paths relativos,
layout computado, filtros/raster GPU ni todas las propiedades CSS. No se convierte
R21 entero en completado ni se sustituye QA browser/render por números finitos.
Sigue pendiente auditar esos sinks y contratos restantes R19/R20/R22/handoff.
Sin cambios CAP022/025/027/catálogo/SQL ni flags/plantillas/deploy activados.

## Corte R20 — varios campos declarados sobre un mismo nodo (2026-10-08)

Se sustituyó la limitación «un campo por DOM ID» de los cortes anteriores por una
declaración aditiva `targetElementId` opcional. `elementId` sigue siendo identidad
estable de campo/operación/state; sin target explícito conserva el destino anterior
y los bytes canónicos existentes. Target solo procede del manifest del template
autorizado y participa en su digest; COMMAND no acepta selectors/target del cliente.
No se reescriben manifests históricos ni se registran templates nuevos.

Compiler e inspector resuelven el nodo físico desde la declaración. Marcador DOM
mantiene el ID físico único, mientras state/defaults/staging/reducer/history siguen
keyed por campo. Una cabecera puede declarar texto, font-size, opacity, title y
visibilidad sin que una actualización sobrescriba las otras. Guardado sigue siendo
un lote editorial/CAS; restore reconstruye desde fuente con todas las propiedades,
sin otro journal. UI existente recorre campos declarados y conserva keys únicas.

Manifest rechaza conflictos por sink físico: doble texto/chart sobre mismo nodo,
dos atributos con el mismo nombre, dos rangos para la misma propiedad CSS y texto
con locale contra atributos lang/dir. Dos atributos distintos o dos rangos de
propiedad distinta se admiten. Defaults/chart/slots/source y resource policy se
validan como antes; chart no puede sustituir otro target declarado en su subárbol.
Los límites200/50 se mantienen por campos/operaciones, no se amplían por este corte.

Reset por propiedad y `ALL` continúan referidos al campo declarado, no a todos los
campos del nodo físico. Para reset del conjunto hay que preparar los campos en un
lote explícito; falta revisar affordance/semántica de reset conjunto contra OP028
antes de declarar cierre integral. No exponer «ALL» como borrado general del DOM.

Cuatro tests nuevos verifican multi-property/state independiente, reset puntual,
visibilidad sin borrar texto, defaults del inspector y undo exacto, conflictos,
campo desconocido, nodo ausente y target del cliente rechazado. Pruebas usan
compiler/reducer/inspector/Cheerio reales, no montaje React/SQL/auth HTTP/render.
Compilación común, tipado web y lint dirigido aprobados. Regresión final
**637/637**, sin skipped, y cuatro tests multifield dirigidos aprobados. La primera
regresión rechazó pins desactualizados del runtime empaquetado: se reconstruyó
explícitamente (**391487 bytes/117 inputs fijados**) y se repitió la suite completa
con resultado verde; no se presenta la ejecución anterior como éxito. Todos los
procesos terminales; diff-check sin findings salvo avisos LF/CRLF.
Catálogo reservado, política CAP025, CAP022/027, SQL y trackers globales intactos.
Sin activación de flags/templates/migraciones/deploy ni QA formal.

## Corte R20 / OP028 — reset conjunto de nodo en staging/UI (2026-10-08)

`stageHtmlEditingTargetReset` agrupa campos del target autorizado del inspector y
prepara un solo lote de RESET tipados por campo. Reemplaza intentos locales de ese
nodo, conserva los de otros nodos y ordena por manifest; no crea selector en el
payload, segundo journal ni dispatch. Validación previa y de todo el resultado
incluye defaults de imágenes/grants y límites count/bytes: fallo rechaza el lote
entero sin mutar el draft anterior, nunca truncar ni guardar la parte permitida.

UI `CompositionHtmlEditableFields` ofrece «Preparar original del elemento» para
targets con múltiples campos, enumera sus labels y explica que únicamente Guardar
lote publica. Respeta busy/submitting, conserva reset individual y descartar local.
El backend recibe COMMAND ordinario de RESETs y mantiene CAS/historial/reauthorización
actual del resultado; no nuevo permiso ni ruta especial de reset. El meaning de
`RESET ALL` por field no cambia para clientes existentes. Esto sustituye el pendiente
de affordance/reset conjunto identificado en el corte anterior, no todo R20/QA.

Tres pruebas nuevas de staging verifican reemplazo/idempotencia/retención de otros
campos, sin target/authority en payload, imagen default revocada, unknown node y
lote excedido sin truncar ni mutar. Una prueba nueva de compiler/reducer aplica
el lote de resets sobre multifield, exige salida completa exactamente original y
versión creciente; target ajeno tardío no produce aplicación parcial. No montaje
React/foco/browser, SQL o sesión HTTP; esas validaciones permanecen para el tester.
Regresión final **641/641**, sin skipped; compilación común, tipado web completo
y lint dirigido pasan. Todos los procesos terminales; diff-check sin findings
salvo avisos LF/CRLF. Sin cambios a
CAP022/025/027/catálogo reservado/trackers, migraciones/flags/templates/deploy.

## Corte — expediente QA y puerta de implementación integral (2026-10-08)

Se creó `SOFLIA_ENGINE_CAP029_QA_HANDOFF.md` tras inspeccionar rutas HTML existentes,
gates/client flags, configuración independiente de operador y SQL relacionado.
Reúne19 casos funcionales/recuperación y11 sandbox/recursos, regresiones/paridad/
accesibilidad, evidencia segura y comandos técnicos reproducibles. Conserva el
último resultado641/641 como histórico, no suite nueva ejecutada para documentación.
Diff-check del expediente sin findings, salvo aviso LF/CRLF.

Separa I01–I05 (integración piloto/provenance, geometría implícita, continuidad V1,
consumers soportados y catálogo reservado) de A01/A02 (ambiente autorizado) y Q01
(tester). No convierte ausencia de instalación o entrega externa en aceptación
implícita ni genera nuevos CAPs. Read-only de rutas y docs propios: sin código,
SQL/flags/keys/templates/deploy modificados en este corte, ni comunicación enviada
al compañero. QA formal no ejecutado. Expediente preparado no significa objetivo
completo: las brechas funcionales siguen vigentes y deben cerrarse por evidencia.

## Corte I04 — consumidores y protección del preview histórico (2026-10-08)

Auditoría de las llamadas y selección de URL actuales; no acredita ejecución browser:

| Consumidor | Integración observada | Pendiente / límite |
| --- | --- | --- |
| Saved HTML | `NativeCompositionPreview` selecciona URL dedicada con hash/session y host privado | QA browser y autoridad real |
| Baseline de comparación HTML | Selección dedicada por hash y flag HTML fijados al capturar baseline | QA browser/paridad real |
| Preview genérico de draft | Compila con hash, pero sin contexto HTML; compiler rechaza refs editables sin fallback | No es sustituto del canal HTML dedicado |
| Preset application preview | Compila documento propuesto sin contexto/hash HTML exactos | Integración HTML pendiente; no cambiar silenciosamente a source |
| Agent proposal preview | Misma ausencia de contexto; rechazo del compiler | CAP025 reservado; contrato/wiring requieren acuerdo |
| Frozen snapshot / referencia / render | Bundle y fragmentos derivados fijados, compilación común con authority recheck | Compatibilidad V1 y ejecución física siguen pendientes |
| Preview histórico por revisionId | Leía `preview_html` bajo CSP legacy sin distinguir snapshots HTML | Ahora rechaza marcadores HTML; delivery autorizado histórico aún pendiente |

Se extrajo política pura `readLegacyRevisionPreview` y se conectó exclusivamente
a la ruta `revisions/[revisionId]/preview`, después de auth/rol/tenant y lectura
scoped. Marcador `html_editing_snapshot` o
`conformance_reference.htmlEditingSnapshot`, incluso null/incompleto/malformado,
produce 422 no retryable antes de servir HTML. Legacy sin esos marcadores conserva
bytes y límite anterior; no se inspecciona el contenido como sustituto de metadata.
Ausencia de ambos marcadores no demuestra autenticidad ni verifica bytes del ZIP.
No se alteran registros ni se reconstruyen snapshots o grants desde preview_html.

Cinco tests nuevos validan ambos marcadores, downgrade por metadata incompleta,
prioridad sobre preview ausente, ausencia de mutación y compatibilidad/límites legacy.
Regresión CAP029/contratos **646/646**, cero skipped; compilación común de tests,
tipado web completo y lint dirigido pasan. No test HTTP autenticado, navegador,
RLS/SQL, Storage ni renderer real. I04 sigue parcial: esta protección elimina una
ruta legacy indebida, no entrega preview seguro de revisiones históricas ni habilita
presets/agentes. No módulos CAP022/025/027, catálogo, trackers globales,
migraciones, flags o deploy modificados.

## Corte I02 — gramática y coordenadas acumuladas SVG (2026-10-08)

`html-editing-svg-path.server.ts` valida d mediante gramática cerrada
M/L/H/V/C/S/Q/T/A/Z absoluta/relativa, moveto inicial, grupos completos,
flags explícitos0/1 y presupuestos independientes de4096 números y4096 comandos.
Comprueba cursor acumulado/subpath/lineto implícito, hull de controles Bezier y
reflejos S/T. Closepath restaura inicio; otras familias reinician reflexión.
No modifica los bytes del atributo. CSS d:path(...) se rechaza para impedir
reemplazar geometría validada; d:none permanece admitido.

Arcos usan corrección de radios cotejada con [SVG2 B.2.5](https://www.w3.org/TR/SVG/implnote.html#ArcCorrectionOutOfRangeRadii)
y una envolvente conservadora de diámetro respecto de extremos. Cero radio es
línea; extremos coincidentes no generan arco. Radios negativos y flags compactos
se rechazan en este subset, no se normaliza/repara source ni se promete SVG general.

Perfil `courseforge-html-static-geometry-v4`: bundlesV2 con perfiles previos se
rechazan por mismatch; no recompilación silenciosa. I03 incluye perfiles anteriores
además de V1 y exige inventario autorizado/ejecutor fijado o republicación revisada.
Source y revisiones editoriales permanecen intactos; no se ejecutó migración.

Siete pruebas nuevas: source preservado, gramática inválida, desplazamientos/control
reflejado excesivos, reinicio subpath, radios corregidos/subnormales, límites exactos
y evasión CSS. Regresión final **653/653**, cero skipped; compilación común,
tipado web completo y lint dirigido pasan. Runtime391487bytes/117 inputs fijados.
No browser/HTTP/RLS/Storage/renderer real. I02 sigue parcial: viewBox→viewport,
coordenadas transformadas/layout y sinks restantes no quedan acreditados por parser.
Sin módulos reservados CAP022/025/027/catálogo, flags, SQL o deploy modificados.

## Corte I02 — mapeo de viewport SVG explícito (2026-10-08)

`html-editing-svg-viewport.server.ts` implementa la transformación de atributos
según [SVG2 §8.2](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform):
viewBox/origen, ancho/alto unitless o px, preserveAspectRatio none o nueve
alineaciones con meet/slice. Calcula envolvente de escala/traslación finita;
se integra en el walker acumulando sobre transforms/viewport ancestros. Atributos
preservados sin normalizar source. Inversas viewBox no finitas, sintaxis de
alineación desconocida y exceso del presupuesto compuesto se rechazan.

Viewport relativo, ausente o no resoluble devuelve null, no identidad comprobada.
En esos casos el walker conserva únicamente presupuesto de transforms authored
ya existente; no acredita mapeo implícito. CSS puede sobrescribir incluso atributos
numéricos: esta comprobación es del mapeo de atributos, NO computed-layout.
I02 permanece abierto por autoridad CSS/viewport efectivo, composición de
coordenadas de formas con ese mapeo y otros sinks geométricos no auditados.
No se rechazan iconos normales de24px por asumir un viewport de8192px.

Perfil geometry-v5; I03 exige continuidad explícita también para perfiles v4/previos.
No cambia source/revisión editorial ni instala nuevos templates. Cinco tests
nuevos cubren modos/alineación, offsets, composición anidada, iconos/charts,
viewport deshabilitado, retornos no probados y overflow/invalidez. Tras corregir
fixtures tipados, compilación común, tipado web completo y lint dirigido pasan;
regresión final **658/658**, cero skipped. Runtime391487bytes/117 inputs fijados.
No browser/renderer/HTTP/RLS reales, QA formal ni flags/SQL/deploy. Áreas reservadas
y trackers globales permanecen intactos.

## Corte I03 — diagnóstico histórico offline utilizable (2026-10-08)

Se añadió `diagnoseCompositionHtmlEditingSnapshotCompatibility` reutilizando
decodificación/pins/schema del bundle, sin modificar las reglas de restore.
Clasifica V1 estricto, V2 con perfil distinto y perfil actual; rechaza malformed,
SHA/scope/document hash ajenos. Solo reporta claves de perfil distintas/count,
no source/permisos/URLs. Perfil actual sigue exigiendo verificación de contenido,
native pointers y autoridad vigente; nunca retorna permiso de ejecutar/migrar.

Herramienta local y [procedimiento](../../apps/web/tools/html-preview/SNAPSHOT_COMPATIBILITY.md):
archivo absoluto regular/no symlink,16MiB máximo, lectura FD acotada con rechecks
y SHA de bytes brutos; scope/pins independientes obligatorios. Sin network/DB,
ZIP extraction, escrituras o upgrade. Usa build local explícito del inspector;
no afirmar frescura de un build anterior. No inventario real inspeccionado todavía.

Cuatro tests de dominio nuevos y cinco de herramienta con filesystem/bytes y
CLI Node reales pasan. Regresión principal **662/662**, herramientas **5/5**,
sin skipped; compilación común, tipado web completo y lint dirigido pasan.
Runtime391487bytes/117 inputs fijados. Temporales exclusivos de pruebas eliminados;
ningún snapshot del usuario modificado. No QA formal, HTTP/RLS/DB/Storage/render
reales. I03 sigue parcial: requiere inventario autorizado exhaustivo y continuidad
resuelta por ejecutor histórico fijado o republicación revisada, no clasificación
sola. No áreas reservadas, trackers, SQL/flags/templates/deploy modificados.

## Corte I01 — procedencia y revalidación del paquete piloto (2026-10-08)

El instrumentador ahora incluye provenanceV1: native anchor exacto,
instrumentationVersion, perfil de compilación, hashes original/candidato/template/
mapa de targets/fragment compilado y digest canónico del descriptor. No guarda
grants, URLs temporales ni permiso de instalación. La fuente original sigue
byte-exacta; IDs y template sin cambios por añadir esta metadata.

`verifyLegacyHtmlEditingPilotPackage` reproduce el candidato con original/contexto
y permisos actuales suministrados independientemente, y compara el paquete completo
por igualdad estricta. Pin de provenance esperado debe venir del registro de
preparación, no de las afirmaciones del paquete recibido. Campos extra, cambios de
source/template/targets/reviews/perfil/native identity y revocación se rechazan.
Retorna una copia regenerada REVIEW_REQUIRED: no aprobación humana ni instalación.
Paquetes anteriores sin descriptor no se convierten automáticamente.

Presupuestos propios: paquete2MiB, path semántico16KiB, mapa acumulado512KiB. Los
IDs repetidos de ancestros no pueden amplificar ilimitadamente el paquete; exceso
se rechaza sin truncar. Seis pruebas nuevas cubren procedencia, copias/inputs intactos,
sustitución de todas las partes, drift independiente, grants actuales y presupuestos.
No consumer HTTP/UI/installer montado: búsqueda de usos encuentra funciones/tests
offline únicamente. I01 sigue parcial por circuito piloto autorizado y adopción
nativa transaccional. Catálogo UX del compañero no se implementa aquí.

Validación final **668/668**, cero skipped; compilación común, tipado web completo
y lint dirigido pasan. Runtime391487bytes/117 inputs fijados. Errores iniciales de
readonly/unknown en serialización fueron corregidos sin ampliar el canonicalizador
compartido: se compara el paquete por igualdad estricta y solo se canonicalizan
descriptores tipados. No HTTP/DB/Storage/browser/render/QA formal, instalación,
flags/migraciones/deploy ni cambios a áreas reservadas o trackers globales.

## Corte I01 — propuesta nativa de adopción y límite de integración (2026-10-08)

Relectura confirma que inicialización existente exige source nativo exacto y no
adopta el candidato instrumentado. Se añadió plan puro
`prepareHtmlEditingLegacyAdoption`: verifica base/clip/pilot/grants y catálogo
independiente, prepara revisión inicial y nueva versión nativa enlazada sin escribir
ni mutar original. Otros clips/layout/canvas permanecen iguales; template con
declaraciones distintas se rechaza aunque tenga igual source SHA. Ya editable,
base stale o candidato ajeno no devuelve plan aplicable.

[Contrato de integración](SOFLIA_ENGINE_CAP029_LEGACY_ADOPTION_INTEGRATION.md)
documenta por qué se necesita commit atómico native+HTML+receipt/provenance.
No se permite native append seguido de registro en otra petición. La migración y
repositorio/HTTP/UI de commit requieren reserva/acuerdo; no se implementaron ni
aplicaron aquí. I01 sigue parcial, catálogo UX del compañero intacto.

Consulta read-only del chat «Ejecuta investigación del editor» confirma CAP027
activo en AppContainer/aislamiento. No hay evidencia de entrega aceptada de catálogo
UX en esa consulta; no es prueba de estado de todos los paquetes del compañero.
No se enviaron mensajes ni alteraron reservas.

Cuatro tests nuevos de preparación/conflictos/catálogo/grants pasan; regresión
final **672/672**, cero skipped, compilación común/tipado web/lint dirigido pasan.
Runtime391487bytes/117 inputs fijados. No persistencia/RPC/HTTP real, SQL/RLS,
browser/render ni QA formal. Source anterior solo preservado en el argumento y
propuesta: retención histórica durable debe verificarse con el commit futuro.

## Corte I02 — geometría SVG CSS y presentación unificadas (2026-10-08)

Se confirmó una vía de evasión: CSS x/y/cx/cy/r/rx/ry y stroke-width no pasaban
por los límites aplicados a atributos SVG. Ahora exigen un valor individual
finito/acotado, sin var/calc/shorthand ni keywords de cascade; coordenadas admiten
signo y radios/stroke-width no negativos. rx/ry:auto conserva derivación normal.
CSS stroke-dashoffset también usa longitud acotada; array de guiones admite none
o lista cerrada de hasta128 valores no negativos, sin comas vacías/indirección.
stroke-miterlimit numérico1–16. Atributos dasharray/dashoffset/miterlimit usan la
misma validación que inline/stylesheet. No reescritura/clamping del source.

Semántica cotejada con [propiedades geométricas SVG2](https://www.w3.org/TR/SVG2/geometry.html)
y [pintura/trazos SVG2](https://www.w3.org/TR/SVG2/painting.html).
Los límites son política del adaptador, no garantía de paint bounds computados.
Perfil geometry-v6 requiere tratar paquetes/perfiles anteriores por I03, sin
reinterpretación silenciosa. No activación/instalación ni cambios a versionado
editorial inmutable. I02 sigue parcial por unidades relativas/cascade/layout y
composición efectiva del mapeo sobre coordenadas/pintura.

Cuatro tests nuevos incluyen evasión por stylesheet/media/importance, valores
negativos/no finitos, gramática/listas/dashes/miter y source de chart preservado.
La integración transaccional del piloto permanece pendiente de la confirmación
solicitada: no tomar una continuación automática como reserva/permiso de SQL.
CAP022/025/027/catálogo/trackers y persistencia compartida no se modificaron.

Validación final **676/676**, cero skipped, incluye límites exactos admitidos y
exceso rechazado; herramienta offline histórica **5/5** revalidada. Compilación
común de tests/tipado web completo/lint dirigido pasan. Runtime391487bytes/117
inputs fijados. No browser/paint/raster/HTTP/RLS/DB reales, QA formal, SQL/flags/deploy.

## Corte I03 — candidato explícito de republicación histórica (2026-10-08)

`prepareCompositionHtmlEditingSnapshotRepublication` acepta snapshots V1 o V2
con perfil anterior, exclusivamente para preparar revisión. Verifica bytes/scope,
documento nativo y referencias exactas mediante el compilador existente, con
autoridades/grants actuales independientes. Emite un bundle candidato V2 separado
y perfil actual; no cambia fuente, manifest, overrides, versiones ni original.
El contexto de autoridad se comparte con restore, sin duplicar su verificación.

Comparación por clip distingue pin igual, distinto o ausente y reporta pins previos
sin correspondencia. No ejecuta el compilador histórico ni acredita equivalencia
visual. Resultado PREPARED_REPUBLICATION_NOT_COMMITTED exige revisión visual
histórica, contenido/accesibilidad y republicación autorizada. Perfil actual,
contenido sustituido, permisos revocados y native pointers discordantes rechazan.
El restore normal sigue rechazando V1/perfiles antiguos: no bypass ni upgrade.

Cuatro pruebas nuevas cubren determinismo/no mutación, source/state/version
sustituidos, scope/grants/autoridad, comparaciones y esquemas malformados. Regresión
CAP029/contratos **680/680**, cero skipped; CLI offline **5/5**. Compilación común,
tipado web completo y lint dirigido aprobados; diff check solo advierte LF/CRLF.
No ejecución HTTP/DB/browser/render ni QA manual. No áreas reservadas, trackers,
SQL, flags, templates ni deploy modificados.

I03 permanece parcial: no inventario real autorizado ni publicación/recovery
conectados. El candidato no autoriza persistencia o aceptación; I01/adopción
transaccional sigue pendiente de confirmar reserva y numeración de migración.

## Corte I04 — preparación de preview publicada ligada a sus pins (2026-10-08)

PAGE y RESOURCE_RENEWAL admiten `revisionId` UUID opcional junto al hash/generación/
nonce existentes. Después de autenticación/rol/tenant y cuotas, el reader propio
consulta la revisión exacta por id/organización, acota metadata y coteja draft/hash,
ambas referencias de bundle y font manifest digest. No toma hash de publicación,
grants, fuente ni ubicaciones desde el query. Errores no revelan metadata.

El portfolio compara el bundle regenerado con el pin publicado ANTES de descargar
o firmar recursos; exige igualdad completa de bindings de medios y fuentes por
id/familia/path/hash/tamaño/MIME. Relink del mismo UUID o cambio de compilación
rechaza: no se presenta una salida distinta como histórica. Las tres relecturas
del portfolio repiten estos controles, además de autorización vigente/inventario.
URL builder/host/controlador/consulta de renewal preservan `revisionId` cuando el
consumidor lo proporciona. No nueva ruta legacy ni fallback; sigue422 su bloqueo.

Siete tests nuevos: lector tenant/revisión/metadata/grants separados, fallos/aborto/
size, URL histórica, handler PAGE+RENEWAL, portfolio con Storage/sharp/files reales
y cliente renewal. **29/29** dirigidos; regresión CAP029/contratos **687/687**, cero
skipped, CLI offline **5/5**. Compilación conjunta, tipado web y lint dirigidos
aprobados. Runtime391487bytes/117input pins revalidado. No servidor HTTP/DB/RLS/
browser/render reales ni QA formal. Solo módulos HTML propios; UI compartida,
CAP022/025/027/catálogo/trackers/SQL/flags/deploy sin cambios.

I04 permanece parcial: UI de selección/preview publicado aún no pasa revisionId;
requiere reserva/wiring del consumidor compartido y validación integrada. Este
control fija HTML/media/fonts, no acredita identidad de todo el renderer/browser
histórico. I03 sigue requiriendo inventario y republicación explícita o ejecutor
histórico seguro; perfiles incompatibles no se aceptan por agregar revisionId.

## Corte I04 — identidad histórica durante renovaciones integradas (2026-10-08)

Host y controlador validan `revisionId` antes de asignar puertos/timers; un ID
malformado no queda diferido hasta la primera renovación. La configuración
capturada no puede cambiarse desde el objeto original mientras arranca el frame.

Prueba host/runtime ampliada a saved y published, cada uno en playing/paused/
buffering/revoked: MessagePorts reales, dos ciclos de renovación y ACK de aplicación,
retención de posición/intención de reproducción, sin reload de página y cierre
al revocar. Mutar revisionId del caller después de crear host no convierte la
consulta histórica en saved. DOM/media/HTTP y permisos son fixtures, no browser
ni proveedor reales. **21/21** pruebas dirigidas; regresión final CAP029/contratos
**691/691**, cero skipped; compilación/tipado/lint aprobados.

Se solicitó reserva de los bloques HTML de `NativeCompositionPreview.tsx` y
`CompositionComparisonPane.tsx` para wiring publicado. **Pendiente de respuesta
humana**, no aceptación inferida de continuación automática. No se editaron esos
consumidores ni CAP022/025/027/catálogo/trackers/SQL/flags/deploy. I04 sigue abierto;
la integración transaccional de I01 mantiene su confirmación aparte pendiente.

## Corte I02 — motion-path y anchuras shorthand/lógicas (2026-10-08)

Se identificaron sinks que no llegaban a la política geométrica: motion-path
añade transformación aunque CSS transform sea none; border/outline shorthands y
anchuras/radios lógicos podían evitar las comprobaciones del longhand físico.
Ahora offset/motion (también prefijos legacy) solo admite spellings inertes
cerrados. Border/outline admite none/hidden o una anchura px explícita finita
acotada, estilo/color simples sin funciones/variables/keywords indirectos; fuentes
con colores funcionales/variables deben usar longhands aprobados, no normalización
silenciosa. Anchos/radios lógicos y outline-offset pasan por la política existente.

Semántica de transformación cotejada con [W3C Motion Path](https://www.w3.org/TR/motion-1/).
Perfil geometry-v7 distingue esta admisión de v6; snapshots previos requieren el
procedimiento I03, no recompilación silenciosa. Fuente/manifiesto/revision digest
no se cambian ni se clampa geometría. El mismo adaptador admite ambos targets.

Cuatro tests nuevos, inline/stylesheet/media/supports/importance, comentarios,
shorthands ambiguos/indirectos, límites exactos y source soportado sin reescritura.
**36/36** dirigidos geometría/snapshots; regresión CAP029/contratos **695/695**, cero
skipped; herramienta offline **5/5**. Compilación conjunta/tipado web/lint y diff
check aprobados (aviso LF/CRLF del test nuevo). Runtime391487bytes/117input pins.
Sin QA formal/HTTP/DB/browser/render reales ni SQL/flags/deploy/áreas reservadas.

I02 NO cerrado: tamaños relativos/cascade/layout efectivo, pintura/mapeo SVG y
expansión de tracks/columnas CSS requieren política y evidencia adicionales. Se
observó que valores compactos repeat()/column-count pueden solicitar expansión
sin aumentar proporcionalmente el AST; no tratar el presupuesto AST como límite
de tracks/layout. No afirmar contención física ni paridad desde estos tests.
Reservas de UI compartida y adopción transaccional siguen pendientes de respuesta
humana; continuación automática no concede ninguna de ellas.

## Corte I02 — expansión explícita de grid y multicolumn (2026-10-08)

Módulo propio `html-editing-layout-expansion.server.ts` admite gramática cerrada
sin dependencia nueva. Cuenta tracks expandidos de repeat fijo (máximo128 por
declaración), no solo tokens AST; admite listas simples, minmax/fit-content y
nombres de línea acotados (16 por grupo/2048 expandidos), sin repetición anidada,
auto-fill/auto-fit/subgrid ni indirección. Áreas nombradas máximo4096 celdas;
índices/spans numéricos absolutos máximo128 y límites de tokens/identificadores.
Shorthands grid/grid-template solo none; el resto requiere longhands admitidos,
sin reescribir ni quitar declaraciones del source.

Column-count/columns solicitan máximo32 columnas y anchuras px1–8192; column-rule
usa el mismo control de border y grid-gap/row-gap/column-gap conservan longhands
existentes. Prefijos webkit/moz normalizados solo para validación. Política
geometry-v8 distingue esta admisión; I03 aplica a perfiles previos sin upgrade.

Semántica cotejada con [W3C Grid2](https://www.w3.org/TR/css-grid-2/#repeat-notation)
y [W3C Multicol1](https://www.w3.org/TR/css-multicol-1/#column-count).
Estos son límites de declaración solicitada, NO número total de tracks implícitos,
columnas de overflow, fragmentación, layout/paint ni cuotas físicas de ejecución.
La repetición fija/nombres/áreas no recupera presupuesto mediante cancelación.

Cinco tests nuevos: positivos comunes, valores extremos/nonfinite/indirectos,
sumas/multiplicación, placements, áreas/nombres al límite, prefijos/gaps/rules e
inline/stylesheet/media/importance con source conservado. **5/5** dirigidos;
regresión CAP029/contratos **700/700**, cero skipped; CLI offline **5/5**. Compilación
conjunta/tipado web/lint y diff check aprobados (LF/CRLF en archivos nuevos).
Runtime391487bytes/117inputs. No browser/HTTP/DB/render real ni QA formal; módulos
reservados/trackers/SQL/flags/deploy intactos. UI y adopción todavía sin reserva
humana confirmada. I02 sigue parcial por unidades/cascade/intrínsecos/layout y
paint efectivos, fragmentación y límites de ejecución independientes.

## Corte I04 — reserva autorizada y wiring de publicación HTML (2026-10-08)

Usuario autoriza explícitamente reservar los bloques HTML de
NativeCompositionPreview/CompositionComparisonPane y la preparación transaccional
propia, incluida preparación/numeración de migración sin aplicarla. Se registra en
el expediente propio y propuesta de adopción; no cambia reservas del catálogo,
CAP022/025/027 ni append/gateway compartido. No se envían mensajes a otros chats.

Selector puro `composition-html-editing-preview-selection.ts` toma solo revisión
activa con hash exacto del documento mostrado. UI conecta revisionId a PAGE y
lo extrae de la misma URL para host/renewal. Al abrir comparación fija la identidad
del baseline, independiente de cambios posteriores de la publicación o del draft.
Owner se captura por URL de navegación, no por respuesta/load tardío. El pane ya
recibe URL y callback: no requiere modificarlo. Sin publicación coincidente sigue
preview de draft autorizado; un rechazo del servidor no dispara fallback/retry.

Dos tests nuevos de selección y baseline; regresión CAP029/contratos **702/702**,
cero skipped; CLI offline **5/5**. Compilación de tests y tipado web aprobados.
Lint módulos nuevos sin warnings; componente compartido sin errores, advertencias
fuera del wiring señalado (no se refactoriza código ajeno). Diff check aprobado.
No browser/HTTP/DB/render reales ni QA formal, SQL aplicado, flags o deploy.

I04 sigue por auditar en consumers/contextos completos; esta entrega cierra solo
el wiring publicado solicitado. I01 transaccional aún pendiente: reserva aceptada
no equivale a implementación, aprobación del piloto ni instalación en PostgreSQL.
I02/I03/I05 y preparación A01/A02/Q01 no cambian de estado por estos tests.

## Corte I01 — backend transaccional de adopción legado preparado (2026-10-08)

Reserva humana permite módulo/repositorio/handlers/ruta propios y migración sin
aplicar. Request HTTP limita intención a candidato/provenance/base CAS. Digest v1
liga tenant/draft/clip/actor/operación y los tres campos; aprobación privada
independiente exige reviewer/evidencia/tres revisiones, no piloto/hash como permiso.

Repositorio específico relee candidato autorizado/contexto nativo/catálogo/grants,
regenera el piloto y documento/revisión inicial mediante preparación ya existente.
Solo un RPC publica. Recibo histórico y replay no recompilan ni dependen de catálogo
actual; ACK desconocido no dispara retries/registro separado/append compensatorio.

Migración propia `20261008100000_html_editing_legacy_adoption.sql`, número único
en inventario local: candidates/receipts privados con RLS y funciones service-only;
root lock/NOWAIT, actor y reviewer actuales, revocación, original/CAS/grants y
documento/referencia exactos antes de append-v2 existente. Native/audit/template,
revisión inicial y receipt en una transacción; original queda en versión previa.
No se modifica append/gateway compartido. SQL sin aplicar ni prueba de DB real.

Ruta POST/GET propia preparada y deshabilitada por defecto, sesión/tenant/reviewer,
same-origin, cuotas separadas, límites/timeout, errores seguros y receipt exacto.
No ofrece staging/aprobación desde datos HTTP. Gates nuevos documentados en
expediente QA; ningún flag/entorno/catalogue/template/deploy activado.

**19/19** tests nuevos (10 persistencia/contratos/SQL estructural;9 HTTP/policy).
Regresión CAP029/contratos **721/721**, cero skipped; CLI offline **5/5**.
Compilación de tests, tipado web y lint de los ocho módulos/tests/ruta nuevos
aprobados sin warnings; diff check aprobado, avisos LF/CRLF únicamente. No QA
formal/browser/HTTP autenticado/Storage/PostgreSQL/RLS/concurrencia/rollback reales.

I01 sigue parcial: falta revisión/staging operator-owned conectados a aprobación
humana, confirmación/diff, journal anterior al POST, recovery cliente y relectura
native/inspector. I02/I03/I04/I05 y A01/A02/Q01 no quedan cerrados por esta entrega.
Referencia y límites: [integración de adopción](SOFLIA_ENGINE_CAP029_LEGACY_ADOPTION_INTEGRATION.md).

## Orden siguiente

1. Completar revisión/confirmación/journal/recovery cliente de I01 contra backend
   preparado, sin tomar catálogo UX reservado ni activar instalación/flags.
2. Continuar auditoría R21 y consumers I04; resolver compatibilidad I03 con
   publicación histórica explícita revisada y contrato físico CAP027 existente.
3. Integrar únicamente entregas autorizadas del catálogo reservado.
4. Preparar gates y checklist completo para QA manual; marcar cierre solo cuando
   todos los requisitos de implementación tengan evidencia suficiente.
