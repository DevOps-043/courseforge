# Herramientas controladas de HyperFrames

## Recorrido integrado del medidor (2026-10-08)

`materialized-reference-measurer.test.mjs` verifica el factory real desde `collectResult`:
request/receipt/candidato originales pinneados, testigo nativo validado, selección inmutable,
RPC scoped y ZIP/hash/receipt/metadata/PNG mediante el lector productivo, comparador completo,
SSIM real, gate de obligaciones, diagnóstico local y artifacts originales. No sustituye el medidor
por un callback que devuelve un report prefabricado. Solo Supabase y el proveedor de respuestas
nativas se simulan; éste entrega probe/timestamps y archivos PNG. Binarios dummy no ejecutables.

Cuatro casos: imágenes idénticas SSIM1 conservan INCOMPLETE/no-attestation; corrupción produce
FAIL y diagnóstico pero rechaza artifacts; nativo inválido falla antes de crear medición/leer refs;
aborto durante decode no publica artifacts ni diagnóstico de éxito. No ejecuta SDK/PowerShell/
Win32/FFmpeg ni aprueba render físico/corpus/QA formal. El recorrido single silencioso está verificado
en código; audio/lotes conservan pruebas del núcleo, no una acreditación física del factory.

## Reserva exacta de referencias y cobertura audiovisual (2026-10-08)

El factory admite `referenceSelections` como alternativa excluyente al callback `resolveReferences`.
Construir cada selección con `bindControlledReferenceSelection(descriptor, authorizedReferences)`
del build operativo después de obtener referencias desde un flujo host autorizado. El resolver
verifica ejecución/organización/revisión/documento/proyecto/hash completo del contrato y cobertura
ordenada exacta; audio es obligatorio si el contrato lo pide. Configuración y respuestas se copian,
rechazando duplicados, ejecución desconocida y reuse para otro intento. No consulta latest.

Cada factory exige declarar `composition-controlled-reference-selection.js` en el inventario.
`prepareLaunch` rechaza ausencia de plan materializado o contexto/contrato ajeno antes de iniciar
el productor. La selección queda en el host, no en stdin del hijo. El diagnóstico local incluye
organización/revisión y hashes del contrato/selección además del vídeo. **No es una reserva durable**,
no autoriza capturas por sí sola y no sustituye la verificación de registros/receipts del lector.

Validación dirigida cubre par visual/audio y recorrido ordenado de todas las particiones del corpus
multilote, con lectores/decoder simulados y archivos/hash/PNG reales. El factory tiene admisión/launch
verificados sin arrancar SDK/PowerShell; no se declara su recorrido físico integral aprobado.

## Medidor de referencias autorizado, integración opt-in (2026-10-08)

`materialized-reference-measurer.mjs` exporta `createMaterializedProducerReferenceBridgeConfiguration`.
Requiere configuración observada original, Supabase interno, `resolveReferences(descriptor)` del
operador y fence dedicado. El resolver devuelve checksums exactos por lote, no rutas ni credenciales
para el hijo. Debe obtenerlos desde la autoridad del job; el módulo no inventa una selección `latest`
ni activa migraciones/worker. La integración exige sus entrypoints declarados en el inventario.

Reconstituye contratos/observación/testigos nativos/seek originales antes de medir. El núcleo
`measureControlledConformanceReferences` valida identidad/cobertura y preview/audio antes de
usar los puertos Windows, aplica el comparador completo y el gate de obligaciones congeladas,
revalida vídeo/metadatos/PNG/máscaras/WAV y conserva entradas ante cierre incierto. El padre
espera también el colector independiente antes de liberar su fence, con timeout/cuarentena.

Escribe `controlled-measurements.json` exclusivo/acotado junto al candidato. FAIL impide entregar
artifacts; INCOMPLETE permanece explícito. Este diagnóstico local **no está incluido en la firma
actual del supervisor ni es evidencia durable de conformidad**. Faltan validación integrada
del factory completo, audio/lotes con referencias reales autorizadas y reserva de checksums en el
host productivo. No se ejecuta SDK/decoder/PowerShell/render físico o QA formal al importar.

