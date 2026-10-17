# CAP-027 — controlador separado de red Windows

2026-10-12: autorizado desarrollar, NO instalar, activar ni modificar seguridad del equipo.

## Admisión integrada y receta de doble build — 2026-10-13

La autorización posterior permite instalación/activación únicamente en Windows aislado.
No se encontró una VM/runner accesible; el usuario indicó no disponer de VM y autorizó
continuar admisión/build sin ella. Ninguna dependencia se instaló ni DLL se cargó.

### Admisión de bundle runtime

`composition-windows-network-runtime-admission.ts` implementa el inventario independiente
`WINDOWS_NETWORK_EXACT_RUNTIME_BUNDLE_V1`. Un operador entrega directorio canónico, manifiesto
y digest aprobado por separado. Se mide el árbol completo: hashes/tamaños, identidad de
archivos y ancestros, sin enlaces/hardlinks, rutas reservadas/ADS, duplicados por casefold,
archivos extra/ausentes ni crecimiento fuera de límites. Máximo 4096 archivos/directorios,
24 niveles, 256 MiB/archivo y 1 GiB total. Versión Node, ABI modules y x64 deben coincidir
con el host. CLR declarado: .NET Framework 4.8, no selección ambiental implícita de CoreCLR.
La admisión y cada revalidación vuelven a enumerar; el primer fallo enclava la instancia.

`createAdmittedWindowsNetworkEdgeManagedExchange` conecta esa admisión al adaptador existente,
deriva el assembly de un rol verificado y combina revalidación de bundle con la verificación
del host antes/después de `edge.func` y cada intercambio. No acepta un assembly alternativo.
El objeto edge ya cargado sigue siendo responsabilidad del operador: esta admisión **no**
prueba su procedencia, que la clausura declarada sea completa, dependencias DLL del sistema,
ACL inmutable, enforcement ni procedencia del Node ejecutado (su pin es del contrato executor).
No se agregó un loader genérico que ejecute módulos arbitrarios para descubrir dependencias.

```ts
const invokeManaged = await createAdmittedWindowsNetworkEdgeManagedExchange({
  edge: operatorAdmittedEdgeRuntime,
  runtimeBundle: {directory: approvedBundleDirectory, manifest: approvedManifest,
    expectedManifestSha256: independentlyApprovedManifestSha256},
  assertHostIntegrity: verifyOperatorImmutableHostAndLoadedRuntime,
}, signal);
const exchange = await prepareWindowsAuthenticatedNetworkExchange(brokerReference, invokeManaged, signal);
```

### Build preparado, no ejecutado

