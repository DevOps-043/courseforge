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
- Panel de seguimiento inicial y catálogo UX HTML autorizado posteriormente aquí.
- Auditoría y cierre incremental del aislamiento HTML y contratos de integración.
- Nota propia de seguimiento para no editar simultáneamente los trackers globales.

No tocar CAP-022 ni los módulos asignados CAP-025. No tocar `composition-editor/qa/**`,
`tools/controlled-hyperframes/**` ni configuración worker de CAP-027. Cualquier
integración que requiera esos módulos debe acordar contrato y archivos primero.

**Autorización posterior del usuario,2026-10-10:** completar aquí únicamente las
integraciones HTML CAP029 de previews de propuestas/presets, comprobación de layout
en el executor CAP027 y catálogo UX HTML no entregado. Esto sustituye la reserva
previa solo para esos puntos, no para política/stores CAP025, CAP022, gates generales
o el resto del worker. Antes de cada cambio delimitar los archivos consumidores y
preservar cambios ajenos; no implica aplicar SQL, activar flags o hacer QA manual.

**Autorización puntual posterior,2026-10-10:** exigir cuotas CPU/memoria existentes
para HTML editable en composition-windows-render-worker-host.ts. Solo ese guard;
no bridge, valores de límites, gates generales, stores CAP025 ni resto del worker.

## Matriz de cierre

Corte vigente I02: geometría usada/texto/SVG normalizado y contención de pintura
conectados al runtime común; CSP conserva hashes exactos. Guard HTML autorizado
conectado antes de prepareLaunch/spawn, sobre documento materializado y cuotas
existentes validadas por el bridge. Tipos/lint,1074/1074 de regresión y24/24 guard/
bridge aprobados, sin skipped. I01–I05 implementados/preparados; no se certifica
browser, contención de kernel ni aceptación productiva por mediciones o conteos.
[Auditoría vigente](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md). Sin SQL/flags/deploy/QA.

[Métrica de implementación necesaria](SOFLIA_ENGINE_CAP029_IMPLEMENTATION_METRIC.md):
línea base inicial70%, corte2026-10-10 **100% de implementación necesaria preparada**, por entregables ponderados; QA/instalación de
ambiente aparte. No derivada del conteo de pruebas ni comparable con CAP027.

| Requisito | Evidencia existente / pendiente real | Estado |
| --- | --- | --- |
| R19: fuente, template/version y assets inmutables; instrumentación legada | Inventario, operador privado/piloto/revisión/registro recuperable, adopción transaccional preparada, diff/confirmación/recovery y auditoría I01 conectados. Piloto autorizado/SQL/ACL y QA reales pendientes en A01/A02/Q01 | Implementado; ambiente/QA pendientes |
| R20: manifest, overrides/tokens, OP-021..028, gateway/OCC/undo | Ocho familias, multifield/reset atómico, inspector→host reservado→HTTP→gateway→repository/CAS/recibos y undo/restauración forward auditados. [Auditoría de consumidores](SOFLIA_ENGINE_CAP029_EDITORIAL_CONSUMERS_AUDIT.md); DB/browser reales aparte | Implementado/preparado; ambiente/QA pendientes |
| R21: sanitización, CSP, iframe aislado y protocolo | Admisión estática/geometría, scoping/contención y medición usada en compilador común, CSP por hashes, recursos/canal/renovación y guard HTML de cuotas existentes conectados y auditados. [Auditoría](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md). No equiparar contratos con aislamiento físico observado | Implementado/preparado; ambiente/QA pendientes |
| R22: inspector y salida idéntica preview/render | Compilador común y consumo vivo/congelado exacto auditados; ambos targets derivan los mismos fragmentos y consumen ready/assert. Transporte/background difieren, no se afirma igualdad del documento completo ni paridad de píxeles. [Auditoría](SOFLIA_ENGINE_CAP029_EDITORIAL_CONSUMERS_AUDIT.md) | Implementación compartida preparada; paridad visual/ambiente/QA pendientes |
| Inicialización durable y recuperación sin ACK | Transporte, digest compartido, journal previo al POST y GET de recibo conectado al host; panel habilita consulta de identidad durable | Implementado; QA manual pendiente |
| Recuperación inicial histórica con documento cambiado | Acción explícita reautoriza recibo incluso con ACK cacheado y verifica native cargado; sin inspector, restauración ni adopción | Implementado; QA manual pendiente |
| Catálogo UX | GET autenticado de coincidencias exactas de fuente guardada, selector de plantilla/versión/campos y envío durable existente conectados al catálogo servidor. Sin instalación ni registro automático. [Auditoría I05](SOFLIA_ENGINE_CAP029_TEMPLATE_CATALOG_UX_AUDIT.md) | Implementado; ambiente/QA pendientes |
| Entrega QA | [Expediente integral](SOFLIA_ENGINE_CAP029_QA_HANDOFF.md) con30 casos y extensiones, prerequisites/config/rutas inspeccionados, evidencia y puerta I01–I05 completada a nivel de implementación. A01/A02 requeridos antes de ejecutar QA real | Implementación preparada para QA; ambiente y aceptación manual pendientes |

## Historial de cortes — no sustituye la matriz vigente

## Corte de implementación — 2026-10-07

Corte previo2026-10-10: I01/I03 implementados/preparados; I02/I04 parciales e
I05 externo reservado pendiente. Nuevo corte I03: selección inicial contractual
exacta de medios vigentes del tenant fuera del draft origen, referencias/metadata/
pins/MIME/placements verificados; fonts READY existentes. Preparer/current-authority
integrados y SQL29 preparado con conservación del camino antiguo sin selección.
Factory→compiler→handoff→review/journal→stage/store→create aislado→recovery/opening
probados en recorrido concreto con filesystem temporal y RPC/Storage simulados,
pérdida de ACK/reinicio, un solo write por fase y original intacto. Auditoría I03
actualizada; nuevo crédito25/25 de continuidad, no por número de tests ni QA.
Regresión1012/1012, CLI9/9, tipado/lint dirigidos aprobados. No SQL/RLS/ACL/flags/
catálogo/Storage/browser reales, revisión humana, render o QA manual ejecutados.
Los cortes que siguen son históricos. [Auditoría](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md)
y [secuencia manual SQL1→29](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).

Corte siguiente I02: sizing CSS fijo/min-width/height/x/y podía amplificar un
viewBox pequeño sin entrar en el envelope de atributos. Lector de alternativas
bounded y segundo recorrido tras admisión completa incluyen CSS anterior/posterior,
inline/contextual/conditional/layers y composición por ancestros. Sin source/native
mutado; geometry-v9-css-viewport distingue reglas nuevas de paquetes anteriores.
Siete casos nuevos y prueba de ambos targets concretos. No se cierra I02 ni aumenta
≈85%: quedan relative/intrinsic/cascade/layout completo y cuotas de ejecución
independientes. I04 requiere wiring autorizado de previews de propuestas/presets;
I05 sigue externo. [Auditoría actual](SOFLIA_ENGINE_CAP029_GEOMETRY_AUDIT.md).
Sin SQL adicional/aplicado, flags/deploy/catálogo activados ni QA manual.
Evidencia final:1020/1020 regresión y32/32 dirigidas; compilación/tipado/lint aprobados.
Reserva puntual de wiring HTML de previews de propuestas/presets solicitada al
usuario, sin ejecutar cambios en ese frente ni contactar/reanudar el otro chat.

Revalidación posterior del merge del compañero: paquetes CAP-022/CAP-025 presentes
en Git, compilaciones dirigidas y tipado web aprobados, pruebas83/83 y50/50.
Ambos CAP siguen parciales por integración real faltante; dos tests verdes de
CAP-025 caracterizan brechas de ownership y fecha inválida, no las corrigen.
La instrucción del usuario permite revisar el trabajo juntado; no asumir garantías
durables ni liberar el catálogo UX por el merge. Sin cambio de porcentaje o SQL.
[Revisión y flujo de integración](SOFLIA_ENGINE_CAP029_PARALLEL_DELIVERY_REVIEW.md).

Nuevo bloque I02: comprobación de CSSOM/layout usado y readiness común emitidos
por ambos targets; preview espera fuentes/imágenes y valida antes de ready/play/
seek, con error explícito si falta/falla el runtime. Script/policy compartidos y
geometry-v10-computed-readiness; native y fuente original preservados. No se cierra
I02: matrices/paint/cuotas siguen pendientes. El corte siguiente conecta consumo
de ready/assert al executor original y preview físico mediante reader CDP propio
que no termina con checkpoints de texto. Repetición geométrica/PNG verificada sin
cambiar ABI del SDK; seis casos nuevos y regresión1036/1036/dirigidas62/62. Tipos
web/worker/tests y lint aprobados; browser/SDK físico sin ejecutar. Integraciones
reservadas I02/I04/I05 ya autorizadas expresamente por el usuario para continuar.

Último corte I04: implementado/preparado. Propuesta/preset almacenados se leen con
owner/base/status/expiry actuales y fuente/referencias exactas de la base; proyección
host-only al compilador común. Página privada, UI activa, canal, renovación y GET
binario unidos a la misma identidad; no fallback genérico ni permisos desde DTO.
Regresión1050/1050, dirigidas73/73 y tipos/lint aprobados. Ambiente/browser reales
pendientes; no cambios CAP025 policy/stores/SQL. I01/I03/I04 preparados; solo I02 e
I05 conservan implementación necesaria pendiente. Métrica≈90%±10, +5 por consumer
cerrado, no conteos. [Auditoría I04](SOFLIA_ENGINE_CAP029_PREVIEW_CONTEXT_AUDIT.md).

Último corte I05: implementado/preparado. Reutiliza catálogo instalado y lectura
bootstrap autorizada exacta, GET protegido y metadatos mínimos; selección explícita
en el panel existente alimenta initialize durable, sin fallback a entrada manual
ni instalación/registro automático. Actor/tenant/draft/clip/hash fijan el resultado
local; cambios lo ocultan y cancelan, sin reenvío. Regresión1062/1062, dirigidas29/29,
tipado/lint aprobados. No SQL nuevo/aplicado, deploy/flags/Storage/browser reales.
I01/I03/I04/I05 preparados; solo I02 conserva implementación necesaria pendiente.
Métrica≈95%±10 por catálogo integrado, no conteos. Ambiente y QA separados.
[Auditoría I05](SOFLIA_ENGINE_CAP029_TEMPLATE_CATALOG_UX_AUDIT.md).

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

## Corte I01 — journal y recuperación de adopción en cliente