## Transporte de medición posterior al productor (2026-10-08)

El build operativo exporta `createWindowsComparisonProcessPorts`. Implementa `execute`
UTF-8 y `consumePcm` con un job independiente y el driver fijo `run-owned-measurement.mjs`.
Spool stdout/stderr y receipt local son privados, exclusivos y acotados; no contaminan el
canal de control Windows. Consumo solo después de STOPPED, árbol vacío y cierre limpio.
Inventario aprobado, roles/comparisonTools, pins/rechecks, entorno fijo, deadline compartido,
retención y cuarentena siguen obligatorios. El transporte no acredita conformidad/procedencia.

La configuración recibe descriptor/workspace originales y un `measurementFence` dedicado
con directorio/hostId estables. **No compartir el slot del productor:** sigue reservado
mientras su `collectResult` llama a `measure`. Pasar la instancia como `processPorts` al
comparador existente es un paso explícito del operador; no hay wiring por defecto, instalación,
baseline autoaprobado, flag activada o despliegue. La integración del medidor completo con
referencias preview/audio/corpus autorizadas sigue pendiente. Cotas de spool no son cuota de
disco acumulada; Job Object tampoco es aislamiento de token/ACL/red.

Validación dirigida usa driver/schema/inventario/archivos/hashes/fence reales y Windows/
decoder simulados. No se ejecuta PowerShell, FFmpeg ni render físico. `spawn`/`signal` del
driver y `bridgePorts` son dependencias host de test, nunca campos serializados del request.

Estado2026-10-07: launch admite SDR/mux solo con instalación observada y plan V3 fijado;
legacy/V2 continúan rechazados. Bootstrap/colector integrado pasa para silent/AAC y rechaza
drift de tiempos sin receipt nativo. FPS se lee como racional SDK; streaming encode se desactiva
en la ruta controlada para no saltar stages.38/38 dirigidas actuales (4 bootstrap,6 request,
9 pipeline,5 stages,14 receta). Binarios/SDK/CDP simulados, PNG/paquetes/pins/hashes reales.
No instalación, activación productiva, render físico, QA formal ni aislamiento OS acreditado.

Remux silencioso actual: el adaptador verifica payload/extradata/timestamps iguales, perfil
SDR contado y ausencia de audio/streams extras; no exige bytes idénticos del contenedor.
Resultado privado `sdrSilentAssembly` vincula encoder/probe/output en la observación original,
sin declarar AAC mux ni cambiar políticas esperadas. Shared verifier conserva ruta AAC intacta.
Validación del corte anterior41/41 con binarios/SDK simulados, archivos/PNG reales.
Admisión ahora requiere V3 observado; no render/QA/rollout.

Adaptador SDR actual: `original-session-sdr-stages.mjs` y bootstrap conectan encoder y
verificador mux operativos a V4; observación file/CDP incorpora resultados vinculados.
`closed-stage-executor.mjs` espera close del hijo directo; no acredita cierre del árbol.
Temporales del encoder se retienen ante fallo para limpieza tras cierre/fence del propietario.
SDK faststart remux sin audio puede cambiar el contenedor; paquetes/timestamps se verifican.
Integración dirigida bootstrap SDR completa pasa, sin probar la ejecución física.
El adapter no usa test-build ni reemplaza captura/audio SDK. Tests simulan binarios y CDP;
PNG/filesystem/hash reales. Sin render físico, QA formal, rollout ni despliegue.