Proyectos explícitos `Courseforge.NetworkClient.csproj` y `Courseforge.NetworkPolicy.csproj`:
net48/x64, lista cerrada de fuentes, versiones fijas, warnings como error, optimización,
[Deterministic/PathMap](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/code-generation).
La DLL WFP permanece separada y no forma parte del bundle del cliente restringido.
CMake declara CRT estático mediante
[CMP0091/MSVC_RUNTIME_LIBRARY](https://cmake.org/cmake/help/latest/variable/CMAKE_MSVC_RUNTIME_LIBRARY.html),
flags reproducibles y sin link incremental. No es prueba de reproducibilidad hasta compilar.

`build-network-controller.ps1` exige herramientas absolutas con SHA-256, versiones exactas
SDK .NET/CMake/MSVC/Windows SDK y shell VS x64 previamente provisionado. No instala herramientas.
Usa dos copias de fuentes pinneadas, selector .NET sin roll-forward y NuGet.Config sin fuentes.
No permite heredar Directory.Build.props/targets. Compila cliente/policy/WFP por separado,
compara tamaño/SHA-256 de las tres DLL, revalida fuentes/herramientas y emite receipt exclusivo
solo si coinciden. Fallos conservan los directorios parciales sin recibo; no sobrescribe destinos
existentes ni limpia por TTL. No carga DLL, abre pipe, invoca filtros ni realiza despliegue.

El recibo tiene scope BUILD_OUTPUT_NOT_RUNTIME_ADMISSION_OR_ENFORCEMENT: no autoaprueba release,
no admite toda la clausura de herramientas y no prueba reproducibilidad entre hosts. El operador
debe provisionar SDK/reference pack 4.8, MSVC y entorno de build confiable. No reutilizar hashes
de fixtures ni de Add-Type como identidad de un binario productivo.

Validación: 6/6 inventario + conexión al adaptador (archivos reales, edge simulado), 5/5 adaptador;
ambos proyectos TypeScript compilan. Parse AST PowerShell y XML de ambos proyectos pasan.
La lectura realpath en temp recibió EPERM en sandbox; las pruebas de inventario pasan con
ampliación acotada, sin cargas nativas. No se ejecutó el build ni se generaron DLL/recibos reales.
CAP-027 **91.30% estimado parcial**, promedio siete **98.76%**: estos controles fuente no
demuestran runtime ni satisfacen las brechas físicas de cierre. Próximo bloqueo: toolchain y
runtime admitidos, conexión nativa efectiva, corpus físico y operación PostgreSQL.

## Entrada CLR concreta y adaptador edge — 2026-10-13

Implementados `NetworkPipeManagedEntry.cs` y
`composition-windows-network-edge-managed-exchange.ts`. La entrada precompilable expone
`Task<object> Invoke(object)` compatible con el contrato de
[edge-js](https://github.com/agracio/edge-js#how-to-marshal-data-between-c-and-nodejs).
No se agregó ni instaló una dependencia: se recibe exclusivamente el runtime ya admitido
por el operador. El adaptador llama `edge.func` con assembly absoluto, tipo y método fijos;
esto es una activación explícita y **no** debe ejecutarse al leer configuración o desde HTML.

`Invoke` valida y copia diez argumentos exactos; PID y FILETIME viajan como decimal canónico
sin redondeo V8/CLR. SID de cuenta/logon, distintos peers, payload UTF-8 acotado y UUID se
validan antes de crear una lease. Devuelve dos delegados: exchange de un solo uso y cancel.
Solo exchange llama al método real `ExchangeBoundOnceAsync`, en el proceso Node anfitrión.
Cancel previo impide esa llamada; cancel durante intercambio no libera la lease hasta
que termine el trabajo pendiente. No hay subprocess, compilación inline ni reintentos.

Composición de operador (no ejecutada):

```ts
const invokeManaged = await createWindowsNetworkEdgeManagedExchange({
  edge: operatorAdmittedEdgeRuntime,
  assemblyPath: operatorAdmittedManagedAssemblyPath,
  assertUnchanged: assertFullEdgeAndManagedDependencyClosureUnchanged,
}, signal);
const exchange = await prepareWindowsAuthenticatedNetworkExchange(brokerReference, invokeManaged, signal);
// exchange se entrega al lifecycle original existente; no abre red por sí solo al prepararlo.
```

La verificación obligatoria debe incluir runtime edge, binarios nativos, assembly y toda su
clausura de dependencias y ACL inmutable; **no basta un hash de la DLL administrada**. El
adaptador no proporciona un loader seguro de esa clausura ni prueba el runtime físico.
La assembly debe construirse para el CLR y ABI Node/arquitectura admitidos; la compilación
de prueba con Add-Type no genera un artefacto distribuible ni demuestra compatibilidad edge.
Si un callback no termina, el adaptador no declara drenaje por haber enviado cancel: la
cuarentena/fence y el deadline externo siguen siendo obligatorios.

Validación: 5/5 pruebas Node del adaptador, edge/CLR simulados; 3/3 admisión autenticada,
archivos reales/callback nativo simulado (requiere permiso de lectura temporal fuera del
sandbox; EPERM sin ampliación). C# compila con pwsh y pasan cuatro grupos managed: siete
rechazos de entrada, exclusión de leases, cancelación previa y liberación para siguiente
preparación. Ninguno abre pipe o ejecuta Win32/WFP. Windows PowerShell rechazó ejecutar
el script por AuthorizationManager; se usó pwsh ya disponible, sin cambiar políticas.
Ambos proyectos TypeScript compilan. No instalación, carga real de edge/DLL, render ni QA formal.

CAP-027 permanece **91.30% estimado parcial**, promedio siete **98.76%**. Implementar la
entrada fuente reduce trabajo pendiente, pero no cierra runtime admitido, enforcement nativo,
provisión, corpus físico o PostgreSQL. Sustituye el diagnóstico inferior de «sin entrada CLR»,
no sus límites operativos.

## Auditoría de runtime y presupuesto SDR — corte posterior

Consulta local: package.json raíz/web/controlled-hyperframes no declara edge-js,
node-api-dotnet, node-addon-api/node-gyp, ffi-napi/koffi o dotnet. Get-Command dotnet/cl/cmake
sin resultados PATH. No afirmación de ausencia global en el equipo; ni instalación/browse/
descarga/compilación native C++ hecha. Binding CLR real sigue pendiente, no desplegable desde
callback simulado. Se mantiene la prohibición de convertir helper subprocess en peer admitido.

Inspección encontró brecha concreta dentro CAP-027 audiovisual: original-session-sdr-stages
pasaba timeoutMilliseconds completo a encodeSdrCapturedFrames y otra vez a verificación mux.
Aunque executor padre limita operación completa, wrapper podía renovar presupuesto local.
Corrección comparte reloj monotónico desde onEncode a copia/assembly interval/verificación/
finalize. Cada etapa recibe remaining; verificaciones before/after de archivos también
comprueban budget. Tiempo agotado/nonfinite/regresión enclava FAILED sin resultado tardío.
Port clock solo código operador/test, nunca request/HTML. No timer autónomo ni prueba de
interrupción de callbacks no cooperativos: outer owned executor conserva deadline/cleanup/fence.

7/7 pruebas etapas SDR pasan:4 previas pipeline+3 presupuesto, including remaining <=4000
tras6000 usados de10000, mux expirado sin nuevo probe, finalize expirado y clock inválido.
Fixtures archivos/PNG/crypto reales, encoder/probe/SDK assembly simulados, sin proceso/render/
QA formal. HyperFrames entry leído para edición puntual; pipeline original/SDK pin conservados.
No runtime instalado ni seguridad modificada. Pins de wrapper deben regenerarse para admisión.
CAP-02791.30% estimado parcial; siete98.76%, sin crédito por reparar una garantía ya registrada.

## Admisión del exchange e identidad nativa del cliente — corte posterior

composition-windows-network-authenticated-exchange.ts prepara exchange desde configuración
broker V2 admitida y revalidada por pins/ancestors, captura identity/binding y copia payload/
respuesta antes de aceptar. Valida scope/nonce/channel/secuencia1–3/current process PID antes
del callback managed y revalida archivos después. Deadline compartido15s/serial/quarantina:
error/late reply/replay no avanzan. Cliente de comandos conserva validación adicional de ACK/
generación/plan/lease. Adaptador no convierte contenido propio de respuesta en prueba nativa.

AuthenticatedNetworkPipeClient.cs añade ExchangeBoundOnceAsync, entry explícito para runtime
managed del cliente SUPERVISOR. PID configurado debe ser GetCurrentProcessId; retained handle
propio verifica FILETIME/UserSID/LogonSID antes y después de ExchangeOnceAsync existente, que
autentica servidor por PID/FILETIME/token y usa named pipe local. Copia request antes de await.
No llamar desde PowerShell hijo del Node configurado: el broker rechazaría distinto PID y no
se admite rebajar esa comprobación. Cambios de helper C# exigen regenerar pins de config.

Límite explícito: no runtime CLR in-process configurado/implementado en Node, invokeManaged
es todavía una obligación de integración, no un native binding real. Ningún callback default,
compilación/LoadLibrary/pipe al preparar exchange. Tampoco resuelve factory WFP/efectividad
global/confirmación independiente de Job. Si se elige host .NET distinto debe revisarse contrato
de peer admitido de extremo a extremo; no usar subprocess como fallback silencioso.

Validación:3/3 exchange con archivos reales/managed callback simulado (argumentos, replay,
file drift, nonce),5/5 cliente existente; ambos TS compilan. C# servidor/cliente compilan y5
grupos de checks managed framing pasan. No GetCurrentProcessId/OpenProcess/pipe/network/WFP
invocados, ni render/QA formal/instalación/activación. No procesos de test pendientes.
CAP-02791.30% estimado parcial; siete98.76%. Se fortalece contrato de native invocation,
pero no se acredita cierre de aislamiento ni implementación completa del backend nativo.

## Composición concreta de supervisor firmado — corte posterior

original-server-network-lifecycle.mjs cierra el port serveOriginalServer: deriva cliente
broker desde binding operador estricto, comprueba ejecución/nonce contra configuración
pública y correspondencia de KeyObject Ed25519 privado con SPKI. Clave privada capturada
por closure, nunca devuelta en lifecycle ni serializada en configuración/launch/worker.
Solo atiende una sesión original en DENIED (recorder original exige una sesión); mailbox
firma ACK después de createWindowsOriginalServerAuthorization: snapshots root/Job antes y
después de allow ACK validado. No requiere otro puerto TCP. Exchange nativo sigue obligatorio,
sin default. Firma no sustituye independencia/efectividad del backend WFP.

createMaterializedOriginalServerNetworkLifecycle es preparación read-only con reference
operator hash-pinneada V2, mailbox sibling por ejecución y pins reales de módulos del
supervisor/canal y compiled lifecycle/client/auth/contract. Revalida antes/durante/después
de servir. Construcción no crea claim/proceso/política; claim solo cuando wrapper llega READY
y llama serve. Caller la suministra explícitamente a networkLifecycle del host Windows.
No lectura de private key desde job, no provisionamiento/configuración operativa persistida.
Es gate local de módulos directos, NO cierre completo del grafo import/TOCTOU inmutabilidad.

Wrapper ahora captura organización y packageSID de lifecycle; exige descriptor.organizationId
igual y token AppContainerV5 con MISMO SID antes de DENY/START. Evita policy sobre otro
package o tenant por composición errónea. Materialized bridge ahora exige nuevos helper/
transport/policy y original-session-network-guard.mjs en inventario observado; ausencia
falla antes de launch/measure. No cambio de renderPipeline, SDK fijo ni referencias.

Validación corte:4/4 composición supervisor (firmas/archivos reales, snapshot/exchange simulados),
6/6 ciclo con rechazo tenant ajeno,11/11 bridge materializado incluidas dependencias ausentes,
4/4 comparación/measurer existente y ambos TS pasan. No procesos pendientes. No Win32/socket/
Job/WFP/pipe físicos, render o QA formal. HyperFrames entry utilizada para edición específica
preservando pipeline. No upgrade/instalación/activación/seguridad del equipo modificados.

Pendiente concreto: exchange al pipe C# autenticado y native broker factory conectada a
WFP con política efectiva (propios filtros no bastan) y confirmación Job independiente;
provisión ACL/profile/SID/key custody/negación acceso worker a privada, build DLL MSVC SDK,
inventario completo operativo y pins, aceptación física separada, corpus/SDR/fonts/audio/DB.
No declarar cierre/solo QA. CAP-02791.30% estimado parcial; siete98.76%. Mantener rúbrica:
este wiring elimina ports de software pendientes, pero no prueba el criterio OS/ejecutor.

## Ciclo de red conectado a factoría Windows — corte posterior

composition-windows-network-owned-start.ts compone executor poseído y cliente broker por
ejecución única. Devuelve handle SÍNCRONO para intento reservado, no Promise de start sin
ownership. Retiene launched/stop/completion; descriptor/workspace se clonan antes de DENY.
Solo crea bridge después de DENY confirmado, señal viva y sin STOP solicitado. Abort/STOP
en esa espera impiden arranque tardío aun ante exchange no cooperativo. Intento no reutilizable.
No presume que native policy dejó de trabajar desde timeout: cancelación antes de obtener
job no fabrica STOP, exige intervención/retención fence; late exchange no inicia productor.

READY del bridge se acepta solo en estado DENIED y ejecución esperada, con AppContainerV5/
cuotas como exige bridge V4. serveOriginalServer es port operador que DEBE componer mailbox
firmado y authorize independiente/listener/broker y drenar todo trabajo; nunca HTML. Al
retornar exige LOCAL_ONLY. Resultado de bridge/colección no se publica hasta stopAndConfirm
con cierre Job/bridge y drain, seguido de SEAL con señal cleanup independiente máximo5s;
ACK debe dejar SEALED. Stop duplicado comparte Promise/comando/sellado únicos. Seal fallido
no publica candidato ya recolectado ni libera ownership como exitoso. No eliminar políticas.

Factoría createWindowsControlledRenderWorkerHost acepta networkLifecycle opt-in y selecciona
wrapper; rechaza combinación con onOwnedReady preexistente para no sobreescribir callback
silenciosamente. Modo legacy unchanged. Nueva entrada en build operacional. Factory y cliente
están vinculados a UNA ejecución: futuros jobs requieren composición fresca/journal nuevos
con reconciliación de leases según política; no reutilizar cliente SEALED/FAILED ni perfil incierto.

5/5 pruebas de ciclo: orden DENY/START/ACK/STOP/SEAL, withholding hasta seal ACK, stop/abort
en DENY sin spawn tardío, seal fallo sin publicación, y executor fence retenido/quarantina al
cancelar prelaunch. Cliente real/bridge real TS con transport/snapshots/Job/broker simulados;
NO native enforcement.27/27 bridge regresión y ambos builds TS pasan. No procesos pendientes.
git diff --check sin errores de whitespace, sin job/browser/WFP/pipe/render/QA formal.

Pendiente: port serve aún no instanciado por bootstrap SUPERVISOR operativo con mailbox y
key custody privado; configuración de una ejecución/nonce/SID consistente debe cubrir ambos
extremos. Broker debe confirmar Job cerrado desde su backend confiable, no confiar en JSON
STOPPED como evidencia independiente. Runtime/inventario/ACL/provision/pins/native DLL/build,
política efectiva/SID y corpus/DB siguen abiertos. Este wrapper no los sustituye ni activa.
CAP-02791.30% estimado parcial; siete98.76%, sin subir por ciclo con backend/ports incompletos.

## Bootstrap V2 conectado al canal firmado — corte posterior

OBSERVED_PRODUCER_OPERATOR_CONFIGURATION_V2 añade networkChannel obligatorio y estricto;
V1 no permite ese campo ni hace upgrade automático. Metadata pública: policy, directorio,
ejecución/nonce, SPKI canónico Ed25519/SHA y SHA/tamaño del transporte fijo. PrivateKey/callback
source/módulo arbitrario/campos extra y deriva de key fallan antes de importación SDK.
Parse de política pública separado del módulo pesado evita cargar transporte antes de su pin.
Helper observed-original-server-channel.mjs comprueba bytes/hash antes de import dinámico y
después; vuelve a comprobar configuración/transporte antes/después de cada intercambio.
No prueba closure por ese solo SHA: helper/policy/dependencias/compiled deben estar en inventario
runtime admitido e inmovilizado por host. Solo se fijó el transporte directo en esta capa.

Mailbox debe coincidir exactamente con <outputParent>/<executionId>.original-server-channel,
preprovisionado por supervisor y fuera del proyecto/materialización. Es sibling del output de
video, NO dentro de su directorio: runMaterializedProducer conserva mkdir exclusivo y no
acepta outputs preexistentes. V2 une ejecución del request a config pinneada antes de crear claim.
Bootstrap fija onOriginalServer usando cliente construido con clave PÚBLICA; privada nunca se
serializa ni envía al proceso. V1 no crea mailbox ni callback. No configuración operativa creada.

Validación:9/9 loader/bootstrap pasan, incluida prueba V2 de bootstrap real + admisión filesystem
del paquete y signed mailbox real, pero namespace SDK/browser/native authorize simulados.
2/2 parse/binding/pins,6/6 canal real y5/5 gate pasan. Es prueba de software, NO render físico,
IPC entre procesos o aislamiento OS. Primer intento de suite detenido por registro incorrecto
de subtest en padre (deadlock del test), corregido a contexto propio y repetido: ejecución9/9
terminó exit0. No procesos de prueba pendientes. git diff --check sin errores de whitespace.

Pendiente: wrapper de supervisor que posea DENY antes de START, derive rootIdentity/control de
READY, atienda mailbox con composición listener/broker y selle después de STOP/cierre confirmado.
Key custody privado y directorio/ACL inmutables deben provisionarse fuera del alcance worker;
necesario regenerar/admitir inventario operativo con nuevos helper/policy/channel y validar
native policy/SID/WFP/build, corpus/DB. No activar/certificar seguridad desde tests simulados.
Skill HyperFrames orientó edición específica conservando SDK fijo y pipeline, sin CLI render/
upgrade ni instalación/activación. CAP-02791.30% estimado parcial; siete98.76% sin incremento
por wiring solo del extremo productor, mientras supervisor/OS permanecen sin cierre.

## Transporte local candidato/ACK firmado — corte posterior

original-server-file-channel.mjs implementa ambos extremos del mailbox SIN puerto TCP adicional.
Configuración es del operador: directorio dedicado/canónico, ejecución y nonce únicos por intento,
clave pública Ed25519 en productor y privada SOLO supervisor; no configuración desde HTML.
ACK firma bytes del payload con hash de solicitud, requestId, ejecución/nonce/secuencia,
rootIdentity y endpoint/status exactos. Cliente exige firma canónica y PID igual a process.pid;
declarar un ACK o escribir archivos en workspace no basta para falsificar permiso. No atesta
FILETIME/SID/ownership por sí mismo: rootIdentity/authorize deben venir del bridge poseído.

Publicación wx+write+sync+close antes de marker listo; marker también wx, sin overwrite.
Lectura regular/nlink1/reparse/identidad acotada8192bytes, UTF8 estricto, directorio canónico con
dev/ino retenidos/revalidado. Marker NO firmado solo habilita lectura: manipularlo permite DoS,
no grant. Payload ausente después de marker falla, no repair/retry. Cada extremo reserva claim
exclusivo; reabrir mailbox retenido falla.4 intercambios seriales máximo (8 snapshots Job bridge),
15s operación con polling25ms y cancelación; no TTL, cleanup, reclaim, red o ACL modificadas.

En cancelación/error se enclava canal y se espera trabajo en vuelo antes de retornar, incluso
si authorize ignora señal. ACK tardío impedido por comprobación de señal antes de publicar.
Si callback no termina, el executor padre debe agotar su cleanup y retener fence/intervención;
no inferir drenado desde timeout. Datos/claims quedan para recuperación manual explícita.

6/6 pruebas con directorios temporales/filesystem y firmas reales pasan: intercambios seriales,
firma ajena, PID ajeno, cancelación/retención, candidato inválido y callback no cooperativo/late
ACK. Supervisor callback y root son simulados en esos tests; no IPC entre procesos ni API Win32.
No browser/pipe/WFP/render/QA formal. Skill HyperFrames entry/CLI orientó inspección específica
sin upgrade de versión fijada ni CLI de render. No procesos de servicio iniciados.

Pendiente crítico: incluir transporte en inventario versionado/config pública hash-pinneada y
bootstrap opt-in, key custody supervisor fuera de alcance worker y serving ligado al Job/fence.
La configuración actual V1 sigue rechazando campos adicionales; NO canal activado implícitamente.
Provision ACL/directory/key único por intento, native policy efectivo/SID/build y pruebas físicas
siguen abiertos. Snapshot/canonical path no constituyen atomicidad frente a cambio de ancestors.
CAP-02791.30% estimado parcial; siete98.76%, sin subir por transporte aún no admitido/integrado.

## Compuerta original pre-navegación y composición supervisor — corte posterior

Extensión COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V6 conserva SDK0.7.106/SHA original y ocho
hooks, sin editar node_modules. Hook de initializeSession sigue siendo primera acción:
onOriginalServer opt-in valida candidato EXACTO http://localhost:<puerto canónico1–65535>,
espera respuesta exacta {status:AUTHORIZED,address:127.0.0.1,port}, y solo entonces sustituye
session.serverUrl por dirección IPv4 literal, adquiere CDP y ejecuta onSession/SDK navegación.
No concede WFP por sí mismo. Deadline15s/AbortSignal cancelan señal dedicada del callback;
late ACK no muta sesión ni autoriza navegación. Error persiste aunque SDK absorba rechazo.
No puerto nuevo ni cambio de candidato dentro del mismo job observado. Cada sesión vuelve a
pedir autorización/revalidación; callback es código confiable operador, nunca HTML ni metadata.
Loader admitido conserva callback capturado/frozen y rechaza tipos inválidos antes de import.
Legacy sin callback conserva comportamiento upstream; NO equivale a certificación segura.

composition-windows-original-server-authorization.ts compone en el SUPERVISOR root/control
del bridge y cliente broker ya DENIED antes de arranque. Candidato no constituye evidencia:
exige observación root exacto/listener antes de ALLOW, ACK validado por cliente y segunda
observación de root/listener después del transaction. Solo entonces emite ACK de productor.
LOCAL_ONLY permite revalidar sesiones posteriores solo en puerto ya vinculado, sin replay de
comando ALLOW. NEW/SEALED/RECOVERY/root drift/url ajena/puerto nuevo/concurrencia fallan.
Fallo enclava esta composición; no retry, revoke/remove policy o éxito implícitos.

Límite importante: son ambos extremos/programación del handshake, NO transporte IPC entre
worker restringido y supervisor, ni wiring productivo de onOriginalServer. No serializar signal,
control ni callbacks. Futuro transporte debe bindear execution/root/pkg y cancelar/drain ante
deadline sin liberar fence con comandos nativos en vuelo. Snapshot antes/después NO elimina
TOCTOU/rebind ni demuestra política efectiva global/SID. Native broker readback/SDK candidate
channel/build/provision/pins, corpus/DB siguen abiertos. Nada fue instalado o activado.

Validación:5/5 compuerta observer (ACK exacto/bad URL/timeout/abort/legacy),3/3 composición
supervisor (cliente real con exchange simulado, snapshots simulados),15/15 transformación
de fuente SDK fijada/sintaxis y8/8 loader con admisión filesystem real/módulo falso pasan;
ambos TS compilan. No SDK import real/browser/native job/socket/pipe/WFP/render ni QA formal.
Skill HyperFrames entry/CLI usada para inspección y edición específica: no comandos de
render/upgrade/scaffold; versión SDK exacta preservada. V6 obliga regenerar package/pins/inventario.
CAP-02791.30% estimado parcial; siete98.76%, no incremento por cerrar solo extremos del handshake.

## Listener integrado al canal poseído — corte posterior

WindowsOwnedRootControl se entrega como quinto parámetro de onOwnedReady: operador, NO HTML.
observeOriginalListener(port) solo funciona en V4/AppContainerV5/cuotas, con READY y root poseído,
antes de ROOT_EXITED/STOP. Emite OBSERVE_ORIGINAL_LISTENER por stdin privado del bridge;
PowerShell valida campos/ejecución/GUID/puerto y llama al método del owner, no abre PID externo.
LISTENER_OBSERVED entrega dirección127.0.0.1/puerto/PID/FILETIME con requestId. TS exige coincidencia
contra identidad READY inmutable y solicitud pendiente. Copias entregadas al callback no pueden
redefinir la identidad confiable. No hay permiso HTTP implícito en la respuesta.

Máximo8 consultas por ejecución y una pendiente, todas dentro del presupuesto de salida16KiB.
Deadline15s y AbortSignal cancelan la consulta; STOP/root-exit/fallo de bridge rechazan trabajo
pendiente. Respuesta tardía/duplicada/ajena falla el canal. Timeout/fallo enclava el control;
absorber su rechazo en el hook no permite éxito ni colección. Hook debe drenar consultas antes
de retornar; STOP+cierre de bridge no bastan para liberar fence si hook queda incierto.

Validación de este corte:27/27 pruebas Node de bridge incluyen correlación/identidad/puerto,
metadata no solicitada, STOP, aborto, timeout con reloj simulado y respuesta tardía; legacy y
drain independientes pasan.12/12 managed decoder; ambos TS compilan, C# compila y PowerShell
parsea. No transporte/Job/listener/WFP/pipe/render físicos ni QA formal. Helpers/script/pins
modificados exigen regeneración y admisión explícitas; nada activado.

Pendiente: candidato del servidor ORIGINAL del SDK y handshake antes de navegar; enlazar
observación/identidad/SID con cliente broker y confirmar política efectiva independiente,
incluyendo revalidación antes de autorizar. Snapshot no previene rebind y no certifica aislamiento.
CAP-02791.30% estimado parcial; siete98.76%, sin incremento por plumbing parcial.

## Observación acotada del listener poseído — corte posterior

OwnedRenderJob.ObserveOriginalLoopbackListener(expectedPort) utiliza el PID de su propio
CreateProcess y el handle retenido. Comprueba root vivo y pertenencia al Job Object concreto
antes y después de consultar GetExtendedTcpTable AF_INET/OWNER_PID_LISTENER. FILETIME del
handle debe conservar identidad. No abre un PID del documento ni toma su URL como prueba.
Devuelve únicamente FILETIME después de observar el socket: NO permiso ni lease durable.

Snapshot único de máximo4MiB y65536 filas: insuficiencia/carrera de tamaño/API error abortan,
sin retry ilimitado. Decoder exige TCP LISTEN, dirección literal127.0.0.1, puerto exacto en
orden de red y PID propio; rechaza wildcard/otro PID/puerto compartido/duplicado. Rechazo
conservador incluye listeners ajenos en otras interfaces con el mismo puerto. No soporta IPv6;
el SDK fijado bindea IPv4. Snapshot no garantiza que el socket sobreviva ni evita rebind posterior.

API todavía NO publicada por canal Job bridge ni conectada a candidato/ACK/controller.
No usar decoder puro como port de observación confiable. Falta revalidación al autorizar,
vinculación SID y política efectiva independiente; inventario/pins deben regenerarse antes
de cualquier futura admisión. Ningún canal ni worker fue activado.

Validación: test-owned-listener-decoder.ps1 compila tres helpers C# y ejecuta12 comprobaciones
managed con tablas fabricadas (incluye truncamiento y exceso de filas), sin invocar API nativa.
git diff --check sin errores de whitespace. No QA formal ni prueba física de socket/Job/WFP.
CAP-02791.30% estimado parcial; siete98.76%. No subir porcentaje por añadir utility/pruebas.

Referencias de contrato Win32: [GetExtendedTcpTable](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable),
[MIB_TCPROW_OWNER_PID](https://learn.microsoft.com/en-us/windows/win32/api/tcpmib/ns-tcpmib-mib_tcprow_owner_pid),
[TCP_TABLE_CLASS](https://learn.microsoft.com/en-us/windows/win32/api/iprtrmib/ne-iprtrmib-tcp_table_class).

## Identidad del productor poseído antes del HTTP — corte posterior

Se detectó un prerrequisito ausente: READY del bridge solo identificaba executionId, no el proceso
raíz. Sin PID+FILETIME obtenidos del owner no es seguro verificar el socket del servidor original
ni aceptar datos del HTML como alternativa. El SDK fijado anuncia localhost pero bindea 127.0.0.1;
esa declaración tampoco prueba ownership del socket en el host Windows.

`OwnedRenderJob.RootCreationFileTime()` consulta GetProcessTimes sobre el handle retenido; nunca
abre un PID declarado por documento. PowerShell bridge admite canal V4 solo con cuotas y token
AppContainer V5; READY añade rootIdentity PID/FILETIME decimal de ese owner. V1–V3 conservan formato.
Inventarios/pins de helper/script/compiled deben regenerarse explícitamente; nada se activa aquí.

TS bridge admite V4 únicamente cuando el operador suministra onOwnedReady. Rechaza metadata
no solicitada en legacy, identidad ausente en V4, valores inválidos y ejecución ajena. Callback
recibe copias de descriptor/workspace/identity, no código del documento. Empieza con root poseído
y se drena junto con colección ANTES de liberar ownership/fence, aun cuando el job productor
ya haya confirmado STOP/cierre. Fallo o hang de ese trabajo impide publicar/afirmar cierre completo.

Hook de identidad NO concede red, NO prueba root vivo ni socket/puerto/endpoint, y NO se conecta
todavía a un authorizeOriginalServer real. Sigue faltando canal de candidato/ACK antes de navegar,
verificación independiente del listener por proceso/SID/FILETIME/job, política efectiva del broker,
DLL/build/pins y aceptación física. No dar al renderer/HTML acceso directo al broker privilegiado.

Validación del corte: 22/22 Node bridge (incluidas V1–V3) y ambos builds TS pasan; helpers C#
compilan y PowerShell parsea. Transport/procesos/metadata simulados: GetProcessTimes no invocado,
ningún job/pipe/WFP/render físico ni QA formal. La identidad es un port obligation, no atestación
del OS inferida desde JSON. CAP-027 sigue91.30% estimado parcial; siete98.76% sin incremento.

## Corrección de arranque del productor — corte posterior

Inspección del SDK EXACTO 0.7.106 con SHA de fuente fijado identificó una contradicción previa:
launchBrowser no solicitaba pipe y Puppeteer usa debuggingPort=0 por defecto, conectando por
WebSocket TCP ANTES de initializeSession. DENY_ALL inicial bloquearía ese CDP; abrir únicamente
el HTTP original después no soluciona el arranque. No ampliar allowlist a todo loopback.

La extensión pasa a COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V5 (mismo SDK/source original).
Agrega dos hooks de opciones de launch a los seis existentes. En contexto observado fija pipe=true
y conserva el pipeline SDK completo de captura/media/audio/encode/mux. Fuera de ese contexto el
helper devuelve {}, conservando opciones upstream. Rechaza remote-debugging-* explícito, no abre
otro puerto, y errores quedan latched aunque SDK los absorba. Syntax/build no acreditan handles
efectivos ni funcionamiento en Windows/AppContainer.

Se descubrieron además flags upstream --no-sandbox, --disable-setuid-sandbox,
--disable-ipc-flooding-protection e IsolateOrigins/site-per-process en disable-features. La ruta
observada retira esos overrides, preservando los restantes (incluido audio/autoplay/color).
Rechaza nuevos bypass de web security/certificados/site isolation/single-process y no hace fallback
a desactivar sandbox si Chrome falla. Esto solicita protecciones por defecto, no prueba que sean
efectivas. Legacy conserva upstream y NO queda acreditado seguro por esta corrección.

Validación: 26/26 dirigidas (transform15+launch3+package8) pasan. Bytes upstream se reconstruyen
exactamente al retirar ocho hooks/wrapper; versión/SHA y packaging real se revalidan, sin escribir
node_modules. Función launch extraída del SDK transformado ejecutada con Puppeteer mock demuestra
opciones/orden, NO arranque de Chrome. Syntax check inicial bajo sandbox dio EPERM en spawnSync;
repetido con permiso local pasó, sin importar SDK ni lanzar navegador/render/WFP. No QA formal.

Recálculo estimado: identidad/ejecutor94→95 con peso15% (+0.15pp), por cerrar la contradicción
de transporte del código observado y sus overrides inseguros. NO por cantidad de tests ni prueba
de aislamiento. Resto89/89/90/95/94/75/95/99 con pesos10/10/15/10/15/10/5/10 sin cambio.
CAP-02791.15→91.30% parcial; siete (600+91.30)/7=98.7571%, mostrado98.76%. Restantes seis100%
registradas cada una/QA pendiente/sin reauditoría. No cierre R04 ni operación nativa acreditada.

Regenerar explícitamente paquete V5 y pins/inventario/config, no reutilizar baseline V4. Nada
activado. Sigue faltando transporte runtime, DLL compilada, política efectiva/ACL/handles reales,
conexión del HTTP original al broker y aceptación del corpus/DB. HyperFrames/CLI orientó inspección
sin sustituir el productor; no upgrade de SDK ni ejecución de render/check/preview.

## Invocación administrada ligada a ownership — corte posterior

`NetworkPolicyInvocation.cs` implementa el adaptador concreto que valida/fija buffers y llama
a NetworkPolicyLibrary.Apply. Parser administrado independiente coteja layout completo, versión,
owner provider/subcapa/lease/SID, generación/mode/family/port, claves únicas no nulas y longitud
exacta ANTES del native delegate. Reemplazo exige mismo owner y generación siguiente. Copias
congeladas evitan mutación del caller entre validación y marshalling. Resultado solo publica
Operation/RecordSha256 y scope OWNED_FILTERS_MATCH_NOT_EFFECTIVE_NETWORK_POLICY: no global PASS.

`composition-windows-network-owned-policy-invoker.ts` liga journal→encoder→managed invocation:
relee intención antes/después, coteja byte SHA y operación del resultado, owner exacto y prev/next
scope/lease/generación. Operaciones serializadas, deadline15s y cuarentena sin retry/reset. No
existe managed transport por defecto; el callback debe provenir del bridge admitido y autenticado.
NO implementar readEffectivePolicy devolviendo ese resultado owned-only como prueba global.

Config operatoria ahora V2: pin obligatorio de `invocation` junto a server/client/loader/DLL;
V1/cuatro archivos se rechaza, sin upgrade silencioso. Canal y record binario conservan sus V1
independientes. Regenerar explícitamente la configuración/pin; no existe instancia activa a migrar.
La búsqueda de toolchain no encontró vswhere en la ubicación estándar; C++ continúa sin compilar
en este entorno, no se instalan herramientas ni se sustituye SDK por headers inventados.

Validación del corte: C# loader+invocación compilan, 3/3 checks de parser/owner administrados,
8/8 Node (invoker3+host5) y ambos builds TS pasan. Filesystem/sync reales, managed transport y WFP
simulados en Node; checks C# solo validan bytes y NO llaman Invoke/LoadApproved/Win32. DLL no cargada,
pipe/WFP no ejecutados, sin instalación/activación/migración/QA formal. No cierre de aislamiento.
Faltan transporte runtime concreto, provisión de peers, build nativo, auditoría efectiva y wiring
del SDK/worker. CAP-027 mantiene91.15% estimado parcial; siete98.74% estimado.

## Preparación operatoria del host — corte posterior

`composition-windows-network-broker-configuration.ts` lee configuración estricta de 64KiB con
SHA esperado independiente. Fija binding/scope/nonce, provider/subcapa, root de journal, peers
PID/FILETIME decimal exacto/cuenta/logon y SHA/tamaño/ruta de server/client/loader/DLL. Rechaza
cuentas/logons/PIDs compartidos, overflow de SID/FILETIME, IDs nulos, rutas duplicadas/UNC y
campos extra. Revisa directorios/ancestros canónicos sin reparse y pins por handle de archivos
sin hardlinks; recheck antes y después del uso. No comprueba cuentas/processes efectivos todavía:
eso corresponde al canal nativo y launch owner. Hash no acredita código compilable ni ACL.

`composition-windows-network-broker-host.ts` prepara solo con lecturas. No crea journal, pipe,
DLL, servicio ni filtro y no llama factory/serve callbacks durante prepare. serveOnce es un
límite de ACTIVACIÓN explícito que no se ejecutó físicamente: rechecks de instalación, init
nativo lazy, journal→controlador→dispatcher, y exactamente un dispatch autenticado completado.
Reutiliza el controlador en tres sesiones máximas; concurrencia/error/ACK perdido/deadline
ponen cuarentena sin dispose/unload/reclaim automáticos. La señal del peer se combina con la
del host, nunca sustituye su deadline. No llamar serveOnce en producción sin aceptación nativa.

Los adaptadores concretos createNativePorts/serveAuthenticatedOnce siguen pendientes: deben
invocar DLL/C# reales y validar política efectiva; mocks o invocación directa de dispatcher no
son alternativas productivas. Config viene exclusivamente del operador, no del ZIP/documento;
datos PID/FILETIME requieren procesos/helper persistentes realmente poseídos, no self-report.
Esta composición NO registra servicio/worker ni activa V5 o permisos Windows automáticamente.

Validación del corte: 14/14 Node (host5+journal9), ambos builds TS y diff pasan. Filesystem/pins/
sync reales, autenticación/pipe/WFP simulados. Primer compile de tests detectó import no usado,
retirado; compilación final pasa. Sin C++/DLL/pipe/WFP físicos, instalación, migración o QA formal.
CAP-027 conserva91.15% estimado parcial; siete98.74% estimado. Falta ejecución del puente concreto,
build nativo, arbitraje/ACL/loader/proceso efectivos, corpus real y operación DB/entre hosts.

## Puente invocable C#↔C++ — corte posterior

CMake prepara una DLL bridge además de la biblioteca estática, sin ejecutable/servicio/install.
`NetworkPolicyExports.cpp` exporta CfnInvoke para tres operaciones explícitas (install-deny-all,
replace-owned y read-owned). Recibe dos buffers de hasta512 bytes, NO estructuras pointer-bearing
desde JSON. Parser limita lecturas/longitudes, versión, generación1–3/mode/family/port, SID ASCII,
4/9 claves y fin exacto. El núcleo nativo vuelve a validar SID/ownership/plan antes de APIs BFE.

`composition-windows-network-native-record.ts` serializa desde intención exacta del journal:
recompone plan, coteja SHA de bytes canónicos, keys y generación; provider/subcapa vienen de
configuración operatoria separada. Formato v1 LE: versión4, GUIDs Windows provider/subcapa/lease48,
generación8, digest32, mode1/family1/port2/SID-length2, SID ASCII, key-count2 y GUIDs16 por clave.
Sin rutas, URL, comandos de shell, capabilities o punteros. El checksum no convierte metadata
en atestación; lector del journal/autoridad del broker sigue siendo obligatorio.

`NetworkPolicyLibrary.cs` implementa carga/invocación EXPLÍCITA: Windows/x64, ruta absoluta DLL,
hash/tamaño fijados, rechazo de reparsepoints, handle de archivo abierto sin compartir write/delete
durante la vida de la librería y GetProcAddress de CfnInvoke. Dependencias solo System32, sin
PATH/CWD/fallback o cambios a search path. No se llamó LoadApproved/Apply: Add-Type solo compila,
y tests administrados solo preflight del envelope. Preflight NO valida todo el record: el parser
C++ y el encoder TS tienen responsabilidades distintas.

Runtime native es síncrono: deadline/quarantine pertenece al broker dueño; no simular cancelación
del kernel ni descargar DLL mientras una operación está activa. Unload no retira filtros/lease.
La provisión debe asegurar directorio inmutable con ACL correctas y cierre de dependencias;
hash/handle no prueban ACL, ni evitan por sí solos carreras de ancestros frente a writers privilegiados.
No aceptar path/hash de payload. Falta bootstrap y binding del broker, DLL compilada/link verificado,
auditoría efectiva del loader/arbitraje y mediciones físicas. ReadOwned NO equivale a readback global
de política efectiva: no fabricar WindowsNetworkNativePorts exitosos desde esos bytes declarativos.

Validación de este corte: encoder1/1, source5/5 (bridge2+política3), dos checks administrados de
envelope, C# compila y ambas compilaciones TS pasan. No C++ compilado ni DLL cargada/pipe/WFP
invocado. Sin instalación/activación/QA formal. CAP-027 conserva91.15% estimado parcial; siete98.74%.
[LoadLibraryExW](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-loadlibraryexw)
documenta búsqueda por ruta/flags; esa documentación no prueba el loader efectivo de este artefacto.

## Correlación del consumidor y recorrido software — corte posterior

`composition-windows-network-command-client.ts` conecta un transport obligatorio y autenticado
con el protocolo del dispatcher. Binding de canal/nonce/scope se clona y valida; no hay transporte
HTTP/default, replay/reconnect ni recuperación desde una respuesta declarativa. Cada request tiene
UUID propio y orden 1–3. Respuesta debe coincidir completamente con request/nonce/scope/comando/
sequence, generación contigua, persistencia, mismo lease tras primera fase y hash del plan esperado.
DENY y SEAL recomponen deny-all localmente. ALLOW recibe endpoint esperado desde observación
independiente del servidor original del HOST, nunca desde respuesta o HTML, y rederiva el SHA.

UTF-8/schema estrictos y 32KiB máximo. Deadline 15s incluye exchange/validación; aborto/ACK perdido/
response ajena deja RECOVERY_REQUIRED y prohíbe otra llamada. ACK tardío no avanza fase. Comando
concurrente/fuera de orden se rechaza antes del transporte. La schema de binding es compartida
para evitar contratos divergentes entre productor y consumidor.

Prueba dirigida recorre cliente→dispatcher→controlador→journal→puertos nativos SIMULADOS, tres
fases y diez entradas reales de journal (reserva1+intención3+observación3+comando3). Verifica plan,
generación y lease end-to-end del núcleo software, pero omite deliberadamente el pipe físico:
la invocación directa del dispatcher NO es un modo productivo de saltar autenticación.

Validación del corte: 11/11 Node (cliente5+dispatcher6) y ambas compilaciones TS pasan. Archivos
reales; exchange y WFP simulados. No se reejecutaron suites C#/C++ como si fueran parte de estas11.
Falta el bootstrap real del transport C# con pins de peers, traducción/invocación C++ y su build,
ownership del servidor original y auditoría de arbitraje/red; no se instala/activa nada.
CAP-027 conserva 91.15% estimado parcial, siete98.74%; esta integración software no cierra OS.

## Cliente y dispatcher — corte posterior

`AuthenticatedNetworkPipeClient.cs` comparte helpers con servidor mediante partial class.
ExchangeOnceAsync solo conecta al pipe local derivado de GUID operatorio; solicita derechos
individuales sin create-instance y nivel Identification, no impersonation/delegation. Verifica
PID servidor con GetNamedPipeServerProcessId, handle vivo, FILETIME, cuenta y logon exactos antes
de escribir y tras leer. Cuenta real del cliente debe coincidir con configuración y diferir de
broker. Presupuesto 15s, UTF-8/framing acotado, sin resend ni servidor/PID aprendido de respuesta.
Ningún ExchangeOnceAsync/ServeOnceAsync se ejecutó en este corte.

`composition-windows-network-channel-contract.ts` define comandos estrictos en orden único
DENY_BEFORE_START→ALLOW_ORIGINAL_SERVER→SEAL_AFTER_STOP. No hay comandos DELETE, endpoint, filtros,
paths o scripts en payload. `composition-windows-network-command-dispatcher.ts` coteja binding
scope/channelId/nonce/sequence operatorio antes de efectos y reserva comando exclusivo/sync en
journal antes de llamar al controlador. Replay se rechaza incluso tras recrear dispatcher con
mismo channelId. Respuesta vincula requestId/nonce/scope/orden/generación y mismo lease.
Budget incluye journal+controlador, y aborto no publica resultado tardío. Error tras admisión
de comando deja latch y registro, no retry/reclaim. Hay como máximo tres registros de comandos
por canal confiable; cambiarlos tras reinicio no está autorizado como estrategia de recuperación.

Dispatcher solo puede invocarse DESPUÉS de autenticación nativa del peer; no crea endpoint HTTP
ni recibe identidad peer declarada en JSON. Invocarlo directamente como RPC saltaría la frontera
y no es una integración permitida. Bootstrap/adaptador que vincule C#↔TS↔C++ siguen pendientes,
igual que validar correlación en consumidor de respuesta, pins y compilación/link C++.
El código de autenticación mutua está preparado, no demostrado en pipes físicos ni conectado
al worker/SDK. No aprobar aislamiento desde los tests o readback de metadata.

Validación: 15/15 Node dirigidas (dispatcher6+journal/conexión9), 5/5 framing administrados,
4/4 checks estructurales y ambas compilaciones TS pasan. Servidor+cliente C# compilan juntos.
Filesystem/sync reales y controlador/nativo simulados; sin pipe/Win32/WFP/C++ físicos ni QA formal.
CAP-027 conserva 91.15% estimado y siete 98.74% estimado hasta cierre de integración real.

[GetNamedPipeServerProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid)
permite obtener PID; FILETIME/token y el canal operatorio son controles adicionales del diseño,
no evidencia de identidad verificada en ejecución nativa.

## Servidor de canal local — corte posterior

`AuthenticatedNetworkPipe.cs` implementa servidor de una petición acotada para el futuro broker.
No se invocó ServeOnceAsync: compilación y framing no crean pipes, ACL, servicios o filtros.
El pipe requiere GUID de canal no vacío, primera instancia, handles no heredables, rechazo remoto,
DACL protegida con broker y logon cliente explícitos. Clientes reciben derechos individuales
0x120183, sin FILE_CREATE_PIPE_INSTANCE; no se usa la DACL por defecto ni GenericWrite. Broker
y cliente deben ser cuentas distintas y la cuenta real del broker debe coincidir con configuración.

Antes de leer payload valida GetNamedPipeClientProcessId contra proceso esperado vivo con handle
retenido, hora de creación FILETIME exacta, cuenta y logon SID. Repite verificación antes de dispatch
y respuesta. PID solo no basta. Launch owner debe pinnear/poseer ese proceso y suministrar estos
valores fuera del documento; no derivarlos de una petición de cliente. No impersonation ni
privilegios delegados al payload. Root cuenta/system y cuentas anónimas/package/capabilities no
son defaults; la política requiere provisión explícita de cuentas dedicadas compatible con BFE.

Framing uint32 LE, 1–32768 bytes, UTF-8 estricto sin NUL y una petición/respuesta. Presupuesto
conjunto 15s para connect/read/dispatch/write, señal propagada y respuesta tardía rechazada.
Una operación simultánea se rechaza antes de abrir; fallo después de empezar dispatch/ACK incierto
deja latch en el proceso broker, sin reset automático. Cierre de canal nunca libera lease/filtros.
Callback no cooperante se observa sin publicar resultado; outcome requiere reconciliación.

Esto NO cierra autenticación mutua: faltan cliente que verifique servidor/handle/creación/SID,
dispatcher de comandos con binding scope/nonce/lease/replay, bootstrap/pins y puente C++.
No conectar el worker a este servidor como si esos componentes ya existieran. El callback es del
host confiable, no el HTML; no hay endpoint registrado ni pipe físico abierto en este corte.

La [documentación de seguridad de pipes](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
explica los permisos por defecto y la colisión FILE_APPEND_DATA/FILE_CREATE_PIPE_INSTANCE.
[GetNamedPipeClientProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid)
devuelve el PID; las comprobaciones adicionales son decisiones de diseño y no prueban un canal vivo.

Validación de este corte: C# compila; 5/5 framing administrados, 3/3 source estructurales y
6/6 etapas/worker pasan. Ambas compilaciones TS pasan. Framing no invoca APIs Windows; source
checks no prueban autenticación física/ACL/timeout/concurrencia nativos. C++ sigue sin compilar;
sin pipe/servicio/WFP/migración/QA formal. CAP-027 conserva 91.15% estimado, parcial.

## Journal y conexión del núcleo — corte posterior

`composition-windows-network-journal.ts` reserva permanentemente el SID por archivo exclusivo,
independiente de tenant/executionId: otra instancia con el mismo root no lo reutiliza. Registros
exclusivos/sync/32KiB y lectura por handle/hash/identidad, sin overwrite, TTL, unlink o reclaim.
Archivo parcial/corrupto sigue reservado y exige operador. Requiere root canónico dedicado y
ACL de host confiable; no crea esas ACL ni acredita lock entre hosts/pérdida de energía/TOCTOU
frente a un escritor privilegiado. Registrar mode 0600 no acredita una DACL restrictiva Windows.

Cada intención conserva plan recompuesto contra scope, SHA y claves aleatorias de filtros ANTES
de escritura nativa. Solo admite tres generaciones: deny-all→loopback exacto→deny-all. La siguiente
intención exige observación exacta de la anterior; el archivo exclusivo del siguiente número
serializa writers cooperantes. Máximo siete archivos propios por SID reservado, sin progreso
indefinido. Observaciones ligan bytes de intención, claves, plan, lease y generación; son metadata
del broker, NO por sí mismas evidencia del kernel.

`composition-windows-network-journaled-ports.ts` conecta este orden al controlador TS:
reservar intención→native write→readback independiente→guardar observación→ACK. Reemplazo verifica
primero generación anterior en journal y backend. Lecturas efectivas siempre vuelven al backend:
no basta journal/caché. ACK perdido conserva intención sin marker; no reintenta ni recupera latest.
Una nueva instancia necesita reconciliación explícita, no resurrección desde metadata declarativa.
Errores controller/journal mantienen RECOVERY_REQUIRED/no retry en las etapas/worker y cleanup.

Todavía falta el transporte autenticado que invoque la biblioteca C++, su compilación/link,
pins y traducción exacta de provider/subcapa/generación/claves contra configuración operatoria.
Los puertos nativos siguen obligatorios y sin default; no se enlaza al worker activo ni se llama
BFE en este corte. El readback nativo debe auditar arbitraje/flujo/ownership, no devolver el plan
recibido como prueba de enforcement. Por tanto el aislamiento OS sigue sin cierre.

Validación del corte: 23/23 dirigidas (journal/conexión9, núcleo8 y etapas/worker6) pasan, junto
con ambas compilaciones TypeScript. Archivos/hash/sync/reservas reales y backend nativo simulado.
Las pruebas recorren controlador→journal→puertos nativos simulados→observación; no biblioteca C++,
BFE, canal/ACL, crash de máquina ni writer no cooperante. Sin instalación/activación/QA formal.
No aumentar la rúbrica de aislamiento hasta cerrar esa integración real.

## Extensión nativa preparada — sin compilación ni activación

La biblioteca `windows/network-controller/WfpNetworkPolicy.{h,cpp}` usa tipos y GUIDs oficiales
de Windows SDK, no layouts P/Invoke supuestos. CMake exige Windows/MSVC/x64/C++17, genera solo
biblioteca estática y no tiene instalación, servicio o ejecutable. No se invocaron sus APIs.

InstallInitialDenyAll, ReplaceOwnedPolicy y ReadOwnedPolicy implementan llamadas explícitas BFE:
sesión no dinámica, objetos provider/sublayer persistentes previamente provisionados, BLOCK
por SID de paquete exacto y capas CONNECT/RECV_ACCEPT v4/v6. No crea provider/subcapas ni hard
permits. Provider asociado a servicio o deshabilitado se rechaza; esta restricción es conservadora
y requiere revisar el modelo de provisión en el host separado, no cambiarlo aquí.

Reemplazo exige mismo provider/subcapa/lease/SID y generación siguiente. Verifica contenido
anterior por clave antes de retirar únicamente esas claves; agrega nuevos filtros, elimina
anteriores, verifica y commit en una transacción. Readback coteja flags persistentes, BLOCK,
capa/condiciones/SID y metadata lease/generación/SHA. Cierre de sesión/destructores no borran
filtros persistentes. Todo error, incluido commit/readback incierto, exige recuperación.

El caller debe reservar DURABLEMENTE SID y claves antes de cualquier escritura. Esta biblioteca
no implementa el journal/ACL/canal ni autenticación y no constituye el backend completo del
controlador TS. El digest lo aporta el broker confiable; la biblioteca no aprueba su origen.
Readback de filtros propios NO demuestra ausencia de overrides, flujos preexistentes, filtros
extraños ni política efectiva global. Falta auditoría de arbitraje, ownership del servidor,
reautorización, recuperación nativa e integración; por eso no se conecta al worker aún.

Validación del corte: 8/8 del núcleo TS reejecutadas y 3/3 checks de estructura del source pasan.
Estos tres NO compilan ni ejecutan C++. No hay Windows SDK, MSVC/clang/g++/CMake detectados en el
entorno; compilación/link nativos pendientes, sin instalar herramientas. Sin WFP físico ni QA
formal. El porcentaje conserva 91.15% estimado y el aislamiento permanece sin cierre.

Las condiciones dentro de un filtro son AND según [FWPM_FILTER0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmtypes/ns-fwpmtypes-fwpm_filter0).
La biblioteca conserva reglas separadas para los predicados prohibidos y las estructuras SDK de
[FWP_CONDITION_VALUE0](https://learn.microsoft.com/en-us/windows/win32/api/fwptypes/ns-fwptypes-fwp_condition_value0).
Referencias documentales no prueban que el artefacto compile o filtre tráfico.

## Corte implementado

`composition-windows-network-policy.ts` compila planes deterministas ligados a host, organización,
ejecución y SID privado AppContainer. Endpoints solo TCP con IP literal 127.0.0.1 o ::1 y puerto
exacto; no localhost, DNS, rangos, URLs, capabilities o allowlists del HTML. Hash vincula el plan
entero. Deny-all cubre CONNECT y RECV_ACCEPT IPv4/IPv6. Exact-loopback conserva deny-all en la familia
no seleccionada y separa cada predicado prohibido en una regla BLOCK independiente (OR), evitando
la fuga de combinarlos con AND. Recepción exige además peer loopback exacto. No emite hard-permit
para eludir la política de otros proveedores.

El plan no es un filtro WFP instalado ni prueba de enforcement. Traducción de ABI, arbitraje real,
flujos existentes, DNS/UDP/raw sockets/redirects/IPC/brokers y compatibilidad siguen pendientes.
Usar BLOCK no elimina por sí solo todos los conflictos de arbitraje del host.

`composition-windows-network-controller.ts` implementa el ciclo:

NEW → DENIED → LOCAL_ONLY → SEALED; cualquier resultado incierto → RECOVERY_REQUIRED.

Antes de arrancar, acquireAndDenyAll debe adquirir una reserva durable exclusiva del SID y aplicar
deny-all persistente. No hay backend por defecto. Cada ACK exige lease aleatorio propio, SHA exacto,
generación monotónica y persistent=true, seguido por readEffectivePolicy independiente de la
implementación de escritura. La apertura toma el endpoint de resolveOriginalServer del HOST, no de
un parámetro de HTML/cliente. replaceAtomically debe usar CAS y transacción nativos. No se admite
readback más nuevo que el ACK ni uno de otra reserva.

Seal restaura deny-all y solo declara SEALED tras observación del job cerrado, cero procesos y
executionId/lease exactos. No borra reglas ni libera reserva, incluso en éxito; retiro/reconciliación
operativa es independiente. ACK perdido no reintenta ni deshace; deja RECOVERY_REQUIRED. Concurrencia
en una instancia se rechaza antes del await. Exclusividad entre instancias/reinicios corresponde
al backend durable, aún no implementado. Operaciones tienen deadline común de 15s, propagación de
aborto y rechazo de ACK tardío aunque un puerto ignore la señal.

## Frontera de confianza y siguiente bloque

Los puertos son callbacks del host confiable: todavía NO son un protocolo RPC seguro ni servicio
Windows instalado. No exponerlos al worker restringido o al HTML. Un JSON/readback simulado no es
atestación del kernel. El adaptador nativo y el canal deben implementar:

- Autenticación local de identidad y ACL del canal, límites y rechazo de clientes no provisionados.
- Reserva durable exclusiva por SID, recuperación tras crash sin reasignación automática y CAS.
- Filtros persistentes con transacción/rollback ante error; snapshot efectivo leído desde BFE,
  no desde el payload recibido ni desde una caché del controlador.
- Propiedad real del servidor original y vinculación exacta antes de navegar; el bootstrap del SDK
  debe poder crear/bindear su servidor mientras todavía no puede conectar a destinos arbitrarios.
- Confirmación física del job y arbitraje efectivo del host, incluida reautorización de flujos.
- Pérdida de controlador/reinicio/aborto: no retirar protección mientras sobreviva una ejecución.

No se conecta aún al bridge/SDK ni se altera V5: hacerlo sin estos puertos nativos daría una falsa
garantía de aislamiento. El build operativo incluye el controlador para el desarrollo posterior.

## Fundamento del diseño

Las [sesiones dinámicas WFP](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management)
eliminan sus objetos al terminar; se exige vida persistente, no cleanup implícito como única
protección. La elección es una decisión arquitectónica, no validación de política efectiva.
El [arbitraje de filtros](https://learn.microsoft.com/en-us/windows/win32/fwp/filter-arbitration)
requiere revisar subcapas, pesos y decisiones de otros proveedores. Los permisos del controlador
son independientes del worker conforme al [control de acceso de BFE](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control).

CAP-027 conserva 91.15% estimado: núcleo y planes no cierran frontera OS. Siete 98.74% estimado;
otras seis 100% implementación registrada cada una, QA pendiente. Sin instalación/activación,
WFP/Win32 físico, servicios/perfiles/firewall modificados, migraciones o QA formal.

Validación: 8/8 pruebas dirigidas del compilador/controlador y ambas compilaciones TypeScript
pasan. Evalúan reglas declarativas y ciclo con backend simulado; no filtros WFP instalados,
seguridad del canal, reserva durable entre procesos ni tráfico físico. No sustituir estas
pruebas por la aceptación del adaptador nativo. Diff sin errores de whitespace.