Preimagen única conserva digest v1 entre servidor/WebCrypto; transporte acotado
POST/GET valida intención y receipt por owner/clip/operación/request/correlación.
POST desconocido no se repite; GET NOT_FOUND no autoriza retry ni eliminación.
Journal metadata-only actor/tenant/draft máximo8192 bytes, verificación del digest,
persistencia/relectura antes del envío y comparación exacta para ACK/cierre, sin
overwrite de seguimiento ocupado/corrupto ni source/approval/grants locales.

Coordinador usa lock y reserva nativa existentes. SEND bloquea ocupación de los
journals de edición/inicialización/snapshot, valida fuente/base y conserva identidad
antes del POST. RECOVER consulta servidor incluso con ACK local. Verifica hash/
versión native y pointer/manifest/source/grants en inspector antes de entregar
estado al host bajo reserva; solo cierra tras aceptación exitosa. Callback recibe
AbortSignal y debe revalidar owner/estado inmediatamente antes de mutar UI.

Modo histórico explícito verifica receipt y native idéntico al cargado, devuelve
view=null y no consulta inspector ni reactiva el HTML adoptado. Un resultado
histórico no afirma campos actuales/undo editorial/paridad ni permiso de escritura.

**12/12** tests nuevos de transporte/journal/coordinador; regresión CAP029/contratos
**733/733**, cero skipped; CLI offline **5/5**. Compilación de tests, tipado web y
lint de los ocho módulos/tests afectados aprobados sin warnings; diff check con
avisos LF/CRLF únicamente. No SQL/flags/templates/deploy ni QA/browser/HTTP/DB reales.

I01 sigue parcial: controles de revisión/diff/confirmación, lectura autorizada de
candidato, host/global blocking y recovery center visibles por integrar. Los otros
workflows deben observar ocupación de adopción simétricamente antes de activarla.
El catálogo UX reservado no se modifica ni se duplica. I02/I03/I04/I05 y A01/A02/Q01
no se cierran por tests de cliente con fixtures.

## Orden siguiente

1. Conectar el coordinador de I01 con host/global blocking y recovery center;
   completar revisión/diff/confirmación sobre candidato autorizado, sin tomar
   catálogo UX reservado ni activar instalación/flags.
2. Continuar auditoría R21 y consumers I04; resolver compatibilidad I03 con
   publicación histórica explícita revisada y contrato físico CAP027 existente.
3. Integrar únicamente entregas autorizadas del catálogo reservado.
4. Preparar gates y checklist completo para QA manual; marcar cierre solo cuando
   todos los requisitos de implementación tengan evidencia suficiente.

## Corte I01 — host nativo y recuperación visible de adopción

Host real conectado al coordinador bajo lock/reserva existentes. Instala payload
native verificado antes de cerrar el journal; aceptación revalida owner, identidad
del payload y trabajo incompatible. Recuperación histórica explícita conserva el
payload cargado sin restaurar fuente ni revision anterior. Cambio de owner/payload
antes de aceptación conserva el receipt y no aplica datos al editor.

Seguimiento pendiente/corrupto bloquea execute, inicialización y recuperación
editorial, independientemente del flag de nuevas adopciones. Bypass nativos y
publicación usan el isBlocked existente. Gate público SEND requiere inspector,
receipts de adopción, adopción y mutations; no se habilitó configuración.

Recovery center incluye panel draft-level con abort al desmontar, mensajes de
estado y verificación actual/histórica por GET, sin POST, reenvío, borrado o
restauración implícita. No depende de mantener seleccionado el clip original.

Seis tests nuevos cubren instalación, remount tras ACK perdido sin segundo POST,
recovery con nuevos envíos deshabilitados, cierre histórico sin adoptar fuente,
owner/payload cambiados y bloqueo cruzado ante journal pendiente/corrupto.
Regresión CAP029/contratos **739/739**, cero skipped; CLI offline **5/5**.
Compilación de tests, tipado web completo y lint de seis módulos/tests propios
aprobados, sin warnings en el lint acotado; diff check sin errores (avisos LF/CRLF).
Estos tests no prueban browser/HTTP/SQL reales.

I01 permanece parcial por lectura autorizada de candidato y revisión/diff/
confirmación. Auditar coordinación con narrativa y consumers restantes sin tocar
reservas ajenas unilateralmente. I02/I03/I04/I05 y ambiente/QA siguen abiertos.
No SQL, templates, flags, deploy ni QA manual realizados.

Siguiente: completar el recorrido visible de candidato aprobado y confirmación,
reutilizando provenance/repositorio y sin duplicar el catálogo UX reservado.

## Corte I01 — lectura autorizada, diff y confirmación del candidato

Repositorio añade readReviewedCandidate: reautoriza candidato/base/anchor, catálogo
y grants, regenera piloto/revisión/native sin writes y entrega vista mínima sin
encodedPilot/package/grants. Sources before/after, SHA, provenance, hash propuesto,
template/version, evidencia/reviews y campos. Sources máximo250 KiB UTF-8 cada
uno; JSON4 MiB para cubrir escaping, no payload ilimitado.

GET propio de candidatos con sesión actor/tenant, rol reviewer, same-origin/fetch
metadata, doble cuota, timeout y no-store. Query estricto solo expectedDocumentHash;
no approval/source/grants HTTP. Cliente consulta una vez, valida correlación, owner,
base, candidato y SHA de ambas fuentes, sin retry ni ejecución del HTML recibido.

Inspector conecta panel UUID aprobado→consulta→diff textual→checkbox→SEND coordinado.
Fuentes React escapadas y delta lineal completo, sin iframe/innerHTML/preview ni
claim de paridad visual. Unicode conserva pares surrogate. Releer/cambiar ID
reinicia confirmación; base distinta oculta revisión y no admite confirmación
obsoleta. Key owner/clip cancela al desmontar sin abortar por la adopción del propio
payload antes del cierre del journal. No duplica catálogo UX reservado ni permite
que checkbox registre aprobación del operador.

**10 tests nuevos** de revisión repo/client/HTTP/delta, incluida revocación de
grants/base/candidato, source/correlación/owner intercambiados, método/origin/query/
roles/cuotas, abort, UTF-8/extra authority y Unicode. Regresión **749/749**, cero
skipped; inspector offline **5/5**. Compilación de tests, tipado web completo y
lint de diez archivos afectados aprobados sin warnings; diff check sin errores
(avisos LF/CRLF). UI tipada/conectada no significa browser/accessibility QA real.

Este bloque de revisión/confirmación está implementado, pendiente de QA manual.
CAP029 sigue parcial: auditoría integral I01, geometría efectiva I02, continuidad
histórica I03, consumers I04 y catálogo externo I05; ambiente A01/A02 aparte.
No aplicó SQL, instaló templates, activó flags ni desplegó. Cambios concurrentes
ajenos (incluido BD.sql) preservados, sin atribuirlos a esta entrega.

Siguiente: auditoría concreta de I01/I04 y continuidad histórica I03; no cerrar
CAP completo por este flujo ni por el incremento del número de tests.

## Corte I03 — inventario histórico autorizado y paginado

`readAuthorizedHtmlSnapshotHistory` y contrato metadata-only preparados. RPC
service-only propio reautoriza actor/tenant/draft/composition en cada página,
sin ejecutar el compilador vigente como prerrequisito para listar historia.
Actor/org deben venir de sesión autenticada del host; no identidad HTTP libre.

Páginas de20 entradas con una fila de lookahead, keyset por revision_number e
índice UNIQUE(composition_id,revision_number) existente. Watermark inicial excluye
publicaciones posteriores. No es una transacción persistente entre páginas: si
se editan/eliminan identidades de historia, reiniciar inventario, no afirmar
exhaustividad desde un cursor arbitrario. Sin consulta N+1 por revisión.

Incluye todas las revisiones de la composición autorizada, incluso registros
sin flag snapshot o metadatos HTML inválidos/ausentes. Nunca interpreta ausencia
de pin como ausencia de legado ni pin metadata como bytes/paridad/compatibilidad.
Projection no expone source, manifest completo, path Storage, URLs ni grants.
Respuesta máximo64 KiB y timeout15s; valida orden/IDs únicos, owner, cursor,
watermark, rango, tamaño y claims de metadata, con errores seguros.

Migración `20261009110000_read_html_editing_snapshot_history.sql` preparada,
prefijo nuevo verificado sin duplicado local, sin aplicar ni tocar SQL ajeno.
Reutiliza assert_html_editing_actor y tablas/índices existentes; sin tablas,
compilación, signing, writes, restore o activación de publicaciones.
Política de bundle centralizada en módulo browser/server, reexport preserva API.

Siete tests añadidos de paginación/watermark/unknown legacy, owner/cursor,
substituciones/orden/duplicados, límites/abort/errores y estructura SQL estática.
Regresión CAP029/contratos **756/756**, cero skipped. No demuestra SQL/locks/
autorización/concurrencia reales. Compilación de tests,
tipado web y lint de cinco archivos propios aprobados; inspector offline5/5.
Runtime reconstruido:391487 bytes y117 inputs fijados, sin despliegue.

I03 sigue parcial: falta wiring ruta/UI de inventario, inspección autorizada de
archive bytes y publicación/recovery del candidato revisado. No cerrar mediante
ejecución histórica implícita, metadata o fixtures. I01/I02/I04/I05 y A01/A02/Q01
siguen con sus pendientes existentes. Mantener reservas de CAP027/catálogo.

## Corte I03 — inventario consultable desde el editor

GET `/drafts/{draftId}/html-snapshot-history?compositionId={compositionId}`;
cursor opcional requiere ceilingRevision/afterRevision juntos, decimales canónicos
y rango válido. Actor/org derivados de sesión, rol reviewer, origen/fetch metadata,
cuotas actor/tenant, timeout, tamaño y correlación; no authority/source/grants HTTP.
Reutiliza RPC paginado preparado y valida owner/ceiling/order contra request.
Namespace separado preserva consulta editorial de un clip llamado history.

Seguridad de lecturas compartida con revisión de candidatos mediante factory
propia: transport/auth/cuotas separados de comandos e integridad de cada dominio.
No refactor del gateway/append ni cambio de auth general. Misma semántica HTTP
de revisión y conflictos; mensajes seguros comunes, sin provider/source/log privado.

Cliente bounded hace un GET por acción, valida scope/cursor/correlación y no
acumula páginas, persiste historia o pagina/reintenta automáticamente. Panel propio
en recovery center recibe compositionId del editor y se remonta por owner/draft/
composition; abort al desmontar. Consulta/reinicio/siguiente explícitos, errores
visibles y20 registros máximo. Fin de lectura no certifica archivos, compatibilidad
ni QA; registros sin metadata siguen visibles. Sin botones render/restore/activate.