Receta actual `COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V4`: seis inserciones reversibles,
fuente upstream0.7.106 intacta. Puertos host emparejados `onEncode`/`onAfterAssemble`
permiten reemplazar solo la codificación silenciosa y verificar output antes de cleanup SDK.
Captura, medios, normalización de audio y mux/faststart siguen siendo originales. Loader
conserva copias de callbacks; runtime exige job/signal/frames y stages completos, sin fallback
si falla un puerto. Sin callbacks el encoder upstream permanece.
Bootstrap conecta estos puertos al encoder SDR/probes. V4 exige reconstrucción y aprobación
externa de nuevos hashes, sin auto-admisión ni activación productiva.
35/35 dirigidas:14 receta,5 stages/VM,8 packaging,8 loader/bootstrap. Binarios/SDK simulados;
archivos/hashes reales; no render/QA formal/instalación.

Preparación SDR: observer archiva condicionalmente los screenshots forward originales en
`original-forward-frames`, secuenciales y con cuotas/pins/rechecks. Recapturas reverse no
entran en el archivo. Bootstrap finaliza la secuencia privada y comprueba sus bytes;
no publica este resumen como attestation. SDR/mux exige plan V3 observado y resultados
vinculados de encoder/ensamblaje. No activa un worker productivo.
El módulo no elimina archivos mientras el propietario no confirme cierre/fence del job.
33/33 pruebas dirigidas actuales y ambas compilaciones pasan; SDK/CDP/video simulados,
PNG/archivos/hashes reales. Bootstrap SDR integrado probado ahora con binarios simulados;
no render físico ni QA formal.

Observación de ejecución V3: loader/driver transportan identidades desde pins medidos y
revalidados, no desde la expectativa. Bootstrap las combina con CDP original/hash del video;
receipt nativo requiere `renderExecutionObservation` y puente la consume/rechaza conflictos.
Archivo candidate sigue sin estas observaciones. Scope archivo/CDP, no prueba del ejecutable
cargado, dependencias dinámicas, aislamiento o attestation. SDR/mux explícitos requieren
plan V3 observado y resultados vinculados; no se declaran copiando el contrato esperado.

Repetibilidad original: recetaV4 presta `captureFrame` además de `prepareFrame` en after-frame.
Prepara y recaptura screenshot con funciones originales SDK; antes de devolver el frame al
pipeline restaura su posición. Observer decodifica PNG a RGBA y compara forward/reverse;
receipt V3 exige reportes de seek originales si el contrato lo requiere. Colector vincula
cada reporte y puente lo incorpora al comparador/rechaza conflictos. No concede paridad
preview/render, attestation ni color/A-V. Paquetes anteriores no se adoptan como V4: requieren rebuild,
nuevos hashes e inventario aprobado; no se altera node_modules ni se activa configuración.

Eventos nativos V3: con `checkpointBatch`, observer deriva todos los hijos del plan autorizado,
captura forward global y verifica reverse global en la sesión original con preparación SDK.
`eventNativeEvidence` es obligatoria en el receipt particionado; colector rederiva cobertura y
puente conecta cada testigo a su `EVENT_BATCH_SET`. No se copia evidencia padre ni se degrada
a contrato único. Recibos V3 de eventos antiguos sin cobertura se rechazan. No concede PASS,
attestation, repetibilidad RGBA, color o A/V; `measure` sigue obligatorio para esas mediciones.

Consumo nativo V3: `SINGLE_CONTRACT` recibe automáticamente la evidencia original validada
en el puente, ligada al contrato/documento/video; un medidor que entregue geometría distinta
se rechaza. El comparador consume geometría incluso sin fuentes personalizadas, sin fabricar
testigos de fuentes. Con bindings de fuentes, glifos observados siguen siendo obligatorios y
no atestados. `EVENT_BATCH_SET` usa la cobertura propia descrita arriba, no el testigo padre.
`measure` sigue obligatorio para ejecución/seek/audio/color y lifecycle de sus procesos.

Receta actual: `COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V4` (SDK0.7.106). El hook after-frame
puede prestar preparación original del SDK a mediciones inversas y restaura el frame capturado.
No es un seek manual ni evidencia de conformidad. Reconstruir/aprobar paquetes y sus pins para
usar esta receta; no reutilizar ni promover silenciosamente manifiestos anteriores.

Bootstrap V3 conecta captura nativa original de texto/glifos, compara forward/reverse usando
la preparación del SDK y guarda `original-native.json` ligado al plan/request/vídeo. El colector
lo exige para V3 y el puente lo entrega al medidor con pin/recheck. Scope observado sin atestación;
el medidor completo sigue obligatorio. No transforma estos datos en PASS, color/A-V ni fonts
de sistema/deck. Sin instalación productiva, render físico o QA formal acreditados.

Instalación local opt-in con SDK fijado; no es un worker productivo activado ni
un sandbox para documentos no confiables. Los drivers `observe-neutral-render`
y `controlled-sdk-*` siguen reservados al prototipo synthetic.

## Build operativo separado

### Plan materializado para proceso observado

La materialización nueva crea `controlled-measurement-plan.json` con fuente nativa autorizada y pins.
El request V3 liga su SHA/tamaño y execution; el archivo tiene nombre fijo, no ruta/código configurable.
Bootstrap lo valida y revalida antes/después del productor. V1/V2 conservan contrato legacy.
El plan está conectado a observaciones originales de fuentes/texto/seek/ejecución y etapas SDR;
**el plan mismo no es evidencia de conformidad**. Color efectivo/A-V/procedencia/aislamiento
y comparación completa conservan sus obligaciones pendientes.
El lector requiere build operativo y controles reales de rutas/enlaces, no fallback al build de pruebas.

Desde la raíz del repositorio:

```powershell
npm run build:composition-worker
npm run test:composition-worker-runtime
```

`apps/web/tsconfig.composition-worker.json` compila únicamente entradas operativas
y sus imports transitivos a `apps/web/dist/composition-worker`. No incluye tests
ni API routes; resolución Node16 conserva imports dinámicos ESM del SDK. El
colector materializado, el runner de conformidad y el gate final usan esa salida
fija, sin fallback a `.tmp/hyperframes-tests`. Si falta el build, el import falla;
no se autocompila ni se descarga una dependencia al ejecutar el colector.

La prueba del runtime carga módulos sin iniciar trabajo y revisa la salida
compilada. Los tests del colector usan archivos/crypto reales con bytes de fixture,
no vídeo real. No equivalen a QA audiovisual o verificación del sandbox.

Los tests `controlled-sdk-*` del prototipo conservan su build de pruebas anterior;
no son la ruta operativa del colector materializado.

## Instalación del operador todavía requerida

El build no incluye Node, Chromium, codecs, librerías compartidas, fuentes,
credenciales, manifiesto aprobado ni aislamiento de red/archivos/token. Deben
instalarse las dependencias bloqueadas del repositorio y de este directorio en
sus ubicaciones previstas; la salida no es un bundle autónomo ni una imagen.
Los archivos compilados y los módulos de herramientas que ejecute el host deben
formar parte de su inventario aprobado. No se genera ese baseline desde un job.

El puerto `measure` sigue siendo obligatorio y debe controlar sus propios
procesos: el Job del productor ya terminó al recopilar el candidato. Sigue
pendiente observar la sesión CDP original y completar las garantías físicas del
host. No activar flags, ejecutar los runners, desplegar o aplicar migraciones
como parte de este build.

## Extensión versionada de observación original (Windows seleccionado)

El operador autorizó Windows con permisos restringidos y una extensión versionada
del productor completo. `producer-extension-v1.mjs` es una receta pura fijada a
@hyperframes/producer 0.7.106, 9,931,212 bytes y SHA-256 del bundle original.
Rechaza drift de versión/bytes/hash y anclas no únicas; no escribe `node_modules`.
Añade hooks antes de navegar, después del seek/inyección de medios y antes/después
del screenshot original. Conserva los stages originales y exporta
`executeObservedRenderJob`, que delega al mismo `executeRenderJob` completo.