Gates existentes inspector + snapshot recovery (servidor y homólogos públicos);
sin nuevo flag ficticio, activar configuración, aplicar SQL o despliegue.
Siguiente requisito real I03: adquisición e inspección autorizada del archive
histórico, revisión del candidato y publicación/recovery explícitos. I03 y CAP029
siguen parciales; quedan además I01/I02/I04/I05 y ambiente/QA según expediente.

Validación del wiring: seis casos nuevos de history HTTP/client cubren identidad
derivada de sesión, GET/no-store, cuotas, cursor canónico/pareado, gates, origin,
abort, roles, source/payload/owner/correlación/watermark sustituidos y namespace
sin colisión con clip history. Se añade regresión de conflictos409 versus503
para revisión de candidatos al compartir el handler. Browser/accesibilidad y
PostgreSQL/RLS reales siguen pendientes: UI tipada no equivale a QA manual.
Compilación de tests, tipado web completo y lint acotado de12 archivos propios
aprobados sin warnings. Inspector offline5/5; diff check sin errores, avisos LF/CRLF.
Regresión CAP029/contratos **763/763**, cero skipped. No SQL/flags/templates/deploy
ni QA manual realizados. Inventario visible implementado; continuidad histórica
integral I03 permanece pendiente de los entregables indicados arriba.

## Corte I03 — inspección de archivos conectada al inventario

El inventario incorpora acción explícita GET de inspección por revisionId. No abre
preview antiguo, extrae archivos, restaura, recompila ni republica. Cada consulta
deriva actor/tenant de sesión y reautoriza draft actual/composition/revisión antes
de firmar Storage y después de inspeccionar; identidad debe permanecer idéntica.
El draft histórico reclamado también debe pertenecer al tenant/composition.
Migración propia `20261009120000_read_html_editing_snapshot_archive.sql` preparada
con prefijo único comprobado; sin aplicar. RPC service-only, sin tablas/índices ni
writes, exige snapshot/pin registrado y path exacto bajo composition-snapshots.
Registros sin metadata válida siguen visibles en inventario, no se convierten ni
descartan como si no existiera legado. Otras familias de archivos requieren
investigación explícita, no un path arbitrario suministrado por cliente.

Transporte privado comparte lector firmado con media/fonts sin ampliar su schema
MIME: únicamente este caso de uso admite application/zip. Hash y tamaño exactos
del ZIP (máximo200 MiB) antes de parsear; hash independiente del bundle, UTF-8
estricto y scope antes de diagnóstico. Solo diagnóstico/hashes salen a HTTP, no
source, bundle, URL firmada, Storage path ni permisos de recursos.