`courseforge-producer-observer-v1.mjs` mantiene callbacks host-only por ejecución
con AsyncLocalStorage. Exige perfil single-worker/software/screenshot sin pool,
drawElement ni dedup; rechaza errores absorbidos, frames incompletos y abortos.
El callback recibe una copia del buffer y SHA-256 del capture original; la sesión
y CDP son objetos originales y **los callbacks son código confiable**, no sandbox.
No aceptar callbacks, módulos o rutas del cliente/job. El adapter permite el
puerto `observer` solo con un productor explícito que exponga la extensión; no
usa fallback no instrumentado. El driver productivo no está activado/conectado.

Validación local sin importar/ejecutar SDK, Chromium ni FFmpeg:

```powershell
node --test apps/web/tools/controlled-hyperframes/producer-extension-v1.test.mjs apps/web/tools/controlled-hyperframes/controlled-materialized-producer.test.mjs
```

Pendiente: packaging fuera de `node_modules` que preserve **todo** el árbol dist,
imports relativos, recursos, LICENSE/notices y runtime de hooks; inventario
admitido con pins de salida/runtime; conectar observaciones efectivas y medición
owned. Copiar únicamente index.js rompería resolución relativa de recursos.
La receta y sus tests no acreditan instalación ejecutable, conformidad física,
token restringido/ACL/red/cuota de disco ni sandbox. No cambiar permisos globales
ni presentar el Job Object existente como aislamiento de archivos/red.

### Packaging reproducible y proyección de inventario

`build-producer-extension-v1.mjs` exporta `buildProducerExtensionPackage` para
un build **del operador**, no de un job. Requiere directorio fuente absoluto,
destino nuevo absoluto fuera de `node_modules` y AbortSignal. Copia todos los
archivos del paquete, preservando árbol dist/recursos/LICENSE/package.json;
solo cambia dist/index.js y agrega el runtime de observación. No instala,
importa ni ejecuta el productor. El padre del destino debe existir y no tener
aliases observados. No sobrescribe destinos ni limpia salidas fallidas.

Snapshot acotado: 1024 archivos/directorios, profundidad16, archivo64MiB y
total256MiB; rechaza enlaces simbólicos/junctions/hardlinks observados y
drift de identidad/tamaño/mtime/ctime. Relee fuente y salida antes de escribir
el manifiesto de finalización. Son controles de build, **no cuota OS ni prueba
de inmutabilidad frente a carreras adversariales**. Mode0600 no acredita ACL
Windows. Un aborto durante la escritura final puede dejar el marcador; el
llamador sigue recibiendo aborto y no debe promover automáticamente la salida.

El resultado contiene manifestSha256; `verifyProducerExtensionPackage` exige
ese digest **aprobado separadamente por el operador**, no leído y autoaceptado
desde el artefacto/job. `projectProducerExtensionInventory` añade rootId a
todos los pins y proyecta únicamente el rol producer hacia dist/index.js.
El fragmento incluye manifiesto y runtime; no sustituye el inventario completo
de Node/Chromium/codecs/fuentes/dependencias npm ni su admisión existente.

```powershell
node --test apps/web/tools/controlled-hyperframes/build-producer-extension-v1.test.mjs apps/web/tools/controlled-hyperframes/producer-extension-v1.test.mjs apps/web/tools/controlled-hyperframes/controlled-materialized-producer.test.mjs
```

28 comprobaciones, incluidos dos empaquetados reales idénticos y preservación
del vendor, alteración de runtime/archivos extra/marker ausente, pins externos,
destino existente, enlaces/aliases y regresiones de hooks/adapter. En esta sesión
Windows realpath/enlaces fueron bloqueados dentro del sandbox; se verificaron
fuera con temporales propios, sin debilitar los controles. No import SDK/render,
QA formal o instalación productiva. La resolución transitiva desde la ubicación
final del paquete, su inventario host y su conexión al driver siguen pendientes.

### Carga admitida del productor observado (host-only)

`admitted-observed-producer.mjs` usa la admisión existente del build operativo,
no un build de pruebas. Recibe instalación/configuración del host: paquete y
digest previamente aprobado, inventario completo declarado, contrato de
ejecución, rutas nativas, callbacks confiables y AbortSignal. Primero admite
árboles/roles/pins, verifica el paquete y exige que el rol producer apunte a su
entry y que todos sus archivos estén declarados. Browser/encoder/decoder deben
coincidir con rutas del inventario **antes** del import. Rechecks antes/después
del import y antes/después de la ejecución; rechaza namespace sin extensión.

El objeto devuelto expone createRenderJob/executeObservedRenderJob y defaults
clonados, no executeRenderJob sin observación. Señal y callbacks deben ser los
ligados a esa carga. Debe utilizarse en proceso owned fresco sin módulos
pre-cargados fuera de admisión; el loader no acredita la caché ESM, cierre de
imports dinámicos ni inmutabilidad OS entre recheck y carga.

`runMaterializedProducer` acepta el port host-only `observedInstallation` y
`signal`; borra variables antes de cargar y enlaza rutas nativas del request a
los roles admitidos. Configuración observada parcial o combinada con producer
arbitrario rechaza, no activa fallback. `observedLoaderPorts.importModule` es
un port confiable para tests, nunca metadata del cliente. El recibo conserva
scope de candidato, sin artifacts/conformidad. La rama legacy sigue disponible;
el CLI/bridge **aún no suministra esta instalación**, no está cerrado el arranque
Windows observado. Borrar NODE_OPTIONS dentro de Node no evita preloads previos:
el host deberá sanear el entorno antes del arranque y restringir token/ACL/red.

La configuración del puente ahora exige declarar también los imports estáticos
del loader/packaging/receta/lector. Eso no acredita el cierre transitivo completo
del runtime compilado, dependencias npm o binarios. **41/41** pruebas dirigidas
con admisión operativa y paquete/filesystem/crypto reales; namespace del SDK y
binarios simulados (roles no ejecutables), sin SDK/render/QA formal. Drift
antes/durante import y después de ejecución impide recibir candidato válido;
permanecen medición efectiva, bootstrap observado y sandbox Windows pendientes.

### Bootstrap observado fijo y request V2

El puente acepta `operatorConfiguration: {path, sha256}` exclusivamente en su
configuración host. Exige que esa referencia esté declarada y su hash coincida
con el inventario padre; selecciona `run-observed-materialized-producer.mjs`,
entry fijo, sin ruta de módulo/callback del job. La solicitud V2 incluye
renderExecutionSha256 canónico del descriptor; el bootstrap lo compara con el
contrato de la configuración aprobada. V2 sin instalación observada rechaza,
nunca cae en la rama legacy V1. El recibo de candidato conserva su binding.

Configuración JSON del operador: claves exactas policy, observerPolicy,
packageDirectory, expectedPackageManifestSha256, dependencyInventory y execution.
Policy `OBSERVED_PRODUCER_OPERATOR_CONFIGURATION_V1`, observer fijo
`ORIGINAL_SESSION_BROWSER_FRAME_DIGEST_V1`; límite4MiB, UTF8 estricto y digest
externo obligatorio. Su archivo debe vivir en una raíz de bootstrap separada
de sus raíces de runtime, evitando un manifiesto que deba hashearse a sí mismo.
El inventario padre declara bootstrap+runtime; la configuración describe los
árboles de runtime, y se revalida antes/después de ejecutar/escribir observación.
No generar ni aprobar esta configuración desde un job.

El observer fijo usa la sesión/CDP originales antes de navegar y alrededor de
cada frame, compara Browser.getVersion con el contrato y crea digest incremental
acotado a36000 frames. Rechaza salto/repetición de frame, cambio de sesión de
captura, bytes/digest distintos, versión cambiada, abortos y fallo absorbido.
Consulta CDP tras cada screenshot mientras el SDK aún posee el canal. Esto añade
overhead por frame que deberá medirse en QA/performance; no se presupone gratis.
Escribe `original-session.json` separado con binding al request/candidato.