Preflight de directorio/local records antes de JSZip: máximo1024 entradas y256 MiB
de bytes declarados, path1024bytes; registros locales contiguos, nombres/tamaños/
descriptores coincidentes, sin duplicados/traversal/file-parent/symlink, split/SFX,
ZIP64, cifrado ni extensiones de nombre ambiguas. STORE/DEFLATE y descriptores
streamed admitidos. Se descomprime solo bundle (máximo16 MiB declarado y real),
sin CRC sweep ni inflar recursos no seleccionados. No es un extractor general ni
certifica integridad de otros miembros. Formatos fuera del perfil fallan
explícitamente; no se eliminan entradas silenciosamente.
Layout de registros cotejado con [especificación ZIP PKWARE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

Una lectura concurrente por proceso, sin cola; cuotas separadas tenant10/actor3
por60s, timeout120s, JSON16 KiB. No promete capacidad100000 usuarios ni límites
físicos del renderer; despliegue requiere dimensionamiento/medición de memoria
para archive200MiB más decoder/JSON y respetar timeout del hosting. UI comprueba
pins contra la página consultada y cancela al desmontar; deriva estado nuevo al
reinspeccionar, sin persistencia local ni retries. V1/perfil antiguo se marcan
requiere revisión; perfil vigente NO se promueve a permiso o paridad.

I03 permanece parcial: inspección conectada no cierra preparación/revisión del
candidato histórico ni su publicación/recovery autorizados. I01/I02/I04 siguen
parciales, I05 externo/reservado; ambiente y QA manual siguen diferidos. No se
modifican módulos reservados CAP027, catálogo, append/gateway ni SQL concurrente.

Validación:20 casos nuevos de ZIP/inspección/RPC simulado/HTTP/client, incluyendo
symlink, identidad y MIME/origen sustituidos, límites, revocación/metadata cambiada,
cancelación y admisión concurrente sin cola. Regresión CAP029/contratos **783/783**,
cero skipped; inspector offline **5/5**. Compilación conjunta y tipado web completo
aprobados; lint acotado de14 archivos afectados sin warnings. Runtime reconstruido
391487bytes/117inputs, sin desplegar. Diff check sin errores, avisos LF/CRLF.
Estos tests no prueban PostgreSQL/RLS, Storage autenticado, browser/accesibilidad,
memoria/CPU/timeout del hosting ni renderer reales. No aplicar SQL, instalar
templates, activar flags ni declarar CAP029 completo a partir de este corte.

## Corte I03 — candidato histórico revisable y modo no activo

Decisión explícita del usuario: si el snapshot histórico difiere del borrador
actual, crear una revisión histórica nueva **sin activarla ni cambiar el borrador**.
La implementación siguiente debe preservar active_revision_id y el documento
actual; no reutilizar el ACK de publicación normal, que exige activar la revisión.
Este acuerdo no autoriza ejecutar SQL, registrar aprobaciones reales, subir
archivos, activar flags o desplegar durante el desarrollo.

GET `/drafts/{draftId}/html-snapshot-history/{revisionId}/review` prepara una vista
de candidato HTML, no un archivo publicado. Reutiliza adquisición/inspección
autorizada; callback server-owned recibe bundle privado y la identidad se vuelve
a autorizar al terminar. Lector histórico existente selecciona documento guardado
por hash exacto y revisiones seleccionadas por sus pointers, con grants/template
revocation actuales. No sustituye por último documento/revisión ni usa permisos
del archive. Revalida antes de entregar la vista; fuente/estado incompatibles con
compiler vigente fallan, sin reescritura/ejecución del perfil anterior.

Vista acotada128KiB: propietario, identidad original, perfiles original/candidato,
hash del bundle nuevo, comparaciones por clip y pins antiguos sin equivalente.
El bundle candidato sigue privado; no se emiten HTML, grants, paths o URL Storage.
V1 sin pin previo se diferencia de igualdad/diferencia de pins. Ninguna igualdad
acredita comparación visual, accesibilidad o autorización de republicación.
Conserva las tres revisiones humanas obligatorias, sin checkbox que las registre.

UI integra acción explícita tras diagnóstico V1/perfil antiguo. Una consulta por
acción, sin retries/Storage local; valida hashes contra la inspección anterior,
cancela al desmontar y muestra errores sin instalar estado en el editor.
Mismos gates inspector/recovery existentes, rol reviewer, same-origin, cuotas
separadas y admisión compartida de una lectura por proceso. No catálogo duplicado,
nuevo renderer, acceso HTTP libre de aprobación ni cambios a append/gateway.

Siguiente entregable I03: ensamblar y conservar el archivo candidato exacto para
aprobación operator-owned; registro transaccional como revisión histórica no activa,
recibo propio y recuperación sin POST repetido ni cambio de draft/publicación
actual. Publicación normal exige native latest/CAS y ACK activo: no cambiar esas
reglas para simular publicación histórica. Preparación de bundle no es aprobación
del ZIP final, su contrato/recursos ni QA visual. I03 y CAP029 siguen parciales.

Validación del corte: **7/7** casos nuevos de review server/contrato/client/HTTP.
Incluyen V1/perfil previo, exact saved pointer, source archivado falsificado,
grants/revisión/native cambiados durante preparación, reautorización final,
cancelación, owner/correlación/bytes privados sustituidos y ausencia de aprobación
HTTP. Se refuerza lector compartido: request/identidad/pin privados congelados
para impedir mutación del callback sobre el contexto que se reautoriza.
Regresión CAP029/contratos **790/790**, cero skipped; inspector offline **5/5**.
Compilación conjunta y tipado web completo aprobados; lint de10 archivos propios
afectados aprobado sin warnings. Runtime391487bytes/117inputs reconstruido sin
deploy. Diff checks sin errores de whitespace, avisos LF/CRLF únicamente.
No PostgreSQL/RLS, HTTP autenticado/Storage, browser/accesibilidad ni render/QA
manual reales. No writes externos, SQL aplicado, flags/templates activados ni
cambios en áreas reservadas. No atribuir cambios concurrentes del compañero.

### Corte I03 — backend histórico sin activación (2026-10-09)

Decisión explícita del usuario: crear una revisión histórica nueva sin activarla
ni cambiar el borrador. No relajar latest/CAS ni el ACK activo de publicación normal.

Preparador privado operator-owned ensambla ZIP de perfil vigente con documento
guardado exacto, recursos/fonts autorizados y marcador de procedencia original;
revalida el bundle antes de entregar. No aprueba, sube ni renderiza. La aprobación
independiente identifica el hash del ZIP completo, no solo el bundle; después de
aprobarlo no reconstruir. Repositorio conserva copia de bytes/receipt antes del
primer await, verifica marcador y autoridad reutilizando el verificador de
publicación normal, usa Storage create-only/readback y detecta mutación del puerto.
El candidato inmutable vincula evidencia, reviewer y digest. No hay aprobación
HTTP libre ni recepción de fuentes/bytes arbitrarios.

Migración **preparada, no aplicada** `20261009130000_html_historical_publication.sql`:
tablas privadas/RLS, funciones service-only, reautorización de tenant/actor/reviewer/
original/recursos, revocación monotónica, locks draft/composición y creación de
revisión+links+recibo en una transacción. No actualiza composición, borrador ni
documentos nativos. Recibo vincula actor/operación/candidato/digest y declara
`activated:false`, `draftChanged:false`. Active/draft registrados describen el
instante del commit, no estado actual ni autoridad para renderizar. Recuperación
solo metadata: sin compiler, upload, reactivación ni reintento automático.
`NOT_FOUND` no autoriza repetir escritura. ACK incierto de staging puede dejar
archivo huérfano: no borrar, compensar ni reconstruir automáticamente.

Pendiente I03: handoff operator-owned de artefacto/aprobación completa, locator y
recuperación de staging incierto, HTTP de candidato aprobado y cliente durable
de registro/recuperación sin adoptar historia como borrador actual. Preparador
completo requiere pruebas integradas de adquisición/fonts/authority drift y
límites operativos de memoria/concurrencia; tests aislados del repositorio no
lo acreditan. PostgreSQL/RLS/locks/concurrencia/rollback, Storage real y QA manual
siguen pendientes. I03/CAP029 no se cierran por este corte.

Validación del corte: **12/12** casos nuevos; regresión CAP029/contratos **802/802**,
cero skipped; inspector offline **5/5**. Compilación conjunta, tipado web completo
y lint de ocho archivos propios afectados aprobados, sin warnings. Diff check
sin errores de whitespace. Pruebas con fakes y revisión estática SQL, no evidencia
de PostgreSQL/RLS/Storage/render reales. No se aplicó SQL ni hubo writes externos.

### Corte I03 — locator durable previo y recuperación del staging (2026-10-09)

El repositorio ahora conserva un locator cerrado antes de subir el ZIP: scope,
tenant/composición/draft, reviewer, candidato, digest del candidato, hash ZIP y
hash de evidencia. El adaptador por defecto lo registra mediante RPC service-only
con readback exacto. No contiene fuente, bytes, URLs ni credenciales. El operador
debe conservar su identidad antes de invocar staging; no reconstruir el artefacto
ni cambiar sus identificadores para eludir un intento incierto.

Migración **preparada, no aplicada** `20261009140000_read_html_historical_staging.sql`:
journal privado/RLS, claim inmutable por candidato y ACK `created`. Solo un claim
nuevo permite continuar al upload; existente, discrepante, cancelado, respuesta
sustituida o incierta lo impiden. Trigger verifica claim exacto antes del INSERT
del candidato; no depende únicamente del adaptador TypeScript.

Recovery metadata reautoriza actor/tenant/root scope y vincula owner/candidato/
digest/ZIP/evidencia. Distingue `NOT_FOUND`, `LOCATOR_RECORDED_STAGING_UNCONFIRMED`
y `RECORDED` con revocación conservada. No consulta compiler, Storage ni fuentes,
no valida aprobación actual ni otorga commit authority. Locator sin candidato no
prueba que el ZIP esté ausente: puede haber un archivo huérfano; ninguno de esos
estados autoriza automáticamente repetir subida/POST, regenerar o compensar.

Se resuelve el locator/consulta privados del corte anterior, no el handoff del
operador, la inspección autorizada de posibles huérfanos ni el cliente HTTP durable.
I03 sigue parcial junto con I01/I02/I04; I05 sigue externo/reservado. No aplicar SQL,
activar gates ni intervenir áreas del compañero como parte de este avance.

Validación: **20/20** casos dirigidos históricos, incluidos ocho añadidos en este
corte; regresión CAP029/contratos **810/810**, cero skipped; inspector offline
**5/5**. Compilación conjunta, tipado web completo y lint de los tres módulos
TypeScript afectados aprobados. Diff check sin errores. SQL verificado solo
estáticamente; no PostgreSQL/RLS/concurrencia/Storage/browser ni QA manual reales.

### Corte I03 — HTTP y transporte de registro histórico (2026-10-09)

Ruta propia `drafts/[draftId]/html-historical-publications/[operationId]`:
POST acepta únicamente compositionId, candidateId y candidateSha256. Actor/tenant
provienen de sesión activa y rol reviewer; no admite ZIP, HTML, aprobación, grants,
runtime o identidad del usuario. El repositorio conserva la reautorización y
transacción histórica no activa; no reutiliza el ACK activo de publicación normal.

GET exige los mismos identificadores y digest de request ligado a tenant/actor/
draft/composición/operación. Solo consulta el recibo; NOT_FOUND no habilita retry.
Controles de transporte: origen same-origin (obligatorio en POST), sec-fetch-site,
query/params cerrados sin duplicados, body incremental 1KiB/5s, URL 2KiB, cuotas
separadas org/actor por método, respuesta acotada, no-store, timeout y errores
seguros con correlation ID y retryable:false. Rechaza ACK activado, draft cambiado,
owner/request/digest sustituidos o payload adicional. No hay API de aprobación.

Gates existentes sin activarlos: inspector+snapshot recovery para GET; además
snapshot publication+mutations para POST. GET sobrevive a deshabilitar escrituras.
Aplicación SQL/Storage/flags sigue procedimiento autorizado, no este desarrollo.

Cliente usa preimage compartido/browser SHA-256, una solicitud, same-origin,
redirect:error/no-store, JSON acotado y validación de correlación/recibo. No instala
native/publicación, no realiza upload ni retries. Su SEND es un puerto de transporte:
**no conectarlo a UI antes del journal durable**, que sigue pendiente junto con
lectura/proyección de candidato aprobado, confirmación explícita, coordinator y
panel de recuperación. El registro operator-owned/locator privado anterior no
sustituye el journal del navegador para la operación de registro final.

Once casos nuevos cubren gates, identidad/rol/cuotas, origen/query/body/inyección,
límites/ACK privado, cancelación, NOT_FOUND, digest browser-servidor y recorrido
cliente→handler con autoridades simuladas. No es HTTP autenticado real ni prueba
de Postgres/RLS/Storage/browser/render. I03/CAP029 siguen parciales.

Resultado del corte: **11/11** nuevos casos de transporte; regresión CAP029/
contratos **821/821**, cero skipped. Compilación conjunta y tipado web completo
aprobados; lint de cinco archivos propios nuevos aprobado sin warnings. Checks de
whitespace sin errores (Git avisa conversión LF/CRLF). No se reconstruyó runtime:
no se modificaron sus fuentes en este corte. No writes externos ni SQL aplicado.

### Corte I03 — candidato autorizado, journal y coordinador (2026-10-09)

GET propio `drafts/[draftId]/html-historical-candidates/[candidateId]` con
compositionId/candidateSha256: sesión/tenant/rol reviewer, origen, cuotas separadas,
gates de lectura existentes y no-store. Repositorio lee candidato aprobado privado,
verifica digest/propietario/documento exacto/contrato/bundle/autoridad vigente y
repite RPC de autorización al terminar. Proyección cerrada: identidad, procedencia,
hash ZIP, evidencia/reviewer y revisiones completadas. No HTML/bundle, recursos,
path Storage, URLs o bytes. Es consulta de aprobación operator-owned registrada,
no una API para aprobar ni autoridad permanente para commit.

Journal browser propio guarda comando/digest/timestamp antes del único POST, con
readback, límite8KiB y separación actor/tenant/composición/draft. Rechaza corrupción,
scope/digest cambiado, storage inaccesible, sustitución durante awaits y overwrite.
ACK solo se registra si coincide con operación/request/digest y semántica inactiva.
No expiración ni borrado automático. Metadata local no es autorización del servidor.

Coordinador usa lock cooperativo existente del draft, sesión/scope fence y confirmación
explícita `confirmedHistoricalOnly:true`. SEND reconsulta candidato y exige misma
vista aprobada, crea operación, guarda journal y hace un POST. Además liga ACK al
ZIP/original mostrado; repositorio también valida esos pins al commit fresco.
Ante respuesta incierta conserva journal y bloquea otro SEND. RECOVER siempre GET,
incluso con ACK cacheado; NOT_FOUND conserva intento sin retry/cleanup. No recompila
fuente en recovery, no instala native/undo/publicación ni reserva edición nativa:
esta transacción solo registra historia no activa. El lock no reemplaza SQL/RLS.

Pendiente inmediato: panel de consulta/confirmación/recuperación y wiring al host,
cierre histórico explícito del journal mediante recibo reautorizado, handoff del
operador y auditoría del preparador completo. No declarar I03 terminado por estos
puertos sin conectarlos al producto. I01/I02/I04 y entrega externa I05 permanecen
pendientes; flags/migraciones y QA real no se ejecutaron.

Validación del corte: **16** casos añadidos (repositorio/candidato/journal/coordinador),
regresión CAP029/contratos **837/837**, cero skipped; inspector offline **5/5**.
Compilación conjunta y tipado web completo aprobados; lint de16 archivos propios
históricos aprobado sin warnings. Checks de whitespace sin errores (avisos LF/CRLF).
Sin rebuild/deploy de runtime ni migraciones aplicadas/writes externos. Fakes de
HTTP/sesión/Storage/lock y SQL estático no prueban browser/RLS/concurrencia reales.

### Corte I03 — panel integrado y cierre histórico explícito (2026-10-09)

`CompositionHtmlHistoricalPublicationPanel` conectado en el recovery center del
draft ya montado por NativeCompositionPreview. Key actor/tenant/draft/composición,
fence de stores de sesión/organización, cancelación al desmontar y storage events
del journal propio. No depende del clip seleccionado ni de una página del inventario.
Un intento pendiente permanece visible aunque se deshabiliten escrituras/lecturas;
storage inválido bloquea SEND. Web Locks ausente bloquea coordinación con explicación.

Consulta ID/SHA del candidato entregados por el operador y muestra original,
documento histórico, ZIP/bundle fijados, reviewer/evidencia y alcance de aprobación.
Sin aprobación browser, fuentes, uploads ni activación. Confirmación explícita antes
del SEND; coordinator reautoriza, persiste journal y registra una sola vez. Se
reinicia confirmación al cambiar entrada, recibir storage event o completar acción.
Errores mantienen seguimiento y no proponen reintento automático.

RECOVER consulta GET incluso con ACK local. CLOSE_HISTORY requiere confirmación
separada y GET nuevo; verifica operación/recibo, owner fence justo antes de eliminar,
estado exacto/readback y borra solo journal local. No borra fuente, revisión,
recibo backend ni cambia documento/undo/publicación activa. Resultado conserva
operación/revisión/hash ZIP visibles y declara semántica del instante del commit.

Migración preparada `20261009130000_html_historical_publication.sql` refuerza un solo
commit por candidato mediante UNIQUE(org,candidate), además del hash ZIP único;
readCandidate rechaza candidato ya registrado. Recuperación de operación existente
continúa por su recibo. No se aplicó la migración ni se activaron flags.

Quedan resueltos panel/wiring y cierre local explícito del corte anterior. I03
todavía requiere handoff operator-owned del ZIP/aprobación, auditoría/pruebas del
preparador completo y escenarios de datos históricos no admitidos documentados;
no confundir esos pendientes de implementación con QA manual. I01/I02/I04 e I05
externo/reservado siguen abiertos. No nuevos módulos QA/renderer ni catálogo ajeno.

Validación: **5** casos nuevos de cierre/coordinación/wiring; regresión CAP029/
contratos **842/842**, cero skipped; inspector **5/5**. Compilación conjunta y tipado
web completo aprobados; lint de siete archivos propios afectados sin warnings.
Checks de whitespace sin errores, avisos LF/CRLF. UI validada por tipado y wiring
estructural, **no interacción React/browser ni accesibilidad observada**. No se
añadieron dependencias de test para simular QA; PostgreSQL/RLS/concurrencia y
Storage reales siguen sin ejecutar. Sin rebuild/deploy de runtime ni writes externos.

### Corte I03 — preparador histórico completo y autoridad final (2026-10-09)

Auditoría del preparador privado: captura identidad/configuración y contratos de
runtime antes de esperar; deadline cooperativo de120s; una preparación por proceso
compartida entre factories, sin cola y con liberación en cancelación/error. Esto no
es un límite duro de CPU/memoria, un coordinador distribuido ni controla los artefactos
retenidos por el operador después de retornar.

Después de ensamblar y reautorizar la revisión histórica, refresca también los
medios nativos no HTML y las fuentes uploaded/READY de la organización. La revisión
de fuentes es metadata-only: exige misma familia/hash/tamaño/MIME del manifest
preparado, sin segunda descarga. Los bytes iniciales siguen ligados a hash y MIME.
Son lecturas secuenciales, no una transacción de permisos; staging/commit mantienen
sus revalidaciones y SQL bajo locks. No cambiar fuente, borrador o revisión activa.

Nueve casos de integración recorren ZIP antiguo V1/perfil anterior, documento exacto,
medios/fuentes y ensamblador real. Incluyen captura frente a mutaciones durante awaits,
admisión/cancelación, ZIP/origen inválidos, pérdida de grants/medios, corrupción/MIME
de fuentes y revocación posterior al ensamblado. Los nueve pasan. Se corrigió un ID
inválido del fixture, sin relajar validaciones del producto. Fuentes y medios son
sintéticos: no prueban decodificación, pintura, render ni permisos reales.

Siguiente implementación obligatoria de I03: handoff durable operator-owned de los
bytes exactos para revisión/aprobación independiente y staging sin reconstrucción.
El artefacto privado en memoria y sus tests no sustituyen ese flujo. I01/I02/I04 e
I05 externo/reservado siguen abiertos; este corte no habilita aceptación final ni QA.

Validación del corte: regresión CAP029/contratos **851/851**, cero skipped; inspector
offline **5/5**. Compilación conjunta y tipado web completo aprobados; lint de cinco
archivos de implementación/tests sin warnings (fixture revalidado tras corregir ID).
Whitespace sin errores, avisos LF/CRLF. Sin rebuild del runtime, migraciones aplicadas,
flags, aprobaciones, descargas o writes reales en Storage. HTTP autenticado, browser,
PostgreSQL/RLS/concurrencia/rollback y render reales no ejecutados.

### Corte I03 — handoff privado persistido y workflow de operador (2026-10-09)

`composition-html-editing-historical-handoff.server.ts` conserva ZIP exacto, metadata
y receipt create-only en un directorio privado del host. Archivos sincronizados y
readback; receipt al final, sin overwrite/cleanup/reanudación de estados parciales.
Locator liga candidate/tenant/composición/draft/SHA ZIP/SHA metadata y sello HMAC
con clave de32bytes host-owned separada del expediente. El sello es integridad,
no aprobación. Reads acotados, archivos regulares sin hardlinks/symlinks, rutas
UUID/fijas bajo raíz privada resuelta. No ZIP extraction ni ejecución de contenido.

`composition-html-editing-historical-operator.server.ts` conecta prepare→handoff
y, en acción independiente, reload→staging con aprobación del ZIP completo. Staging
no llama al preparador ni reconstruye bytes; conserva verificación actual y journal
durable backend antes de writes. Recuperación de staging usa el puerto existente,
sin retry. Configuración/puertos capturados y aprobación/locator copiados antes
de esperar. El handoff puede leerse tras reiniciar con la misma clave del host.

[Runbook privado](SOFLIA_ENGINE_CAP029_HISTORICAL_OPERATOR_HANDOFF.md) documenta
configuración, ACL Windows, revisión independiente, aprobación, separación de
locators y retención/fallos. No certifica resistencia a corte eléctrico ni carreras
de escritores privilegiados. Falta entrypoint operativo privado con configuración,
identidad/runtime autenticados del ambiente; **I03 permanece parcial**. No API de
aprobación pública, flags, instalación de claves ni writes remotos en este corte.

Validación: seis casos nuevos de filesystem/workflow (reinicio exacto, alteración,
clave/scope, receipt parcial, hardlinks, cancelación y no recompilación en staging),
regresión CAP029/contratos **857/857**, cero skipped. Compilación conjunta, tipado
web completo y lint de tres archivos propios aprobados sin warnings. El sandbox
deniega realpath incluso dentro del workspace (EPERM): tests filesystem/regresión
ejecutados con escalación aprobada, solo fixtures/temporales locales, sin servicios
externos. El inspector offline conserva el resultado previo5/5; no se modificó.
Fakes de staging no prueban Storage/RLS/SQL ni aprobación real. No QA manual/browser,
deploy, runtime rebuild, aplicación de migraciones o instalación de secretos.

### Corte I03 — entrypoint privado autenticado (2026-10-09)

CLI `tools/html-preview/historical-operator.mjs`, deshabilitado por defecto y sin
dotenv/imports de código arbitrario. JSON de comando por path absoluto y SHA,
UTF8/tamaño/handle controlados. PREPARE/STAGE/READ_STAGING separados, sin COMMIT,
activación, writes de SQL/config ni retry automático. Comando estricto no admite
actor/tenant/runtime/reviewer/credenciales del usuario. Principal HS256 Auth Bridge
vigente con sub/exp obligatorios y organización declarada; perfil reviewer actual
consultado en DB. RPC conserva comprobación de membresía/autoridad bajo sus locks.

PREPARE toma runtime desde JSON host-owned fijado por path/SHA de configuración.
STAGE instala reviewer autenticado y reutiliza handoff sellado sin preparar otra
vez. Emite locator de staging antes del intento de claim durable backend para
reconciliar ACK incierto; stdout no sustituye ese journal. READ_STAGING exige mismo
reviewer/tenant y no prepara/sube/compila. Errores seguros sin tokens/path/stack,
exit1 y retryable:false. Runbook actualizado con configuración y comandos reales.

Entrypoint implementado, **no instalado/configurado ni ejecutado con credenciales
reales**. I03 sigue abierto para auditoría final de cobertura de datos históricos
no admitidos; no seguir contabilizando CLI/handoff como implementación faltante.
I01/I02/I04/I05 y A01/A02/Q01 no cambian de estado por este entrypoint.

Validación: cuatro casos nuevos del command boundary (identidad/runtime del host,
reviewer autenticado, rechazo de inyección/scope y recovery/auth/abort). CLI **3/3**:
apagado por defecto, JSON fijado acotado y bootstrap completo con JWT realmente
firmado/SDK real y respuestas fetch simuladas, sin red. Se cubren token inválido y
perfil actual insuficiente. Regresión CAP029/contratos **861/861**, cero skipped;
compilación conjunta, tipado web completo y lint aprobados. Fixture de recovery
corregido para usar locator de staging sin metadataSha256 local; no relajar schemas.
Pruebas filesystem de la regresión con escalación aprobada por restricción realpath
del sandbox. No prueba HTTP autenticado real, PostgreSQL/RLS/Storage, ACL, aprobación
independiente, navegador ni render. Sin cambios en runtime ni writes externos.

### Corte I03 — auditoría de cobertura histórica y orientación de bloqueos (2026-10-09)

[Matriz de continuidad](SOFLIA_ENGINE_CAP029_HISTORICAL_CONTINUITY_AUDIT.md) distingue
metadata ausente, formato/integridad/scope, fuente sustituida, perfiles V1/previos,
perfil vigente, revocación, borrador distinto y ACK incierto. Nuevo módulo puro de
orientación conectado al inventario e inspección indica salidas explícitas sin
restaurar, corregir pins, reescribir fuente, aprobar ni instalar runtimes. Error de
preparación ya no atribuye todos los rechazos únicamente a permisos.

Hallazgo pendiente real: fuente histórica auténtica que el compilador actual no
admite. El flujo seguro bloquea, pero eso **no completa su continuidad**. Decisión
solicitada al usuario: reconstrucción como contenido nuevo explícitamente revisado
o ejecutor histórico versionado (este último requiere coordinación CAP027 reservado).
No se implementa una alternativa de menor fidelidad en silencio. Mientras se decide,
I01/I02/I04 tienen trabajo independiente; no declarar todo el objetivo bloqueado.

Validación: tres casos nuevos para todos los estados de metadata/diagnóstico y
distinción identidad/contenido; regresión CAP029/contratos **864/864**, cero skipped.
Compilación conjunta y tipado web completo aprobados; lint de módulos/paneles propios
sin warnings. UI por tipado/wiring, no interacción browser. CLI3/3 e inspector5/5
son resultados previos, no reejecutados aquí; no se modificaron. Sin writes externos,
migraciones aplicadas, flags, renderer/ejecutor histórico ni deploy.

### Decisión I03 — reconstrucción explícita de contenido no admitido (2026-10-09)

El usuario eligió reconstrucción como **contenido nuevo**, con revisión independiente.
Preservar original y borrador actual; no llamarla reproducción histórica exacta ni
reutilizar aprobación del ZIP antiguo para una nueva fuente. Se actualizó la auditoría
de continuidad. Implementación/integración del flujo derivado sigue pendiente; no
instalar ejecutor histórico ni editar CAP027 reservado por esta decisión.

### Corte I04 — canal del preview ligado al documento cargado (2026-10-09)

Hallazgo: NativeCompositionPreview elegía canal HTML con referencias del payload
actual, pero URL/hash pertenecían al documento cargado previamente. Durante cambios
optimistas, propuestas o edición guardada pendiente de recarga podía cambiar el canal
sin cambiar el hash del preview. Fallaba de forma segura en servidor, pero perdía el
contexto mostrado y no podía tratarse como integración correcta.

Captura propia `captureHtmlEditingPreviewSource` fija hash y flag HTML por valor al
adoptar/restaurar documento, renovar medios y recargar preview. Selector puro exige
identidad exacta: si falta o no corresponde al hash, no hay URL/fallback genérico.
No se cambia esa base compilada después de un patch runtime con ACK; el iframe sigue
describiendo su base original. Baseline ya conserva hash/flag/revision independientes.
No cambios en gateway, agentes/presets, narrativa, compiler/renderer ni autoridad.

I04 sigue abierto: previews de propuestas/presets no pasan contexto HTML exacto y
requieren contrato coordinado, no copiar contexto del borrador para simular soporte.
Esta corrección no implementa esos consumers ni prueba interacción React/browser.

Validación: caso nuevo captura canal por valor, cambio posterior de referencias en
ambos sentidos y bloqueo por hash distinto/identidad ausente. Regresión CAP029/
contratos **865/865**, cero skipped; compilación conjunta y tipado web completo
aprobados. Lint de selector/test sin warnings; NativeCompositionPreview reporta
**52 warnings y cero errores** de hooks/refs del componente compartido (no se hizo
refactor ajeno al bloque HTML). Whitespace sin errores, avisos LF/CRLF. Regresión
filesystem con escalación aprobada por realpath; sin red ni writes externos. No
interacción React/browser, QA formal, SQL aplicado, deploy ni cambios en runtime.

### Corte I03 — preparación inicial de reconstrucción nueva (2026-10-09)

Restricciones reales inspeccionadas: UNIQUE(composition_id) en drafts e índice
parcial de composición activa por componente. getOrCreate/initialize actuales no
son una operación de fork y pueden recuperar el original/reconciliar sus fuentes.
[Ruta explícita](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_IMPLEMENTATION.md) documenta
creación aislada, no sustitución del componente/borrador ni archivado compensatorio.

Módulo propio `composition-html-editing-historical-reconstruction.server.ts` obtiene
procedencia reautorizada sin compilar native histórico, heredar grants ni exportar
fuentes. Preparador puro exige scope nuevo, base/hash exactos sin pointers legados,
plantilla instalada tenant/source-bound y admisión/grants actuales. Reutiliza bootstrap
y binding existentes; devuelve revision1 y candidato no aprobado ni persistido.

Alcance incremental actual: una diapositiva autocontenida, sin vecinos/styles globales
no verificados. **No es el alcance final ni cierre de I03**. Multipágina/recursos,
handoff/aprobación nuevos, transacción create-only, recuperación y uso integrado aún
deben implementarse. Preservar restricción explícita mientras tanto, no usarla para
declarar cumplida una capacidad más pequeña que la solicitada.

Validación: cuatro casos dirigidos nuevos pasan; regresión CAP029/contratos
**869/869**, cero skipped. Compilación conjunta, tipado web completo y lint de los
dos módulos propios nuevos aprobados sin warnings. Tests de origen/autoridad son
fixtures, no pruebas de datos históricos reales ni creación en DB/Storage. Regresión
filesystem con escalación aprobada por realpath. Sin writes externos, migración nueva
o aplicada, instalación de templates/flags, renderer/runtime o QA manual.

### Corte I03 — preparación multipágina de contenido reconstruido (2026-10-09)

El preparador propio reemplaza la selección única por un conjunto explícito de
plantillas por clip. Cobertura exacta, sourceSHA/version/tenant instalados y admisión
actual son obligatorios en cada página. Genera revisiones iniciales independientes,
enlaza todos los pointers y revalida el conjunto contra el hash nativo final usando
el compilador existente. IDs duplicados entre fragmentos y aliases de imágenes no
locales se rechazan; no renombra IDs para esconder conflictos.

La base original y la procedencia no mutan. Ordenar las selecciones de otra forma
conserva el hash resultante. Nuevos tests cubren tres páginas, selección incompleta/
extra/duplicada, plantilla/version/source incorrectos, clip nativo no admitido,
colisión de IDs, grants revocados y aliases remotos/incorrectos; una fuente instalada
con script también se rechaza bajo las reglas actuales.

**I03 sigue parcial**: no hay todavía paquete completo reconstruido, estilos globales,
adquisición de fonts/media nuevos, handoff/aprobación propios, creación transaccional,
recuperación ni UI del contenido nuevo. Este corte verifica fragmentos, no wrappers
finales ni fidelidad visual. No se modificaron módulos reservados, DB/Storage,
config/flags, catálogo instalado o runtime. Véase la ruta de reconstrucción actualizada.

Validación ejecutada: **874/874** CAP029/contratos, cero fallos/skipped; nueve casos
dirigidos de reconstrucción incluidos. Compilación conjunta y tipado web completo
aprobados; lint de módulo/test sin errores ni warnings. Regresión filesystem local
con escalación por realpath, sin servicios externos. Whitespace sin errores (avisos
LF/CRLF). QA manual, SQL/RLS/concurrencia reales y comparación visual no ejecutados.

### Corte I03 — paquete reconstruido y adquisición actual de imágenes (2026-10-09)

El ensamblador HTML propio separa ahora adquisición autorizada y ensamblaje. La
ruta de snapshots guardados conserva lector exacto + refresh; una ruta privada de
reconstrucción produce el paquete completo de contenido nuevo sin crear primero un
draft provisional. Reutiliza preview/render, bundle, contrato, manifests, límites y
verificador existentes, sin editar CAP027/renderer ni introducir otro motor.

El adaptador concreto de diapositivas consulta enlaces actuales del draft origen y
metadata de imágenes del tenant usando el lector compartido extraído de snapshot-
images. Adquiere únicamente referencias efectivas; un alias mencionado como texto
no es un grant. No utiliza grants del ZIP antiguo. Relectura de origen/catálogo/
recursos tras compilar, conjuntos exactos e identidad fijada impiden emitir bytes
con autoridad revocada o recursos sustituidos. Puertos son host-only, no HTTP.

Se capturan configuración/runtime, identidad, contenido y fuentes antes de awaits;
las fuentes deben ser Uint8Array reales, no arrays coaccionados. Nueva ruta cuenta
con timeout cooperativo/admisión y conserva semántica de contenido no aprobado,
creado ni publicado. Procedencia aún debe ligarse al handoff/aprobación propios.

**I03 sigue parcial**: estilos globales, selección de recursos externos al draft
origen, fonts/media nativos, handoff/aprobación propios, transacción create-only,
recuperación y UI del nuevo contenido pendientes. No se descargan/decodifican imágenes
en este paso ni se demuestra paridad visual. I01/I02/I04/I05 y reservas no se cierran.

Validación: siete casos nuevos de la ruta completa/adaptador y dos regresiones
adicionales del ensamblador guardado. **883/883** CAP029/contratos, cero fallos/skipped;
compilación conjunta y tipado web completo aprobados. Ensamblador histórico previo
conservó sus 18 casos dirigidos; fixtures de múltiples páginas pasan el verificador
completo de referencia. Escalación filesystem local por realpath. Sin servicios
externos, DB/Storage writes, instalación/config/flags, QA manual o deploy.

### Corte I03 — medios, texto/captions y fuentes nativas reconstruidos (2026-10-09)

El preparador separa cobertura de diapositivas de los clips nativos. Módulo propio
valida conjunto exacto de medios/fonts, MIME por kind y colisiones de UUID entre
tablas. Capas nativas mantienen sus contratos existentes; no bypass por flag ni
recursos sin identidad/grant actual. El candidato contiene pointers HTML nuevos y
metadata nativa fijada para revisión independiente.

Adaptador de composición reutiliza los lectores actuales de medios del draft origen
y fuentes READY del tenant, sin compilar contenido histórico. Configuración/origen/
documento/bytes capturados por valor. Fonts se descargan y verifican una vez;
refresh reautoriza metadata sobre los mismos bytes, sin caché global. Relectura
verifica también que el conjunto nativo no cambió durante el ensamblaje.

Paquete completo de tres slides + video + texto + captions con una fuente pasa el
verificador compartido y conserva fuente embebida/contratos nativos en preview y
render. Unlink del video se prueba sin revocar la imagen para no simular cobertura
del lector nativo mediante un fallo anterior del lector de imágenes. Contrato puro
cubre imagen/audio/branding/SFX y rechazo por set/MIME/UUID ambiguo.

Estilos globales siguen pendientes: fragmentos aislados no consideran su efecto en
geometría/cascada. Requiere integración CSS, no QA solamente ni permitir a ciegas
una hoja global. Selección externa de recursos, handoff/aprobación independientes,
create-only transaccional, recuperación y UI siguen pendientes. I03 y CAP029 activos,
sin cierre por conteo de tests; no cambios en módulos reservados o DB/Storage.

Validación: **888/888** CAP029/contratos, cero fallos/skipped; compilación conjunta,
tipado web completo y lint de los módulos/tests modificados sin errores ni warnings.
12 casos dirigidos de preparación +9 del paquete reconstruido. Font/media sintéticos,
sin decode/render, paridad visual, permisos SQL/RLS reales, QA manual o deploy.

### Corte I03 — handoff propio y enlace de revisión de reconstrucción (2026-10-09)

Nuevo handoff conserva bytes/candidato/procedencia para reinicio, con metadata
estricta, pins y HMAC de dominio distinto del histórico. Se comparte solo el mecanismo
de archivos privados: UUID/nombres fijos, root resuelto, archivos regulares/nlink1,
NOFOLLOW donde disponible, writes create-only/fsync/readback y recibo al final.
No overwrite, cleanup ni adopción de parciales. Contrato de reconstrucción centraliza
origen/destino, límites y revisiones requeridas, sin duplicar schemas privados.

La revisión independiente se liga al candidateId, ZIP completo, metadata exacta de
origen/destino y reviewer autenticado por el host. Aprobación histórica no aceptada.
Carga y revisión no recompilan ni ejecutan, no reautorizan grants ni realizan writes
externos; el resultado distingue explícitamente enlace de revisión de autoridad o
creación. [Runbook propio](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_HANDOFF.md) describe
ACL/clave externa/retención, límites y semántica; no instala CLI/HTTP o configuración.

Pendientes: persistencia de candidato/revisión, journal y transacción create-only,
recuperación, consumidores CLI/UI, estilos globales y selección de recursos fuera
del origen. I03 parcial y objetivo CAP029 activo. No se sustituyeron original/draft,
componente, tablas/recibos de publicación histórica ni módulos reservados.

Validación: seis casos nuevos de handoff/revisión +seis históricos dirigidos pasan;
regresión **894/894** CAP029/contratos, cero fallos/skipped; compilación conjunta,
tipado web completo y lint de módulos/tests modificados sin errores ni warnings.
CLI privado **3/3** e inspector offline **5/5** repetidos y aprobados tras el refactor.
Filesystem temporal con escalación realpath, sin servicios externos ni DB/Storage
writes. ACL de ambiente, SQL/RLS/concurrencia, aprobación humana, render y QA manual
no probados. No declarar CAP completo a partir de esta evidencia local.

### Corte I03 — registro privado de revisión reconstruida (2026-10-09)

`HtmlReconstructionReviewRepository` verifica handoff/reviewer y registra una
atestación exacta de origen/destino, candidateId, ZIP, metadata, evidencia y las
tres revisiones independientes. RPC de consulta reconcilia una respuesta incierta
sin cargar archivos, compilar, subir Storage ni volver a escribir. Retirada explícita
conserva identidad y no puede revertirse registrando de nuevo el mismo candidato.
Schemas strict, captura antes de awaits, timeout/cancelación y respuestas exactas;
errores de proveedor no salen como detalles internos. No crea ni activa contenido.

Migración propia `20261009150000_html_reconstruction_review.sql` preparada, sin
aplicar; prefijo libre comprobado. Tabla privada con RLS y acceso directo revocado
incluso a service_role; RPC solo service_role. Revalida rol/membership/origen exacto
mediante lector de archivo histórico, sin invocar el compilador de native antiguo.
Conflictos de identidad/evidencia/reviewer no sobrescriben la revisión anterior.
El host debe preservar el record/aprobación antes de escribir; journal operativo,
candidato completo y transacción create-only aún pendientes. No reutiliza las
tablas o semántica de publicación histórica ni modifica componentes reservados.

Validación: **9/9** casos nuevos y regresión ampliada **903/903**, cero fallos/skipped.
Compilación de tests, tipado web completo y lint dirigido sin errores/warnings.
SQL inspeccionado estáticamente, no instalado/ejecutado: estos tests no acreditan
RLS/locks/concurrencia/rollback reales, revisión humana, Storage ni browser/render.
CLI/inspector no repetidos en este corte; evidencia anterior permanece identificada.

Por solicitud del usuario se incorpora [rúbrica propia de implementación necesaria](SOFLIA_ENGINE_CAP029_IMPLEMENTATION_METRIC.md): **≈70%**, primera línea base con
pesos explícitos, margen orientativo y QA/ambiente separados. Los nueve tests nuevos
no añaden porcentaje por sí solos; no se cerró aún el entregable de creación nueva.
No se añaden mejoras opcionales. I01–I04 parciales; I05 reservado/externo;
CAP029 y su objetivo siguen activos, sin afirmar que solo falte QA.

### Corte I03 — candidato y creación aislada con journal concreto (2026-10-10)

Backend completo preparado de staging/candidato/create-only/receipt, sin instalar
CLI/HTTP o configurar ambiente. Descriptor canónico resistente a reordenamiento de
keys JSONB; registro de conformidad reutiliza la misma función pura del snapshot,
sin otro compilador ni regenerar el ZIP aprobado. Verificador concreto relee origen,
catálogo actual y recursos/fonts actuales, sin compilar HTML histórico o descargar
otra vez fuentes. SQL repite autoridad de DB bajo locks, no inventa catálogo SQL.

Staging conserva identidad en journal privado concreto antes del claim remoto y
exige claim nuevo antes del único upload create-only con readback. Reautoriza antes
de registrar candidato inmutable. Creación relee receipt primero, exige candidato
durable y preserva intento local antes del único RPC; recuperación es lectura sin
otro create/upload. Una admisión de staging por proceso, sin cola; fallos mantienen
parciales y nunca los adoptan/limpian automáticamente. Journal usa HMAC propio por
operación/fase y root privado/clave externos, UUID/nombres fijos/fsync/readback.

Migraciones propias `20261010100000_html_reconstruction_candidates.sql` y
`20261010110000_create_html_reconstruction.sql` preparadas, prefijos libres revisados,
sin aplicar. Creación en una transacción: composición aislada sin componente ni
active_revision, draft nuevo, documento final versión1, revisiones HTML iniciales,
recursos/procedencia/audit y receipt. INSERTs sin UPSERT/adopción de UUIDs existentes;
no UPDATE/DELETE del original. El lector SQL exacto comprueba únicamente el NUEVO
documento/pointers/links antes del receipt; no ejecuta el compilador histórico.
Manifest de revisión inicial se conserva exacto para permitir reuse en publicación
explícita posterior; procedencia está en source_manifest y auditoría privada ligada.

Validación: **20/20** tests nuevos y regresión ampliada **923/923**, cero fallos/skipped.
CLI histórico **3/3** e inspector **5/5** repetidos; compilación conjunta, tipado web
completo y lint dirigido aprobados sin warnings/errores. Realpath/filesystem temporal
real con escalación; DB/Storage son fixtures. SQL revisado estáticamente: no acredita
RLS/concurrencia/rollback/locks en PostgreSQL real, aprobación humana, decode/render,
ACL del ambiente o QA manual. No cambios en CAP027/025/022/catálogo reservado.

Rúbrica propia: **≈75%**, +5 respecto al corte anterior por el backend preparado
completo, no por volumen de tests. I03 sigue parcial por CLI/UI/apertura y admisión
de estilos/recursos adicionales; I01/I02/I04 e I05 externo también siguen abiertos.
QA/instalación del ambiente separados; objetivo CAP029 activo. Próximo trabajo
necesario: integrar el recorrido operativo de revisión/creación/apertura sin ampliar
funciones del editor ni añadir recomendaciones opcionales.

### Corte I03 — operador reconstruido conectado (2026-10-10)

Implementados workflow, command boundary y factory concretos, más
`tools/html-preview/reconstruction-operator.mjs`. Acciones independientes de
preparación, revisión, retirada, staging y creación; consultas de recuperación
por candidateId/operationId sin retry, compiler ni nueva subida. Actor/tenant por
JWT Auth Bridge y rol actual; catálogo/runtime/configuración solo host-owned.

Nuevo journal de review intent preserva identidad/evidencia exactas antes del RPC
de revisión; fallo/readback/parcial impiden escritura. HMAC propio y archivos
create-only; tres raíces privadas preexistentes físicamente disjuntas. Factory
conecta adaptadores ya preparados de recursos/autoridad/review/store/repository,
sin endpoint público ni archivos de adaptadores ejecutables elegidos por request.
Confirmación explícita CREATE conserva componenteNULL y revisión no activa;
el original no se reconcilia, modifica ni sustituye. Recovery no necesita catálogo,
runtime, ZIP o HTML del candidato. Configuración de catálogo es snapshot del host
por invocación, no un registro SQL linealizable; mantener procedimiento de revocación.

Ocho casos nuevos de workflow/journal aprobados. Regresión **931/931**, sin fallos
ni skipped; CLI reconstrucción **3/3** y regresión CLI histórico **3/3**. Tipado
completo y lint dirigidos aprobados. Windows sandbox bloqueó realpath; repetición
de pruebas locales con permiso sin debilitar checks ni contactar servicios reales.
No aplicación SQL, Storage/DB externos, ACL instaladas o revisión visual humana.

SQL manual solicitado por el usuario: [orden completo y prerrequisitos](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).
[Uso del operador y límites](SOFLIA_ENGINE_CAP029_RECONSTRUCTION_OPERATOR_HANDOFF.md).
Métrica **≈75% conservada**: no acreditar el cierre de I03 todavía por CLI solo.
Falta UI/apertura aislada, estilos globales/recursos nuevos; I01/I02/I04/I05 siguen
según expediente. Objetivo activo, sin recomendaciones opcionales agregadas.

### Corte I03 — identidad actual para apertura aislada (2026-10-10)

Inspección del editor confirma que SceneBuilder, recuperación histórica, subida/
detach-audio y varios controles exigen componentId; el nuevo contenido aislado
tiene material_component_idNULL por diseño. No pasar el ID original/ficticio ni
usar initialize/getOrCreate como apertura: importaría/reconciliaría fuentes ajenas.

Implementada consulta metadata-only actual en módulos reconstruction-opening
(contrato, adapter, cliente, handler y ruta propia), con seguridad GET existente,
sesión/tenant/reviewer, cuotas y fallos seguros. RPC preparado
`20261010120000_read_html_reconstruction_opening.sql`: índice único por tenant/draft,
locks actuales de draft/membresía/composición, auditoría/procedencia exactas y última
versión guardada concordante. Exige composición independiente no archivada; separa
seedDocumentHash de currentDocumentHash/currentVersion, admite cambios posteriores
sin tratar el receipt inicial como versión actual. Sin compiler/HTML/source/ZIP/
Storage/initialize/escritura. No demuestra permisos para cada recurso ni ejecución;
los readers normales del editor conservan su autoridad independiente.

Siete casos nuevos aprobados (adapter/HTTP/cliente/SQL estático), regresión938/938
sin fallos/skipped; compilación de tests, tipado web y lint dirigidos aprobados.
SQL no aplicado, flags no activados. Pendiente montaje/control de
editor independiente y demás I03; métrica≈75% conservada. Orden SQL propio actualizado
con paso22 después de21, sin renumerar ni editar migraciones del compañero.

### Corte I03 — montaje de editor independiente (2026-10-10)

Página propia admin/assembly/reconstruction/[draftId], con tenant/actor/reviewer
derivados en servidor y lectura de opening vigente antes de montar. Parámetro de
path y query estrictos por separado: la query no puede sustituir el draftId del
path. Flag existente default cerrado. No initialize/getOrCreate, importación de
fuentes de componente, registro de candidato, creación o navegación automática.

Wrapper reutiliza NativeCompositionPreview con IDs nuevos, componentIdNULL real
y biblioteca/lessons vacíos. Compatibilidad con los consumidores string existente
verificada por tipado. Guards puntuales de preassembly/SceneBuilder/detachAudio;
inspector oculta procesamiento de voz/detach y timeline oculta refresh/recovery
por componente. Hook de waveform no realiza solicitud para scopeNULL. Se conserva
edición de timeline/native/HTML del nuevo draft por readers/saves originales;
no se introduce editor/compiler paralelo. No modificar narrativa, gates CAP027,
agentes/presets o catálogo reservado. El modelo de biblioteca vacía es limitación
funcional visible de la selección de recursos pendiente, no cierre de ese requisito.

CLI CREATE y READ_CREATION RECORDED emiten editorPath solo navegacional: la página
reauthoriza estado actual. Recibo histórico no da permiso de edición/publicación.
Cuatro tests nuevos de contrato/wiring estático aprobados; regresión942/942, sin
fallos/skipped; CLI reconstrucción3/3/histórico3/3 repetidos. Tipado web y lint nuevos
aprobados. Lint ampliado de cuatro componentes compartidos:0errores/61advertencias
(incluye hooks y código del studio fuera del bloque); no declarar esos archivos
limpios de warnings ni hacer refactor amplio ajeno al alcance. Whitespace check
aprobado. No prueba interacción/render browser ni operaciones de DB/RLS reales.
No SQL nuevo en este corte: último propio sigue20261010120000, paso22 del runbook.
Métrica≈75% conservada; I03 aún parcial por revisión browser integrada, CSS global
y selección independiente de recursos. I01/I02/I04/I05 siguen según expediente.

### Corte I03/I02 — preparación de stylesheet contextual (2026-10-10)

Inspección confirma que el stylesheet de deck se emite globalmente por el compiler
compartido, mientras los fragments editables usan wrapper/scope propio. Retirar
solamente deckStylesNULL en reconstrucción dejaría CSS sin la misma admisión de
geometría/cascada/clock de los fragments. No hacerlo ni modificar gates CAP027.

Preparador propio deck-styles verifica identidad native/revision y deriva estilos
por los scopes existentes, sin modificar fuente/pointers/native. Misma lógica
de aislamiento de selectors/layers extraída para ambos usos, sin una copia que
divergiría. Parser opcional de CSS contextual comparte presupuesto agregado con
source local. Fuentes URL/recursos CSS sin ledger, vecinos no enrolados y estilos
root/interactive/nesting no pasan; resultado es preparación, no permiso de render.

Seis casos dirigidos aprobados: scopes exactos/multipágina, bytes originales
intactos, orden determinista, layers/pseudoelementos, límite CSS agregado, identidad
alterada y dependencias no admitidas. No demostrar salida física por regex o hashes.
Sigue pendiente integración de la derivación en ambos targets, ledger de recursos,
actualización de perfil de compilación al cambiar semántica y validación de toda
continuidad. Reconstrucción conserva rechazo globalCSS hasta completar esa puerta.
No SQL nuevo; último propio20261010120000, paso22 del orden manual. Métrica≈75%.
Regresión final948/948, sin fallos/skipped; tipado web y lint dirigidos aprobados.
Comprobación whitespace aprobada. Sin DB/Storage/render/browser real ni instalación.

## Integración CSS contextual estático — 2026-10-10

El compilador compartido consume la derivación por binding en preview y render;
sin HTML editable conserva el camino legacy previo. Reconstrucción admite únicamente
CSS estático sin recursos, con presupuesto conjunto source/contexto y rechazo antes
de adquisición asíncrona. Source/native permanecen intactos; la revisión y creación
no recompilan el ZIP aprobado. Perfil static-fragment-v3-contextual-css evita
reinterpretar snapshots antiguos. Geometry-v8 permanece: I02 no se declara cerrado.

SQL nuevo20261010130000 (paso23) reemplaza solo la admisión de deckStyles del
validador privado; un test compara todo su cuerpo contra la versión previa y prueba
que autoridad/revisión/recursos permanecen iguales. No acredita ejecución PostgreSQL.
La primera regresión encontró un cambio de mensaje público al rechazar recursos;
corregida la frontera del compilador, sin relajar controles ni cambiar la expectativa.
I03 aún parcial por recursos independientes/revisión operativa; métrica≈75% conservada.
No modificaciones en áreas reservadas CAP022/025/027/catálogo ni writes externos.
Evidencia final del corte:950/950 CAP029/contratos;56/56 persistencia/compilador
compartido, tipado web y lint dirigidos aprobados. Cero fallos/skipped/cancelled;
no prueba browser, render físico, aplicación SQL ni autorización del ambiente.

## Biblioteca actualmente vinculada en scope independiente — 2026-10-10

Hallazgo funcional: la página nueva montaba el studio con assets[] aunque la
creación ya había enlazado recursos autorizados al nuevo borrador. Corregido con
lector RPC service-only de metadatos, adapter/HTTP/cliente y colección paginada:
reusa autoridad/provenance actual de apertura; links y registro tenant-scoped,
keyset UUID/página20 con lookahead21 y el índice único existente. Sin N+1 ni
consulta de componentes/biblioteca original, sin índice redundante.

SSR carga la primera página; UI usa el selector/inserción/reemplazo existentes.
Carga/actualización son consultas explícitas: no anexado, retry, initialización,
Storage URLs ni snapshots nuevos. Metadata acotada y total<=250; siguientes páginas
verifican hash/version/owner/cursor y rechazan mezcla de bases. Abort al desmontar,
anti-solapamiento y errores seguros; fallo descarta metadata vieja sin tocar native.

SQL propio20261010140000 preparado (paso24 después de23; dependencia directa22).
18/18 pruebas dirigidas (14 nuevas), regresión964/964, tipado web y lint dirigidos
aprobados; cero fallos/skipped/cancelled. SQL estático y montaje inspeccionado,
no PostgreSQL ni interacción/render/browser real. No toca áreas reservadas ni
aplica migrations/flags/ACL. Métrica≈75% conservada: recursos nuevos fuera del
origen y revisión operativa I03 siguen siendo implementación pendiente, además
de I01/I02/I04/I05. Este fix no reetiqueta todo lo restante como QA.

## Enlace puntual de medios al nuevo borrador — 2026-10-10

Consulta de UUID del tenant y confirmación de enlace conectadas en el editor
independiente. Admisión/proyección comunes con biblioteca; recurso y base fijados;
lock+journal antes de POST único; recibo atómico de éxito o rechazo conocido;
recuperación y cierre por GET actual sin reenviar. No documento/versión/original/
Storage/publicación mutados. Corrección Unicode de labels sin modificar metadata.
SQL25→26 preparados tras24, no aplicados. No duplicación de catálogo ni CAPs ajenas.

34/34 dirigidas y980/980 regresión, cero fallos/skipped/cancelled; tipado/lint
dirigidos aprobados. No PostgreSQL/RLS/locks/browser real. Métrica≈75% conservada
con misma rúbrica: enlace posterior no cierra preparación inicial de recursos
independientes ni revisión operativa I03; I01/I02/I04/I05 permanecen parciales.
Ruta mínima sin recomendaciones nuevas; ambiente/QA separados de código pendiente.

## I01 — inventario actual y auditoría de integración — 2026-10-10

Hallazgo: verificar un candidato por UUID no permitía inventariar las slides del
borrador guardado desde el editor. Agregado lector autorizado de metadatos, contrato,
HTTP/cliente y panel scoped en recovery center. FuenteSHA/bytes, existencia de
pointer/registro y template/version/source/revocado; sin HTML/URL/grants ni ejecución.
Página20/lookahead21, ordinal limitado500, hash+versión fijos para avanzar; cambio
exige reinicio. Identidad actual, roles/locks/cuotas, no-store, sin retries/writes.
SQL propio27 preparado, no aplicado; flags cerrados por defecto.

Auditoría de provenance reproduce compiler/geometry/isolation + source/template/
targets/compiled SHA desde entradas autorizadas. Hallazgo restante comprobado:
stageReviewedCandidate del legado solo tiene callers en pruebas, no un operador
de producto para preparación/revisión/registro. I01 sigue parcial y ese faltante
no se mueve a QA/ambiente. No tocar agentes/presets/catálogo/CAPs reservadas.
[Auditoría de trazabilidad](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md).

Evidencia de este corte:11/11 dirigidas de contrato/repository/HTTP+cliente/SQL
estático/montaje estructural;991/991 regresión CAP029/contratos, cero fallos/skipped/
cancelled. Compilación de pruebas, tipado web y lint dirigido aprobados. No DB,
RLS, locks, Storage, ejecución browser/render ni QA manual. Métrica≈75% conservada
sin cambiar denominador ni acreditar cierre de I01 por añadir este subentregable.

## I01 — operador concreto, registro recuperable y cierre de implementación — 2026-10-10

Brecha anterior resuelta: `stageReviewedCandidate` tiene caller de producto en
workflow/factory/CLI privados, con JWT/profile/tenant actuales. Source/anchor/grants
solo del contexto nativo autorizado; PREPARE compara dos lecturas y conserva
original/piloto/provenance íntegros en handoff HMAC/create-only/fsync/readback.
READ_PREPARATION recupera por UUID sin sobrescribir o regenerar una revisión.

STAGE_REVIEWED exige evidencia/tres revisiones y confirmación explícitas, deriva
reviewer actual y compara catálogo independiente; guarda intención metadata-only
sellada antes del registro único. Repositorio vuelve a verificar autoridad/base/
catálogo/grants. READ_REGISTRATION coteja candidato completo contra intención
sellada, incluso revocado o después de adopción, sin source/compiler/runtime/
catálogo ni otra escritura. NOT_FOUND/error conserva seguimiento; no reenvío,
compensación o borrado. SQL28 propio preparado, no aplicado.

Auditoría integral I01: inventario→original/versiones→piloto→registro revisado→
review/confirmación del inspector→native pointer/recibo históricos, usando módulos
existentes. Prueba cruzada usa el piloto recién registrado en el repository real,
valida source/pointer/hash/versiones y replay sin segundo commit; RPC simulado.
Los pins del perfil estático no certifican browser/render físico CAP027. Política
geométrica/cascada y consumers transversales quedan respectivamente en I02 e I04.

**I01 implementado/preparado, ambiente/QA pendientes**. Métrica **≈80% (±10)**,
+5 por ese entregable completo, mismo denominador/ponderación, no número de tests.
I02/I03/I04 parciales; I05 entrega externa reservada. No cerrar CAP029 ni el objetivo
como «solo QA»: quedan código/integración reales. A01/A02 conservan instalación/
SQL/RLS/locks/ACL/piloto autorizado y Q01 la revisión visual/manual del tester.

Evidencia final:39/39 dirigidas (11 operador +28 legado/adopción/coordinador),
regresión1002/1002 y CLI legado/histórico/reconstrucción9/9; compilación, tipado web
y lint dirigidos aprobados, cero fallos/skipped/cancelled. Sin SQL/Storage/RLS/locks/
ACL/browser/render/QA reales, sin activar flags, deploy o instalar catálogo. No
edición de catálogo UX/CAP022/025/027 ni trackers compartidos. Autenticación común
extraída solo entre las tres entradas privadas propias; contrato de registro en
adopción evita dependencia repository→CLI. No dependencias nuevas.

[Auditoría](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md),
[runbook](SOFLIA_ENGINE_CAP029_LEGACY_OPERATOR_HANDOFF.md),
[SQL completo1→28](SOFLIA_ENGINE_CAP029_SQL_MANUAL_ORDER.md).