**Este testigo NO es conformance ni supervisor artifact**: versión autoreportada
no identifica físicamente binario; digest no prueba fuentes/color ni frames
decodificados. El colector/measure aún debe consumir y validar el testigo y sumar
las mediciones completas existentes. No se arranca el proceso Windows real ni
se instala baseline/configuración productiva. El bridge PS existente ya construye
una allowlist de entorno antes de Start; falta cierre/validación física de
dependencias y sandbox token/ACL/red/disk, no atribuir esas garantías a allowlist
o Job Object. Rama legacy permanece para consumidores anteriores no promovidos.

### Registro original consumido por el colector (2026-10-07)

Bootstrap liga `original-session.json` a SHA-256/tamaño del vídeo final y revalida
ese vídeo después de escribirlo. Para V2, el colector exige expectativa host del
contrato execution y `ceil(durationSeconds*fps)` frames; no acepta omitirla ni
usar un registro ajeno/incompleto. Schema/keys/scope/version estrictos, límite
8192 bytes y UTF8 estricto, vídeo/request/ejecución/documento/proyecto ligados,
CDP before/after comparados con expectedBrowser, digest con formato SHA-256.

Colector pinnea y revalida el archivo original, incluyendo el recheck posterior
a measure. El puente entrega clones del registro y pin al medidor obligatorio;
mutar esos clones no afecta las identidades del colector. V1 mantiene su contrato
legacy sin registro observado. Ausencia/drift rechaza antes de supervisor; no
inventa artifacts ni concede PASS a partir del archivo.

**56/56 dirigidas**: paquete/admisión/filesystem/crypto reales, SDK/CDP/arranque/
medición simulados, bytes de vídeo no-media. Recorrido bootstrap y collector
validado, rechazo por witness ausente/foreign/oversized/UTF8/frame budget/CDP/
vídeo reemplazado y drift en measure. No se recomputa frameDigest desde frames
decodificados: digest es testigo del productor, no prueba física independiente.
Pendientes mediciones completas de fuentes/color/texto/checkpoints/A-V,
procedencia autorizada y sandbox Windows/dynamic loading. Sin QA formal/render/
migración/deploy ni nuevo baseline aprobado.

### Conexión de fuentes al CDP original (2026-10-07)

El build operativo emite `composition-borrowed-producer-cdp` y
`composition-original-session-font-capture`. El primero adapta send/on/off
del canal original del SDK a CompositionQaCdpClient: close elimina solo sus
listeners, no detach/cierre CDP ni listeners de otros consumidores. Quota32
subscriptions, fallos de callback/subscribe/cleanup latched, abortos y rechazo
de respuestas tardías. Runtime.releaseObject sigue permitido para liberar
handles después del aborto; esto no acredita terminación de comandos en vuelo
ni reemplaza STOP/Job Object/fence del host.

La fábrica se invoca desde onSession **antes de navegar**, con serverUrl local
del SDK, documento/contrato/manifest de fuentes congelados y verifyFiles del
host. Reutiliza startControlledFontCapture: evento CSS.fontsUpdated ligado a
archivo local, Browser.getVersion, glyphCount/custom-font/fallback, pins y
checkpoints. Exige invocar verifyRepeat sobre todos los checkpoints en orden
inverso antes de finish; etiqueta de repeatability sin verificaciones no basta.
El caller todavía debe realizar y medir los seeks originales y construir
geometría/checkpoints desde esa sesión; llamadas de verifyRepeat por sí solas
no prueban que se haya hecho un seek físico.

No se conecta todavía la fábrica al bootstrap: falta entregar el plan completo
autorizado/documento/fuentes y ligar lectura de texto + seek/repeat/restore al
pipeline completo. No fabricar ese plan ni reducir la obligación a glyphs o
digest. Las pruebas de CDP usan canal/font events/glyphs simulados, no navegador.
Scope del witness existente permanece LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION.
