# CAP-027 — ruta de cierre de implementación

## Estado actual autoritativo — entrega diferida a conformidad (2026-10-08)

**CAP-027 ~91% (rúbrica 91.15%) parcial; siete ~98.74%, sin incremento.** Se cerró en código
la conexión opt-in checkpoint consumido→entrega intermedia→reserva del job futuro, pero PostgreSQL,
concurrencia y migración siguen sin verificar/aplicar. No se concede cierre operativo por SQL
preparado. Seis CAP-004/009/010/017/023/026100% implementación registrada individual, QA pendiente
sin nueva reauditoría; R04 parcial y objetivo activo. Cortes inferiores históricos.

El job de conformidad nace desde integridad posterior a subida/finalización, no durante el render.
La opción operatoria deferConformanceReservation=true, default apagado, publica metadata exacta
sin jobID inventado/lease/ruta local antes de subir/finalizar y después de admisión CONSUMED.
Checkpoint y selección de referencias son obligatorios antes de consumir. El RPC de entrega está
acotado a 15s cooperativos/señal del dueño; ACK perdido retiene checkpoint/render y exige recuperación,
sin cancelar autoridad consumida ni admitir salida nueva. resume sin checkpoint no puede saltarse
este gate. resumeCheckpoint consulta primero historia consumida y verifica recibo exacto; solo
historia indisponible permite comprobar la admisión original pendiente, no revocación/cambio/ajeno.

Migración preparada 20261008220000: outbox privado/RLS/CAS inmutable por request, autoridad/recibo/
contrato/referencias exactas y revocación; serialización mediante lock de request NO KEY UPDATE.
Job-first y outbox-first reutilizan register de reserva existente en la transacción. Hash del
manifiesto por job es de SUS bytes JSONB, no del outbox; tamaño futuro se comprueba antes de guardar
para evitar una entrega que impida crear el job. No latest/backfill/overwrite/QA approval.
No mezclar publicador manual y outbox para la misma request; serializers pueden producir CAS distinto.

**56/56 dirigidas:** autoridad/firmas/checkpoint/upload46, lectores3 y checks estructurales SQL7.
Ambos compiladores TS pasan; filesystem/hash/Ed25519 reales y DB/storage/render simulados. Checks
SQL no prueban sintaxis/permisos/ejecución/carreras en PostgreSQL. Primera corrida de journal bajo
sandbox rechazó acceso realpath; repetida con permiso local pasó. Prueba inicial detectó segunda
RPC de consume al resumir; recuperación-first la elimina para historia disponible, sin relajar tests.
No activación, DB/migración, SDK/browser/render físicos, QA formal o despliegue.

Detalle y aceptación pendiente: [entrega de render](SOFLIA_ENGINE_CAP027_RENDER_OUTBOX_HANDOFF.md).
AppContainer/red/loopback, corpus/color/A-V/procedencia y operación DB/cross-host siguen abiertos.

## Estado actual autoritativo — ruta AppContainer opt-in (2026-10-08)

**CAP-027 ~91% (rúbrica 91.15%) parcial; siete ~98.74%, sin incremento.** La ruta nativa
AppContainer se implementó pero no se considera cierre de red: no se ha demostrado compatibilidad
SDK/loopback ni política efectiva/provisión del host. Seis CAP-004/009/010/017/023/026 conservan
100% implementación registrada individual, QA pendiente/sin nueva reauditoría. Este corte
sustituye los inferiores; objetivo activo y R04 parcial.

`WINDOWS_APPCONTAINER_NO_NETWORK_V5` es alternativa operatoria estricta, no downgrade ni cambio
automático de V4. Requiere SID privado de paquete, desktop, cuotas, listas ACL y límites de árbol;
rechaza capabilities/restrictingSid/campos extra. `OwnedRenderAppContainer.cs` usa startup extendido
con SECURITY_CAPABILITIES de count cero y SID exacto; hijo suspendido se asigna al job y se comprueba
su token real: AppContainer, no elevación, capacidades vacías, SID exacto e integridad baja. Se usa
ese token del hijo para ACL/subárboles antes de ResumeThread. Fallos no relanzan con token normal.
Helpers/pins admitidos, factory, configuración, bridge y puertos de medición transportan V5;
los inventarios previos deben regenerarse explícitamente por el operador.

**159/159 dirigidas +5/5 límites administrados** en este corte: bridge/font/schema45, job/reserva/
owned/silencio75, factory/reference/ports21, estructura nativa12 y configuración6. Build operativo
y compilación habitual de tests pasan; C# compila y PowerShell parsea. Estructura nativa es inspección
de código, no Win32/AccessCheck/token/filtro real. Los checks administrados no invocan APIs nativas.
Pruebas de transporte ejecutan procesos simulados y archivos/hash reales. Un intento del script
administrado con Windows PowerShell fue rechazado por execution policy; pasó en el shell habitual
sin modificar dicha política. No sumar este corte a históricos como una única suite reejecutada.

No se crearon perfiles, excepciones loopback, ACL/etiquetas MIC, reglas WFP/firewall o desktops;
no se ejecutó AppContainer, navegador, SDK/render físico, migraciones, QA formal o despliegue.
La provisión loopback por paquete no demuestra exclusividad del puerto del render. AppContainer
sin capacidades no acredita por sí solo política efectiva/descendientes/proxies/IPC/brokers del
host. Integridad baja puede afectar escritura/desktop/Chromium; no se desactivan sus protecciones
para hacer pasar el pipeline. TEMP/perfil deben verificarse físicamente sin ampliar escritura.

Contrato, límites y aceptación: [frontera Windows](SOFLIA_ENGINE_CAP027_WINDOWS_NETWORK_BOUNDARY.md).
Permanece pendiente enforcement/provisión de red compatible con el pipeline completo; corpus/
color/A-V/procedencia y operación DB/cross-host no se cierran por este desarrollo.

## Estado actual autoritativo — defensa HTTP de la página original (2026-10-08)

**CAP-027 permanece en 91.15% estimado parcial (~91%); siete ~98.74%.** No se concede
crédito de aislamiento OS por interceptar solicitudes de una página. CAP-004/009/010/017/023/026
conservan 100% de implementación registrada cada una, QA pendiente y sin nueva reauditoría.
Este corte sustituye los inferiores; no cierre R04 ni objetivo completado.

`original-session-network-guard.mjs` se conecta obligatoriamente a cada sesión del bootstrap
observado antes de recorder/captura nativa y de la navegación del productor. Usa el CDP cacheado
original, no otra página ni modificaciones del SDK instalado. El código upstream admitido
0.7.106 crea ese CDP con page.createCDPSession(); initializeSession recibe el hook como primera
instrucción. El servidor de archivos de render anuncia localhost con puerto dinámico, por lo
que NO se sustituye su URL por una composición/pipeline artificial.

Se admite únicamente origen HTTP loopback canónico con puerto explícito provisto por la sesión
SDK; cada Fetch.requestPaused comprueba protocolo, origen/puerto/credenciales y GET/HEAD sin
cuerpo. Otro origen/puerto, URL externa, mutación o cuerpo se bloquea con Fetch.failRequest y
deja un fallo persistente aunque el SDK absorba el error. Deshabilita caché y bypass de service
workers antes de habilitar Fetch en fase Request. 128 solicitudes pendientes, 100000 eventos
totales y URLs de 8192 bytes acotan recursos; desbordamiento deja peticiones pausadas y rechaza
el resultado, sin continuar ni truncar. Los errores propios no incluyen URLs ni detalles CDP.

Las comprobaciones se esperan antes/después de cada callback y antes de aceptar el resultado.
Cleanup espera ACK de comandos en vuelo, retira solo su listener y NO llama Fetch.disable ni
detach: reabrir la red antes del cierre del dueño sería inseguro. Rechazo tardío durante cleanup
también invalida el resultado; cierre nativo se intenta aunque falle cleanup de red.

**Límites explícitos:** defensa HTTP de esta página, NO sandbox de red, DNS pinning, cobertura
de WebSocket/WebRTC/otros targets/workers/procesos ni firewall. localhost conserva resolución del
host; aislamiento OS y provisión segura del host siguen pendientes. Service-worker bypass no
detiene sus conexiones independientes. Configuraciones/inventarios antiguos deben regenerar sus
pins para el driver y módulo nuevos; no hay actualización silenciosa de pins ni activación.
Assets externos dejan de admitirse por esta ruta: deben materializarse en el paquete aprobado;
no se añade allowlist externa, proxy o excepción desde HTML. Compatibilidad física con navegador
y SDK permanece sin acreditar. Logs upstream no se consideran sanitizados por este helper.

Validación de esta iteración: 20/20 checks de guard/transformation +13/13 integración con productor
simulado y fixtures reales, incluido rechazo externo antes de encoder/sin recibo nativo.
No sumar a los 165 históricos como una
suite única reejecutada. Sin navegador/render físico, Win32, QA formal, migraciones o despliegue.
Protocolo: [Fetch](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/),
[Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/).
Siguiente cierre obligatorio: enforcement de red Windows compatible con el servidor original;
permanecen pendientes corpus/color/A-V/procedencia y operación DB/cross-host.

## Estado actual autoritativo — auditoría ACL acotada de subárboles (2026-10-08)

**CAP-02791.0→91.15% estimado parcial (~91.2%)**: identidad/ejecutor93→94, peso15%, +0.15pp
por integración de auditoría de descendientes y límites; no provisión/enforcement físico acreditado.
Resto de bloques/pesos sin cambios. Siete `(600+91.15)/7=98.735714%`, **~98.74% estimado**.
CAP-004/009/010/017/023/026100% implementación registrada cada una, QA pendiente/sin reauditoría.
Este corte sustituye todos los inferiores. No cierreR04 ni objetivo completado.

Nueva política operatoria explícita `WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4` conserva SID/cuenta/desktop,
cuotas y listas readonly/denied, pero exige `treeAudit` estricto con maximumEntries entero1–50000,
maximumDepth entero1–64 y timeoutMilliseconds entero100–60000. Nada de defaults/skip/truncado;
política V3 root-only se conserva y no recibe cobertura V4 retrospectiva. Límites compartidos por
todos los subárboles, raíz depth0, visita duplicada/overlap/ruta>4096/reparsepoint/error/agotamiento
rechaza antes de CreateProcessAsUser sin downgrade. Config pin/factory/bridge/puertos transportan
política/límites exactos; PowerShell valida campos/rangos y llama StartWithAclTreePreflight.

Auditoría nativa recorre readonly y denied bajo identidad del supervisor para enumerar, pero cada
AccessCheck usa clon del token reducido del hijo. Readonly directories requieren read/execute y
archivos read; ejecutable principal conserva read/execute. Todos rechazan derechos individuales de
modificación, incluidos ownership/DACL. Denied descendientes rechazan read-data/execute y modificaciones,
no se infiere denegación de hijos desde LIST_DIRECTORY del padre. ValidateAclProbePath se aplica
a cada entrada y ancestros; enumeración streaming acotada se ordena y repite al regresar de cada
directorio. Cambios de nombres/cantidad/errores invalidan el preflight. Chequeos de tiempo entre
operaciones incluyen visitas/enumeración; NO timeout duro que pueda interrumpir APIs nativas/I/O.

**Límites residuales:** enumerar dos veces detecta algunos cambios, no sustituciones bajo el mismo
nombre ni cambios de DACL después del chequeo. No retiene handles de identidad de cada objeto ni
certifica filesystem inmutable. Debe provisionarse instalación protegida, cuenta/capacidad dedicada,
ACL/ownership mínimos y auditoría de recursos fuera de listas; no root/whole-disk concesiones.
V4 puede rechazar una instalación grande/inconsistente y exige dimensionar límites por inventario,
no subirlos sin medir costo. Un preflight positivo aún no demuestra red/IPC/MIC/descendientes futuros
seguros. No se crearon ACL, desktops, cuentas, archivos productivos ni reglas de firewall.

**165/165 pruebas dirigidas +5/5 checks administrados de límites**: suite principal121 (job56,
reserva3, silencio4, owned12, bridge18, schema4, fonts22, owned-temp2), factory/runtime/bootstrap19,
configuración6, puertos10, estructura nativa9. Ambos compiladores TS pasan; C# compila/PowerShell
parsea sin AccessCheck/Win32/process launch. Script test-composition-acl-tree-budget.ps1 verifica
count/depth/duplicados case-insensitive/enumeración real acotada/expiry sobre objetos de test por
reflection; no llama auditoría de acceso/token. El test expiry altera solo readonly field de su
instancia de test para no dormir; no habilita overrides en producción. Transporte de guardV4 usa
procesos simulados. No QA formal/DB/SDK/decoder físico ni enforcement ACL acreditado.

Provisión pendiente: regenerar hashes/inventario/pin de los helpers y configuración, preparar ACL
read/execute vs workspace-only write, desktops/capacidad privados y probar acceso real/negativo/
concurrencia/cleanup. Siguiente unidad: aislamiento de red compatible con el pipeline original,
sin afirmar sandbox por test de protocolos. Corpus/color/A-V/procedencia y operación DB/cross-host
siguen abiertos; sin activaciones, migraciones aplicadas o despliegue.

## Estado actual autoritativo — preflight ACL sobre token reducido (2026-10-08)

**CAP-02790.85→91.0% estimado parcial**, identidad/ejecutor92→93/peso15%, +0.15pp por integrar
verificación de accesos declarados antes del arranque; no por provisión/QA/enforcement acreditado.
Otros bloques/pesos sin cambios; siete `(600+91)/7=98.714286%`, **~98.71% estimado**.
CAP-004/009/010/017/023/026100% implementación registrada cada una, QA pendiente/sin reauditoría.
Este corte sustituye todos los inferiores. No cierreR04/productivo, objetivo activo.

Política adicional operatoria `WINDOWS_LUA_ACL_PREFLIGHT_V3` exige capacidad restrictora y desktop,
`readOnlyPaths` y `deniedPaths`: cada lista1–32 rutas absolutas/canónicas/noUNC/noNUL sin duplicados,
ni conflicto exacto entre listas. Política faltante/cambiada/campos extra rechaza; no fallback a
SID-only. Conserva cuotas explícitas, pin JSON y límites del canal; listas largas pueden superar
64KiB y rechazar antes de spawn, no truncarse. Factory/puertos/reserva propagan todo exactamente.
Native valida rutas y ancestros existentes sin reparsepoints, rechaza entradas ausentes/desconocidas.

`OwnedRenderAccess.cs` separa la responsabilidad de preflight en partialclass. Duplica el token
reducido ya verificado a impersonación; obtiene owner/group/DACL con GetNamedSecurityInfo y usa
AccessCheck con máscaras específicas/mapping de archivos y bufferPrivilegeSet acotado. API fallida
no equivale a denegación segura. Comprueba workspace READ|WRITE y ejecutable READ|EXECUTE; ejecutable
y objetos readOnly no pueden tener derechos individuales write/append/EA/attributes/deletechild/
delete/WRITE_DAC/WRITE_OWNER. Objetos denied rechazan individualmente READ_DATA, EXECUTE y cada derecho
de modificación: no se usa rechazo de máscara conjunta como prueba de rechazo de cada derecho.
Preflight ocurre sobre el mismo token primario que se pasa a CreateProcessAsUser, antes de crear
hijo suspendido; error impide esa llamada. Buffers/descriptores/clon se liberan; no escribe ACL.
Referencias: [AccessCheck](https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-accesscheck),
[derechos de archivos](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights).

Helper nuevo es obligatorio en inventario de host/mediciones/factory, además de OwnedRenderJob.cs;
PowerShell compila ambos juntos. Fixtures de integración actualizados, no relajación de admisión.
Inventario que omite OwnedRenderAccess.cs se rechaza antes de procesos. No modificar pins antiguos
para conservar un estado “verde”: operador debe regenerar instalación/inventario/JSON de esta versión.

**Límites:** preflight de objetos declarados NO prueba todos sus descendientes/herencia/otros recursos
ni elimina TOCTOU entre lectura de DACL y uso. No prueba MIC/SACL/red; datos actuales de nombre no
equivalen a handles inmutables. Denegar LIST_DIRECTORY/TRAVERSE de un padre no demuestra denegación
de archivos conocidos debajo (SeChangeNotifyPrivilege permanece). Declarar roots sin recorrerlos
no acredita árbol readonly. ACL deben provisionarse/auditarse por cuenta/capacidad/carga dedicada,
revisando ownership, descendants, reparsepoints y cambios concurrentes, sin concesiones amplias.
Workspace RW no es prueba de que padre o perfil del supervisor estén denegados. La política anterior
V1/V2 no gana preflight automáticamente ni puede presentarse como aislamiento completo.

**163/163 dirigidas**: job56, reserva3, silencio4, owned12, bridge18, schemaSID/ACL3, fonts22,
owned-temp2, factory4+7, runtime5, bootstrap3, configuración6, puertos10 y estructura nativa8.
Build operativo y compilación habitual tests pasan; C# de ambos helpers compila y PowerShell parsea
sin invocar AccessCheck/Win32. Las pruebas de kernel son checks estructurales/bridge simulado;
no AccessCheck físico, ACL creadas, SDK/decoder físico, QA formal, DB/migración/flags/despliegue.
Config/puertos usan archivos reales y ejecutan fixtures fuera del sandbox para realpath.

Próximo: provisión/verificación más completa ACL y aislamiento de red; corpus/color/A-V/procedencia
y operación DB/cross-host pendientes. No activar V3 sin auditar/provisionar y verificar físicamente
los accesos de cada rol: una configuración válida no certifica seguridad del host.

## Estado actual autoritativo — temporales propios por operación (2026-10-08)

**CAP-02790.85% estimado parcial conservado; siete~98.69%.** CAP-004/009/010/017/023/026:
100% implementación registrada cada una, QA pendiente. Este corte sustituye a los inferiores.
Avance funcional: bridge y driver decoder ya no heredan TEMP/TMP/TMPDIR del supervisor. No nuevo
crédito ponderado: resuelve un prerequisito del bloque token/ACL ya parcialmente contabilizado,
sin cerrar confinamiento ACL/red o demostrar enforcement físico. Objetivo activo/R04 parcial.

`createControlledProcessEnvironment` admite directorio temporal operatorio propio; exige ruta
absoluta/canónica sin NUL/UNC, reemplaza todos los alias TEMP/TMP/TMPDIR y conserva allowlist sin
credenciales, sin mutar source. Llamadas Windows usan launch.directory; decoder usa su spool propio.
Ruta nativa con desktop/token reducido comprueba los tres alias exactamente contra directory antes
de crear Job/proceso: invocación directa con temporales compartidos rechaza, no cae al entorno normal.
No crea rutas arbitrarias ni concede permisos. Sin argumento mantiene compatibilidad en consumidores
legacy; no se declara cerrado su confinamiento. Subprocesos SDK que usan ese entorno heredan los
alias, pero falta demostrar físicamente que todas las librerías respeten estas variables.

El directorio es propiedad de la operación, no un subdirectorio preprovisionado nuevo. La capacidad
restrictora necesita ACL mínima de escritura únicamente allí (además de las lecturas autorizadas).
Archivos temporales inesperados siguen sujetos a la política existente: no limpieza recursiva ni
borrado oculto; pueden impedir cleanup y exigir reconciliación operatoria. No conceder escritura
al directorio padre compartido/perfil del supervisor por compatibilidad. No basta fijar TEMP para
impedir acceso a otras rutas/red. Auditoría/provisión de ACL, aislamiento de red y validación
Node/Chromium/FFmpeg/IPC continúan pendientes; ninguna ACL o variable global del sistema modificada.

**136/136 dirigidas**: job56, reserva3, silencio4, owned12, bridge18, deadlines/environment6,
owned-temp2, factory4+7, runtime5, bootstrap3, estructura nativa6 y puertos10. Puertos comprueban
TEMP/TMP/TMPDIR tanto en bridge como decoder simulados con archivos/hash reales. Build operativo y
compilación habitual tests pasan; helperC# compila sin invocar funciones nativas. Sandbox realpath
requiere ejecución de fixtures fuera del sandbox; no Win32/SDK/render ni QA formal ejecutados.
Antes de operar, regenerar pins/inventario de código cambiado; no activación/migración/despliegue.

## Estado actual autoritativo — SID restrictor y segundo control ACL (2026-10-08)

**CAP-02790.70→90.85% estimado parcial (~90.9%)**: identidad/ejecutor91→92, peso15%, +0.15pp
por ruta del SID restrictor integrada y verificada estructuralmente, no por ACL provisionada o QA.
Otros bloques/pesos sin cambio; siete `(600+90.85)/7=98.692857%`, **~98.69% estimado**.
Seis CAP-004/009/010/017/023/026100% implementación registrada cada una, QA pendiente; no reauditoría.
Este corte sustituye los inferiores; R04 no cerrado, objetivo activo.

Política adicional explícita `WINDOWS_LUA_RESTRICTING_CAPABILITY_V2` en reducedToken exige desktop
no predeterminado y `restrictingSid` canónico de capacidad `S-1-15-3-1024` seguido de ocho uint32.
No acepta Everyone/Users/cuentas, ceros iniciales, saltos de línea, overflow, lista o SID ausente;
no admite fallback. Esta forma no prueba que la capacidad sea privada/no reutilizada: operador debe
derivar/provisionar una capacidad propia con segregación de host/carga/tenant y proteger el JSON/pin.
La política anteriorV1 sigue explícita sin reclamar confinamiento ACL. Ambas requieren cuotas.

Configuración/pin/factory/puertos transportan el SID exacto en canalV3. PowerShell valida política,
campos y SID antes de llamar exclusivamente `StartWithRestrictingSid` para V2. Helper convierte SID,
aplica DISABLE_MAX_PRIVILEGE|LUA_TOKEN con un SID_AND_ATTRIBUTES de atributos0 y RestrictedSidCount1;
no usa WRITE_RESTRICTED ni SANDBOX_INERT. Antes de CreateProcessAsUser, lee TokenRestrictedSids y exige
exactamente un SID igual al esperado; acota buffers y punteros/subautoridades antes de APIs nativas.
Si un token primario ya restringido causa intersección vacía o distinta, rechaza: no vuelve a V1.
Memoria SID y arrays liberados en todas las ramas; conserva verificación privilegios/elevación,
cuotas/readback, create suspendido, assign-before-resume y cierre confirmado anteriores.

Windows evalúa permisos de los SIDs ordinarios y de los restrictivos: ambos deben autorizar acceso.
[Microsoft: tokens restringidos](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens),
[CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken).
**No se provisionaron ACL ni se acredita confinamiento efectivo.** Deben concederse permisos del
SID de capacidad solo a instalación/dependencias/fonts de lectura-ejecución y entradas inmutables,
workspace/spool/TEMP dedicado de escritura, y escritorio/objetos IPC necesarios con derechos mínimos.
No conceder capacidad a disco raíz, perfil del supervisor, secrets, journal/fence/credenciales o
otros tenants. Revisar herencia/reparsepoints, recursos sin DACL y objetos compartidos. Falta cerrar
la generación/verificación de esa provisión; agregar un SID al token no es una allowlist de rutas.
No modifica cuenta, grupos, ACL, desktop, registry/firewall ni configuración de seguridad del host.
Puede impedir Node/Chromium/FFmpeg sin provisión correcta: no arreglar con permisos amplios/fallback.

**135/135 dirigidas**: bridge18, schemaSID2, runtime5, bootstrap3, factory4+7, puertos10,
configuración6, owned12, job56, reserva3, silencio4 y estructura nativa5. Bridge/decoder simulados,
checks estructurales no prueban AccessCheck/kernel ni red. Compilación operativa y habitual tests
pasan; TS2339 ajeno de CAP-029 ya no reaparece en este corte, sin modificación nuestra de CAP-029.
C# compiló y PowerShell parseó sin invocar funciones nativas. Revalidación de archivos/realpath
fuera del sandbox no cambió ACL ni arrancó render/worker. QA formal/DB/SDK/Win32 físico diferidos.

Provisión pendiente: regenerar hashes/inventario del helper/script/compiled y nuevo JSON confiable;
auditar ACL mínimas y desktop para capacidad/cuenta dedicada, demostrar lectura/escritura permitida
y denegada +descendientes/IPC/cleanup. Próximo: verificación/provisión de ACL y aislamiento de red;
corpus/color/A-V/procedencia y operación DB/cross-host siguen abiertos. No activación, despliegue,
migraciones aplicadas ni cierre productivo acreditado.

## Estado actual autoritativo — token LUA reducido explícito (2026-10-08)

Sustituye los cortes inferiores: **CAP-02790.55→90.70% estimado parcial (~90.7%)**,
identidad/ejecutor90→91, peso15%, +0.15pp por integrar reducción de privilegios sin fallback.
Otros bloques/pesos sin cambios; siete `(600+90.70)/7=98.671429%`, **~98.67% estimado**.
CAP-004/009/010/017/023/026100% implementación registrada cada una, QA pendiente, sin reauditoría
completa. No cierreR04 ni equivalencia con evidencia física/tiempo restante.

`reducedToken` operatorio opcional exige `{policy: WINDOWS_LUA_NO_PRIVILEGES_V1, desktop}` y
resourceLimits explícitos. Desktop requiere estación\\escritorio ASCII acotados, distinto de default
sin importar mayúsculas; rechaza newline, campos extra y políticas desconocidas. JSON estricto/pin,
factory de productor y mediciones/reserva propagan la misma configuración. Bridge la valida/clona
antes de spawn y selecciona canalV3; V1/V2 conservan compatibilidad sin afirmarse restringidos.
PowerShell valida campos/rangos nuevamente y V3 llama exclusivamente `StartReduced`, sin downgrade.

Helper abre el token primario del bridge con derechos mínimos para query/duplicate/assign; llama
CreateRestrictedToken con DISABLE_MAX_PRIVILEGE|LUA_TOKEN, nunca SANDBOX_INERT. Verifica TokenElevation0,
TokenHasRestrictions nozero y inventario de privilegios acotado a cero o solo SeChangeNotifyPrivilege
por LUID real. Crea hijo suspendido usando CreateProcessAsUser y escritorio operatorio, sin herencia
de handles y con entorno allowlist. Cuotas se configuran/releen antes; assign Job antes de resume.
Falla token/readback/CreateProcessAsUser rechaza sin ejecutar CreateProcess normal en esa rama.
Handles/buffers del token se liberan en éxito/fallo. No credenciales alternativas ni elevación.

**No sandbox completo:** no añade lista de SIDs restringidos, AppContainer, baja integridad ni
allowlist de archivos/red. La cuenta mantiene accesos ordinarios permitidos por sus grupos/DACL.
Un nombre no demuestra escritorio privado ni ACL segura: operador debe provisionar escritorio
no compartido con otras cargas/tenant, estación apropiada, permisos mínimos y cuenta dedicada.
CreateProcessAsUser puede requerir SeIncreaseQuotaPrivilege; ausencia rechaza, no se concede aquí.
No se modificaron cuentas, permisos, desktops ni políticas del sistema. Referencias primarias:
[tokens restringidos](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens),
[CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken),
[CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw).

**132/132 dirigidas**: bridge18, runtime5, bootstrap3, factory4+7, puertos10, configuración6,
owned12, job56, reserva3, silencio4, estructura nativa4. Token/Win32/procesos simulados o checks
estructurales no demuestran enforcement real. Archivos/hash/SSIM/firma de fixtures conservan su
evidencia acotada. C# compiló y PowerShell parseó sin invocar nativo; build operativo TS pasa.
Primera compilación habitual tests pasó; recompilación final falla en CAP-029 ajeno:
html-editing-geometry.test.ts82 TS2339 maximumSvgNumericTokens ausente. No corregido ni omitido
silenciosamente; los tests emitidos actualizados de CAP-027 ejecutados pasan. Config/puertos
requieren permisos fuera del sandbox para realpath, sin arranque de procesos nativos.

Provisión no ejecutada: antes de V3 regenerar inventario/hash del helper/script/compiled y JSON
confiable; preparar cuenta/escritorio/ACL/red, auditar compatibilidad Node/Chromium/FFmpeg y probar
privilegios reales/descendientes/fallos/cleanup. Siguiente: confinamiento de archivos y red; corpus/
color/A-V/procedencia y operación DB/cross-host siguen abiertos. QA formal/migraciones/despliegue/
flags diferidos. Objetivo activo, no preparación productiva acreditada.

## Estado actual autoritativo — cuotas explícitas y hard cap CPU Windows (2026-10-08)

Este bloque sustituye los porcentajes y pendientes de los cortes inferiores, que son históricos
aunque su título anterior diga «vigente». CAP-027 **90.4 → 90.55% estimado, parcial (~90.6%)**:
identidad/ejecutor89→90 con peso15%, incremento0.15pp por cuotas explícitas y hard cap CPU integrado.
Resto de bloques/pesos sin cambios. Media de siete `(600+90.55)/7 = 98.65%`, **~98.65% estimado**.
CAP-004/009/010/017/023/026 conservan100% implementación registrada individual, QA pendiente;
no reauditoría completa ni nuevo cierreR04. La estimación no mide tiempo restante ni QA aprobada.

El ejecutor y bridge aceptan un workspace mínimo `{directory}`. Cada medición posee su propio
spool: nunca consulta/copia entryPath, receipt o workspace temporal del productor. El factory
de mediciones deja de pasar ese workspace. `createWindowsReservedConformancePortResolver`
deriva descriptor del contrato reservado y usa exclusivamente binarios/inventario/fence del operador.
La prueba funcional usa archivos/hash reales y bridge/procesos simulados, no Win32 efectivo.

`createConformanceWorkerExecutor` está conectado al runner después de su flag explícito y antes
del primer claim. Modo `windows-reserved-v1` exige Windows y JSON estricto fijado por SHA-256;
configuración ausente, alterada, ambigua o modo desconocido impide arrancar sin fallback Remotion.
Legacy conserva su ruta solo cuando no se solicita configuración reservada. No módulos/scripts
configurables, activación automática ni secretos enviados a los procesos. El loader comprueba
JSON acotado5MiB, hash de bytes, digest del manifiesto, herramientas declaradas y directorios
canónicos sin symlinks; los puertos verifican los archivos/closure e identidades antes de medir.
Esto no garantiza inmutabilidad OS ni aislamiento de token/ACL/red. Las cuotas nativas ahora tienen
una ruta explícita descrita abajo, todavía sin demostración física de enforcement.

Provisión pendiente, NO ejecutada: instalar y auditar migraciones y dependencias; preparar JSON
con `policy: WINDOWS_RESERVED_CONFORMANCE_HOST_V1`, `dependencyInventory` (manifest, digest y roots),
`outputParentDirectory`, `powerShellPath`, `bridgeScriptPath`, `measurementFence` (directory y hostId
estable), `enableSilentDurableReports` opcional/defaultfalse. Directorios deben existir, ser
absolutos/canónicos y cumplir la política de permisos del operador. Fijar hash del archivo por
canal confiable; una reserva/documento no puede suministrarlo. Variables del modo:
`HYPERFRAMES_CONFORMANCE_EXECUTION_MODE=windows-reserved-v1`,
`HYPERFRAMES_CONFORMANCE_WINDOWS_CONFIG_PATH` y `HYPERFRAMES_CONFORMANCE_WINDOWS_CONFIG_SHA256`.
El flag previo `HYPERFRAMES_CONFORMANCE_WORKER_ENABLED` sigue obligatorio. No se proporcionan
inventarios/hash ficticios utilizables como configuración productiva. Detener workers incompatibles
y publicar la reserva exacta después de CONSUMED/job antes de habilitar este modo. No habilitado aquí.

Validación dirigida: owned executor12, bridge17, factory4, bootstrap3, runtime5, configuración5,
puertos10, job56, reserva3, silencio4, checks estructurales nativos2: **121/121 pruebas** en suites finales.
El entorno restringido rechazó realpath con EPERM; configuración y puertos se revalidaron fuera
del sandbox sin lanzar PowerShell/FFmpeg/worker. Se conserva la validación estricta de rutas;
fixtures de configuración ahora usan el workspace. Build operativo y compilación de tests pasan. No QA formal,
DB/Win32/decoder físico, recuperación cross-host/ACK ni migraciones aplicadas.

Pendientes de implementación: aislamiento Windows efectivo, garantías corpus/color/A-V/procedencia
y provisión/recuperación operativa; validación DB/concurrencia y QA continúan diferidas. Siguiente
prioridad: token/ACL/red del host, sin confundir Job ownership con sandbox de seguridad.

### Cuotas operatorias — alcance y provisión pendiente

El helper ya limitaba procesos, memoria comprometida por proceso/job y tiempo CPU de usuario con
valores fijos. Ahora `windowsJobResourceLimitsSchema` centraliza la admisión estricta de
`resourceLimits`: `policy: WINDOWS_JOB_RESOURCE_LIMITS_V1`, `maximumProcesses` entero1–64,
`processMemoryBytes`/`jobMemoryBytes` enteros64MiB–4GiB y proceso≤job, `userCpuSeconds` entero1–600,
`cpuRatePercent` entero1–100. Rechaza campos extra, coerción de strings y fracciones. No defaults
de cuotas nuevas ni valores suministrados por composición. JSON y factory pasan la misma política
al productor y mediciones; el bridge clona/valida antes de spawn. Campo ausente preserva V1/quotas
nativas anteriores; campo presente exige canal `WINDOWS_JOB_CONTROL_CHANNEL_V2` sin downgrade.

PowerShell verifica el conjunto exacto de campos y rangos nuevamente; V2 llama exclusivamente
`StartWithCpuRate`. C# aplica ENABLE|HARD_CAP con clase15 y tasa porcentaje×100, comprueba ABI8bytes,
SetInformationJobObject y QueryInformationJobObject/readback exacto antes de CreateProcess suspendido,
assign y resume. Error de API/config/readback rechaza y dispone el Job; no continúa sin cuota.
La rama Start anterior conserva compatibilidad y no afirma hard cap. Fuente primaria:
[Microsoft: CPU rate control](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information).
La cuota es relativa al padre cuando hay jobs anidados, no garantiza un porcentaje absoluto del host;
DFSS/RDS puede impedir la API. El operador debe comprobar ese entorno, no habilitar un fallback.

Add-Type compiló el helper y Parser.ParseFile validó PowerShell sin invocar métodos Win32 ni ejecutar
el bridge. Las pruebas de protocolo usan bridge simulado, y dos checks estructurales no son evidencia
del kernel. Pendiente prueba física de caps/agotamiento/muerte/cierre y compatibilidad SDK/Chromium.
Antes de provisión, regenerar inventario y hashes del helper/script/compiled nuevos; no editar pins de
instalación existente silenciosamente. Habilitar cuotas requiere nuevo JSON/hash confiable y auditoría
del operador. Sin modificación ACL/firewall/token, instalación de servicio, flags, DB o despliegue.

## Corte vigente: reserva exacta por job y host de recuperación programático (2026-10-08)

`CompositionConformanceRenderReservationService` proyecta checkpoint validado a manifiestoV1
sin lease, clave privada ni rutas de vídeo/journal del host. Conserva scope exacto, binding,
hash del receipt original, artefactos y selección. Valida nuevamente binding/contrato/referencias,
acota20MiB y verifica SHA-256 del texto exacto antes de parsear una lectura. Lectura usa job/
org/request/revisión/lease explícitos; RPC recibe AbortSignal. No búsqueda de “último render”.

`createReservedConformanceWorkerHost` resuelve reserva y puertos nativos proporcionados por el
operador dentro del presupuesto común del worker. Falta/corrupción impide crear puertos, snapshot
o captura legacy. Nunca toma un callback/módulo desde el documento ni reinventa workspace del
productor. Recupera autoridad consumida sobre MP4 remoto, cruza receipt/execution del manifiesto
antes del decoder, mide y relee revocación. Reporte conserva `reservationEvidence` como correlación,
no nueva firma/atestación. Resolución de puertos debe ser libre de procesos no propietarios.

Migración preparada `20261008210000_reserve_conformance_render_inputs.sql`: tabla privada RLS,
FKs restrictivas, PK job, checksum exacto y límite20MiB. Registro service-role verifica ledger
CONSUMED, revocación, snapshot/revisión, binding original y referencias ordenadas; conflicto no
sobrescribe. Lector exige lease vigente y scope. Wrapper de cierre exige hash/selección/binding
exactos para jobs reservados y delega TODOS los gates previos; impide downgrade legacy. Sin reserva
preserva compatibilidad anterior. Rollback operativo conserva datos y cadena anterior de gates.
SQL NO aplicado/ejecutado en PostgreSQL; checks estáticos no acreditan concurrencia/transacciones.

**147/147 dirigidas**: job56, audio21, lotes23, comparador10, silencio4, reserva3, checkpoint3,
autoridad4 seleccionadas, runtime5, factory11, SQL7 estáticas. Autoridad cubre rutas checkpoint y
registro simulado, audible/sin pista, opt-in y revocación; sello de firma real y transporte fakeDB.
Prueba nueva confirma ausencia de reserva bloquea ports/snapshot. Primera suite tuvo una aserción
de test que esperaba código genérico en lugar de RESERVATION_UNAVAILABLE preservado; corregida
para comprobar etapa y código exactos, suite final pasa. Build operativo y compilación habitual de
tests terminales pasan. No prueba física DB/Windows/decoder/cross-host ni journal fsynced completo.

**CAP-02789.8→90.1% estimado parcial (+0.30pp), identidad/ejecutor85→87 (peso15%).** Resto de
rúbrica89/89/90/95/94/75/95/99, mismos pesos. Crédito por servicio/resolución/reporte integrados,
no por SQL preparado ni recuperación distribuida productiva acreditada. Siete `(600+90.1)/7`
`=98.585714%`, ~98.59% estimado. Seis CAP-004/009/010/017/023/026100% implementación registrada
individual, QA pendiente; no reauditoría completa. CAP-022/025/029 preservados.

Provisión posterior (NO ejecutada): operador instala/valida prerequisitos y migraciones, detiene
workers incompatibles y publica reserva con job exacto solo después de admisión CONSUMED y creación
de job de conformidad. Repetir publicación con mismos bytes es idempotente, no cambia ejecución.
Worker reservado recibe `resolveProcessPorts` de configuración Windows admitida y usa el host nuevo
como executor de `processConformanceJob`; silentV2 continúa opt-in. Verifica recuperación en otro
host y pérdida de ACK/lease antes de activar. No publicar reservas mientras un worker legacy pueda
finalizar esos jobs; el gate de cierre lo rechazará. Manifest contiene contenido/witnesses privados:
no loguear, acceso solo worker/operador, retención/borrado coordinado pendientes. Payload20MiB
es límite, no objetivo de volumen; operación debe acotar pool y medir tamaño/TOAST/latencia.

Pendientes: wiring del bootstrap CLI y proveedor Windows de puertos sin workspace ya eliminado,
aislamiento efectivo token/ACL/red/cuotas, recuperación cross-host/ACK/concurrencia en DB real,
corpus/color/A-V/procedencia y QA. Próximo: desacoplar workspace de medición y conectar configuración
Windows admitida; después aislamiento efectivo. Ningún flag activado, despliegue, migración aplicada
ni cambios del productor/SDK/vendor. No se afirma cierreR04 ni preparación productiva.

## Corte vigente: reporte durableV2 sin pista audio y worker opt-in (2026-10-08)

FormatoV1 audible conserva checksum audio obligatorio, timing medido y todos los gates existentes.
FormatoV2 es exclusivo de ausencia de pista: `audioExpectation` FROZEN_NO_AUDIO_TRACK_V1 liga
contrato completo a binding de autoridad consumida y selección exacta. Exige referencias sin
audio, video.hasAudio=false, loudness NOT_APPLICABLE/measurement=null y timing/RMS canónicos
NOT_REQUESTED. Rechaza downgradeV1, selección/autoridad ausentes, referencias audio inyectadas,
hash ajeno, pista inesperada y promoción PASS. Firma issuer/output no cambia ni acredita aislamiento.

Worker implementa rutaV2 con `enableSilentDurableReports=true` únicamente host opt-in; default
conserva rechazo explícito y bootstrap productivo no la activa. Omite generación/lectura de audio,
usa comparador silent scoped, valida contrato congelado, cruza pins/receipts originales y relee
revocación antes del reporte. Playback solicitado con ausencia de pista se rechaza, no se ignora.
Comparaciones y reportes audibles siguenV1. Campo nuevo no es autorización para desplegar.

Migración preparada `20261008200000_support_silent_conformance_reports.sql`: verificador privado
V2 con timing canónico idéntico a Node, selección ordenada y tenant/request/documento/output
ligados. Patch con siete precondiciones exactas del finalizador privado original: ramasV1/V2 y
LEFT JOIN audio soloV1. RamaV2 exige revisiónV4 audio.required=false y renderExecution congelado.
Mantiene integralmente wrappers de intento/lease/controlado/eventos y joins de asset/integridad/
visual, SSIM/texto/playback audible. No reescribe filas ni concede acceso al helper. SQL NO aplicado
ni ejecutado en PostgreSQL; tests de transformación son estáticos, no pruebas DB. Operador debe
revisar/transaccionar/pruebas de concurrencia/rollback antes de habilitarV2; no activar con esquema viejo.

**132/132 dirigidas**: silencio4, comparador10, audio21, worker56, lotes23, autoridad4 seleccionadas,
factory11 y migración3 estáticas. Autoridad prueba contrato audible/sin audio, checkpoint exacto,
opt-in desactivado, revocación, rechazosV2 y una escritura de cola simulada conservando INCOMPLETE.
Ed25519/files/hash/evaluador/SSIM son reales donde aplican; ledger/cola/browser/decoder simulados.
Build operativo y compilación habitual tests terminales pasan. TS6133 HTML del corte previo ya
no aparece en estado actual; no fue corregido por esta entrega. No QA Win32/SDK/FFmpeg/PostgreSQL,
ni validación integral V2 audiovisual/lotes o checkpoint journal histórico.

**CAP-02789.5→89.8% estimado parcial (+0.30pp), audio92→94 (peso15%).** Identidad85 y otros
bloques89/89/90/95/75/95/99 sin cambio. Crédito por integración funcionalV2 worker/reporte/cola;
SQL preparado no concede cierre DB/productivo. Siete `(600+89.8)/7=98.542857%`, ~98.54% estimado.
CAP-004/009/010/017/023/026100% implementación registrada individual/QA pendiente, no reauditoría.

Pendientes: provisión/bootstrap y reserva/recuperación distribuida, aislamiento efectivo Windows
token/ACL/red/cuotas, evidencia corpus/color/A-V/procedencia, validación V2 DB/lotes/operación y QA.
Próximo: provisión exacta del host y recuperación durable, sin activar flags, y aislamiento Windows.
CAP-022/025/029 preservados; ninguna migración aplicada, despliegue ni modificación de SDK/vendor.

## Corte vigente: contrato explícito para comparación sin pista audio (2026-10-08)

Añadidos `composition-silent-conformance-gate.ts` y ruta explícita
`compareVideoWithPersistedSilentReference`. El comparador scoped valida antes del decoder que
el contrato congelado declare audio.required=false; contratosV1 sin expectativa y contratos con
audio requerido se rechazan. No acepta referencias audio en esta ruta. Tras medir exige documento
exacto, video.hasAudio=false, audioStatus=NOT_REQUIRED, loudness=NOT_APPLICABLE, timing/RMS
NOT_REQUESTED, sin hash de referencia audio ni playback. Conserva FAIL/INCOMPLETE, nunca los
convierte en PASS. Es una ruta de ausencia de pista, no prueba de silencio perceptual en una pista
existente ni prohibición de pistas para todas las composiciones audio.required=false.

**91/91 dirigidas**: silencio4, comparador10, audio21, worker56. Validan gates y orquestación con
decoder simulado; no prueban FFmpeg ni Windows físicos. Build operativo pasa. Compilación de tests
con configuración habitual detectó TS6133 en preview-channel HTML ajeno a CAP-027; no se corrigió
ni se ocultó como éxito. Compilación diagnóstica con `--noUnusedLocals false` pasa: no otros errores
de tipado; no equivale a pasar configuración habitual. Gate exige timing/RMS NOT_REQUESTED
canónico completo, sin lag/correlación/reference hash inventados, y loudness.measurement=null.

**CAP-02789.5% parcial conservado; siete98.5%.** Es prerrequisito, no cierre durable. WorkerV1
continúa rechazando reserva silenciosa: no se elimina ese bloqueo antes de soporte coordinado SQL.
Próximo bloque: reporte durable versionado con rama audio NO_REQUIRED ligada a contrato completo
de revisión autorizada; DB debe verificar ausencia de checksum/receipt audio, expectativa congelada,
status medido y conservar todos los gates/leases/tenant/integridad/lotes existentes. Rama audible
mantendrá par visual/audio inmutable y RMS/timing/playback. No normalizar silencio a métricas PASS
ni generar un WAV vacío para satisfacer V1. Preparar migración sin aplicarla y cubrir downgrade,
contrato antiguo, pista inesperada y promoción de estado; después integrar worker opt-in.

Seis CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente individual. Sin nuevas
migraciones, activación, despliegue ni edición de otros CAP. Persisten pendientes del corte anterior.

## Corte vigente: puente de selección factory → checkpoint → worker (2026-10-08)

El factory entrega un envelope explícito con artefactos y la misma selección exacta usada por
el medidor. Verifica su hash, vuelve a ligar identidad/contrato y exige el selector compilado en
el inventario admitido. No resuelve referencias por segunda vez ni altera el receipt firmado.
El supervisor ya conserva esta selección opcional en el checkpoint.

El worker admite `checkpointReservation` opt-in con scope y lector explícitos del host. Valida
identificadores/tenant/request/revisión antes de leer, rechaza entradas ambiguas y recupera
artefactos/selección bajo el presupuesto común. La autoridad consumida todavía debe autenticar
el output; leer un checkpoint no constituye admisión. No consulta “última ejecución”.

Validación: **74/74 dirigidas** (factory11, autoridad4 seleccionadas, job56, reserva3), build
operativo y compilación tests terminales pasan. Factory usa ZIP/PNG/SSIM/hash/files reales con
procesos simulados. Worker usa checkpoint estructuralmente validado mediante lector simulado,
firma Ed25519 real y ledger/decoder simulados; conserva INCOMPLETE y rechaza revocación. No
revalidación del journal fsynced completo, QA físico Windows, SDK/browser/render ni PostgreSQL.

**CAP-02789.2→89.5% estimado parcial: identidad/ejecutor83→85 (peso15%).** Otros bloques y pesos
sin cambio:89/89/90/95/92/75/95/99. Crédito por cerrar transporte opt-in de referencias entre
capas, no por cantidad de pruebas. Siete `(600+89.5)/7=98.5%`. CAP-004/009/010/017/023/026100%
implementación registrada individual, QA pendiente; no reauditoría integral de esas seis.

Siguen abiertos bootstrap/provisión productiva y reserva distribuida, silencio durableV1,
aislamiento efectivo Windows token/ACL/red/cuotas, corpus/color/A-V/procedencia y QA. SQL previo
solo preparado; ninguna migración aplicada, flag activado, despliegue ni edición de otros CAP.
Siguiente: evolucionar contrato/reporte durable y gates para composiciones sin audio, sin inventar
fuentes audio ni rebajar validaciones existentes. HyperFrames/Core preserva el productor original.

## Corte actual: referencias reservadas y reanudación exacta (2026-10-08)

Worker opt-in acepta `referenceSelection` ligada a admisión consumida mediante contrato completo,
org/revisión/ejecución/documento/proyecto y cobertura ordenada. Ruta reservada usa checksums exactos
preview/audio raíz sin recapturar ni regenerar; conserva selección en reporte durable. Identidad
de cada paquete de lote incorpora opcionalmente `visualReferenceSha256`, y resumen mantiene ese
checksum; cambiar referencia no permite reanudar mediciones anteriores. Adapters exigen receipts
admitidos con selección y omiten nueva captura; rutas legacy conservan identidad y RPC anteriores.
Comparación audio verifica org/revisión/par visual antes de invocar comparador.

Checkpoint localV1 conserva opcionalmente selección y valida su binding contra contexto firmado;
supervisor propaga selección si el renderer la entrega. No significa que factory actual ya la entregue,
ni reserva distribuida, ni firma de referencias: issuer/outputV1 no cambia. La provisión productiva
y el puente completo factory→checkpoint→claim siguen pendientes.

Migración preparada `20261008190000_bind_selected_event_measurements.sql` añade RPCs de lectura/
registro de selección que cruzan checksum con visual_sha256 y reutilizan gates existentes. Extiende
el punto exacto de construcción PK del verificador SQL instalado con precondición estricta; aborta
si su definición no coincide, en vez de reemplazar gates acumulados. No aplicada ni ejecutada en
PostgreSQL; revisión SQL/transaccional/concurrencia/rollback con operador pendiente. No borrado,
reescritura de filas, reset de fences ni activación de worker. Tests SQL son estáticos, no QA DB.

**127/127 dirigidas**: job56, lotes23, audio21, paquetes8, admisión4 seleccionadas, runtime5 y
comparador10. Build operativo, compilación tests y diff check pasan. Primera compilación detectó
contrato unknown del binding nuevo; corregido parseando schema, sin casts productivos. Pruebas
iniciales ejecutadas durante compilación eran build anterior y no se contabilizaron; suites finales
repetidas tras compilación terminal. Firma/hash/files/evaluador reales; DB/browser/decoder simulados
o no ejecutados. Suite autoridad completa/checkpoints históricos no revalidada.

Limitación explícita: reporte durableV1 exige audio. Selección válida silenciosa se rechaza con
`CONFORMANCE_JOB_SILENT_RESERVED_REPORT_UNSUPPORTED`, no se inventa audio ni declara conformidad.
Lotes miden visual; selección de audio de lotes no acredita medición audiovisual completa por lote.
Soporte silencioso requiere evolución coordinada de esquema/gates SQL, no un fallback legacy.

**CAP-02789.2% estimado parcial conservado; siete~98.5%.** Identidad83 y otros bloques89/89/90/
95/92/75/95/99, mismos pesos. No crédito por tests o SQL preparado sin integración productiva.
CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente individual. Sin cierreR04,
CAP-022/025/029 intactos. Próximo: completar contrato durable silencioso y provisión/reserva productiva;
continúan aislamiento Windows, corpus/color/A-V/procedencia/recuperación distribuida y QA.

## Corte actual: admisión nativa consumida en worker de conformidad (2026-10-08)

Ruta opt-in `controlledRenderEvidence` implementada: reserva host exacta org/request/revisión/
execution/productionJob, artefactos clonados y límite20MiB; `recoverConformanceRenderEvidence`
relee autoridad CONSUMED, reconstruye binding y verifica firma Ed25519/revocación/pins mediante
la autoridad existente. Cruza documento/hash/tamaño del MP4 snapshot; exige puertos controlados
sin inferir configuración desde el receipt. No emisión, consumo, firma nueva ni render durante lectura.

Worker escribe receipts nativos privados exclusivos para raíz y cada lote. Comparador valida contrato
completo antes del decoder, hash del receipt antes/después; adapters seleccionan receipt exacto por
índice/hash, no reutilizan receipt raíz en otro lote. Relee autoridad al final para detectar revocación
y conserva `renderEvidence` opcional en reporte durableV1, con binding y hash del receipt supervisor.
La firmaV1 no cambia: scope sigue issuer/output, nunca isolation/conformance. Esquema rechaza scope
ajeno, bytes distintos, ejecución ausente y promoción a PASS; gates existentes siguen pendientes.

Validación dirigida **130/130**: job56, lotes22, comparador10, admisión nueva4 seleccionadas,
audio21, pipeline visual8, etapas4 y runtime5. Ed25519/files/hash/evaluador son reales;
DB/browser/decoder y preparaciones simuladas o no ejecutadas. Recorrido admitido hasta reporte
INCOMPLETE usa evaluador sin muestras, no métricas aprobadas inventadas; revocación durante
comparación bloquea reporte. Suite autoridad completa/checkpoint histórica no revalidada aquí.
Build operativo y compilación de tests pasan; sin QA formal, Win32/SDK/render/BD reales.

**Estimación CAP-02788.9→89.2% parcial (+0.30 pp); identidad/ejecutor81→83, peso15%.** Crédito
limitado por integración funcional de admisión consumida y receipts originales en worker, no por
cantidad de pruebas ni por atestación física. Resto89/89/90/95/92/75/95/99 y pesos sin cambio.
Media `(600+89.2)/7=98.4571%`, presentada~98.5%. CAP-004/009/010/017/023/026100% implementación
registrada/QA pendiente individual. Roadmap7/30 cierre registrado23.33%, no implementación global.

Pendiente: provisión/reserva durable de artefactos y referencias exactas en bootstrap productivo,
recorrido audiovisual/lotes completo hasta decoder nativo, recuperación distribuida y retención,
aislamiento Windows token/ACL/red/cuotas, corpus/color/A-V/procedencia y QA. Ruta legacy conserva
receipt identity-only sin nueva autoridad ni activación. No migración aplicada, SDK/vendor, flags,
despliegue ni cambios de CAP-022/025/029. HyperFrames/Core preserva productor/ownership originales.

## Corte actual: propiedad de procesos en coordinación durable (2026-10-08)

`executeConformanceJob` acepta puertos de comparación del host y los propaga a la comparación
raíz y a todos los lotes; los adapters conservan también la señal del presupuesto común.
La entrada de lotes ahora entrega esa señal al coordinador. No se configura automáticamente
el bootstrap productivo ni se sustituye el receipt identity-only por evidencia nativa autenticada.
Preparación browser/audio sigue sin aislamiento acreditado; no se afirma que todos sus procesos
estén controlados por incorporar puertos al comparador.

Cierre incierto/fence que exige intervención conserva `recoveryRequired` a través de errores de
etapa sanitizados, nunca se convierte en cancelación genérica reintentable y evita limpiar vídeo,
receipt, referencias visual/audio y fuente de lotes/preparación. Cola escribe fallo no reintentable
sin reporte cuando conserva lease. Pérdida de lease o ACK de cierre conserva la señal de recuperación;
el runner se detiene con exitCode1 en vez de reclamar otro trabajo. No segunda escritura tras ACK
perdido, ni reset del fence o borrado automático. La recuperación distribuida tras lease perdido,
inventario durable de temporales retenidos y coordinación entre hosts continúan pendientes.

Validación dirigida: **124/124** (job56, etapas4, lotes22, audio21, pipeline visual8,
comparación visual8, runtime5), compilación de tests y build operativo pasan; syntax check del
runner y diff check pasan. BD/browser/decoder/Win32 simulados o no ejecutados; no QA formal.
Pruebas usan archivos propios para retención/cleanup; no acreditan containment físico ni rollout.

**CAP-027 conserva88.9% estimado parcial; media siete98.4%.** Este corte implementa conexión
y corrige pérdidas de ownership; no cierra todavía autoridad/persistencia integral ni aislamiento
Windows. No se concede crédito por contar tests. Identidad81/corpus89/checkpoints89/imagen90/
tiempo95/audio92/fuentes-codecs-SDR75/diagnóstico95/gate99, pesos sin cambio. Seis CAP-004/009/010/
017/023/026100% implementación registrada, QA pendiente individual. No cierre R04, migración,
SDK/vendor, flags, despliegue ni cambios a CAP-022/025/029.

Siguiente bloque: admisión autenticada del receipt nativo original y selección durable de referencias
antes de conectar configuración host al worker. Mantener explícita la diferencia entre métricas locales,
reporte durable no firmado y atestación; no promover INCOMPLETE a PASS.

## Corte vigente: factory integrado hasta mediciones reales (2026-10-08)

Cuatro integraciones nuevas ejecutan el factory/collector/lector/comparador/gates productivos:
request y receipts originales ligados al vídeo, native original, selector exacto, registro scoped y
ZIP autorizado por hash, metadatos/PNG revalidados, SSIM efectivo, diagnóstico local y artifacts.
Supabase y proveedor de respuestas probe/decode se simulan; no hay report prefabricado ni fallback
de build tests. Archivos/hash/PNG/SSIM y consumos lectores son reales. Fixture construye contrato
V4 desde builders/schema operativos; snapshot builder ajeno al cierre de build no se añade por tests.

Imágenes idénticas dan SSIM1 y conservan INCOMPLETE por attestation pendiente; corrupción da FAIL,
escribe el diagnóstico y bloquea artifacts. Native inválido falla antes de reservar procesos o leer
referencias; cancelación durante decode no publica artifacts ni diagnóstico de éxito. Se verifica
factory single silencioso completo en código. Audio/lotes tienen pruebas de núcleo, no recorrido
físico ni conformidad del factory completo. No Win32/SDK/decoder/Supabase reales ni QA formal.

**Estimación vigente CAP-02788.6→88.9% parcial (+0.30 pp); media siete~98.4%.** Identidad/ejecutor79→81,
peso15%, al confirmar que la conexión previamente implementada llega al comparador completo y
no entrega artifacts ante discrepancia medida. No es crédito por cuatro tests ni funcionalidad nueva
en el renderer; reestimación de integración ahora verificada. Otros bloques89/89/90/95/92/75/95/99
sin cambio. Los seis CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente individual.
Media `(600+88.9)/7=98.4143%`,~98.4%. Roadmap7/30 cierre registrado23.33%, no implementación total.

CAP-027 no es QA-only: faltan reservas/evidencia durable y autoridad integral, aislamiento efectivo
Windows token/ACL/red/cuotas, corpus/color/A-V/procedencia y verificación física. Siete fallos previos
de checkpoint no revalidados aquí. CAP-022/025/029, SQL, vendor, flags y despliegue no modificados;
HyperFrames/Core conserva productor/ownership/medios originales. Próximo bloque funcional: aislamiento
Windows y conexión/admisión durable de mediciones, sin promover diagnósticos locales a conformidad.

Validación final de esta continuación: **45/45 dirigidas** (integración completa4, factory7,
runtime5, referencias14, eventos15), build operativo y compilación de tests finales pasan.
El primer intento de fixture requirió un snapshot builder fuera del cierre operativo; se corrigió
usando builders/schema/checkpoint-plan disponibles, sin ampliar dependencias productivas ni usar
build test como fallback. No ejecución física ni QA formal. Todos los comandos de este corte terminales.

## Corte vigente: reserva host y medición audio/eventos (2026-10-08)

Selección host inmutable implementada y conectada al factory mediante `referenceSelections`.
Binding exacto de ejecución/organización/revisión/documento/proyecto/contrato, referencias ordenadas
completas y audio iff requerido. Rechaza duplicados/desconocidos/reintentos con otro executionId;
configuración y respuestas clonadas. No latest, paths de cliente ni credenciales/selecciones al hijo.
Plan materializado/identidad/contrato obligatorio antes de prepareLaunch. Diagnóstico local incluye
scope org/rev, contrato y hash de selección; no se extiende firma ni autoridad durable.

El núcleo ahora tiene pruebas del par visual/audio, rechazo de audio de otra referencia, retención
conjunta ante cierre incierto y recorrido de todas las particiones derivadas del corpus captions-multi-batch.
Reserva y factory: admisión positiva y launch medido negativo/positivo sin procesos físicos, además
de rechazo de callback + selección simultáneos. Es integración de código: readers/decoder/SDK/CDP
simulados, filesystem/hash/PNG reales. Sin Supabase/migraciones/PowerShell/Win32/FFmpeg reales ni QA formal.

**Estimación CAP-02788.3→88.6% parcial (+0.30 pp); media siete~98.4%.** Identidad/ejecutor77→79,
peso15%, por conectar referencias exactas del host al medidor y validar cobertura single/audio/eventos.
Crédito limitado de implementación; no deriva del número de tests ni de declarar física la simulación.
Resto conserva89/89/90/95/92/75/95/99; no crédito extra de color/audio/corpus/attestation física.
Faltan recorrido integral factory→decoder, reserva durable/admisión de métricas firmadas,
garantías Windows efectivas de token/ACL/red/cuotas, cierre del corpus/color/A-V/procedencia y QA.

| Bloque CAP-027 | Peso | Estimación vigente |
| --- | --- | --- |
| Identidad/ejecutor | 15% | 79% |
| Corpus | 10% | 89% |
| Checkpoints | 10% | 89% |
| Imagen/SSIM/máscaras | 15% | 90% |
| Tiempo/repetibilidad | 10% | 95% |
| Audio/RMS/loudness/A-V | 15% | 92% |
| Fuentes/codecs/SDR | 10% | 75% |
| Diagnósticos | 5% | 95% |
| Gate local/evidencia | 10% | 99% |

Suma ponderada88.60; media `(600+88.6)/7=98.3714%`, presentación~98.4%. CAP-004/009/010/017/023/026
mantienen100% implementación registrada/QA pendiente individual; no nuevo cierre R-ID.
Roadmap7/30 cierre registrado23.33%, no porcentaje global implementado. CAP-022/025/029, SQL/vendor/flags
no modificados por este corte; HyperFrames/Core conserva productor y medios originales.

Validación final de este corte: **49/49 dirigidas** (referencias/reserva14, eventos15, factory7,
runtime5, transporte8), build operativo y compilación de tests finales pasan. El primer corte de
compilación detectó narrowing V4 faltante en el nuevo test event; corregido sin cambios al contrato.
La regresión transporte bajo sandbox falló antes del start,6 failed/2 cancelled; proceso terminal
verificado antes de repetir. Las mismas8 pasan con acceso filesystem ampliado, sin cambios al código
ni ejecutar procesos nativos. No se atribuye éxito bajo sandbox ni se confunde el permiso del test
con aislamiento productivo. Factory probado en admisión/launch y colector existente, no en recorrido
completo hasta decoder. Siete fallos históricos de checkpoint no revalidados en este corte.

## Medidor completo: núcleo y conexión explícita (2026-10-08)

Implementado `measureControlledConformanceReferences`: contratos single/event se rederivan con
observación/seek/native, cobertura exacta de referencias ordenadas, lectores internos de preview/audio
por checksum y scope, identidad completa comprobada antes de decodificar. Comparador audiovisual
existente con puertos controlados obligatorios, gate de obligaciones, reproducción audio V3 y pins
de vídeo/metadatos/PNG/máscaras/WAV/receipt antes/después. No hay fallback al decoder no controlado.
Retiene entradas si no se confirma cierre de medición. Resultado conserva FAIL/INCOMPLETE y scope local.

Factory opt-in `createMaterializedProducerReferenceBridgeConfiguration` conecta el productor original
observado a dicho núcleo con puertos Windows propios y referencias seleccionadas por autoridad host.
Guarda diagnóstico local acotado `controlled-measurements.json`; FAIL bloquea retorno. No extiende
la firma de identidad del supervisor ni acredita persistencia/conformidad durable. El resolver requiere
selección autorizada exacta: no implementa una migración ni una selección latest implícita.

El padre ahora drena el colector independiente antes de liberar el fence/archivos, aunque su propio
job ya estuviese vacío. Cierre incierto/hang conserva fence y cuarentena; failure ordinario ya terminado
permite cleanup, sin publicación. Pruebas dirigidas nuevas usan lectores/comparador y Win32 simulados,
con filesystem/hash reales. No sustituyen validación integrada factory, audio completo o eventos ni QA físico.

**Estimación conservada: CAP-02788.3% parcial; media siete~98.3%.** No se asigna crédito nuevo antes
de validar la conexión completa, audio y lotes. Seis CAP-004/009/010/017/023/026 mantienen100%
implementación registrada/QA pendiente individual. No cierre adicional de requisito. CAP-022/025/029,
SQL, vendor y flags no modificados por este bloque. HyperFrames/Core conserva pipeline/medios originales.

Validación final de esta continuación: **40/40 dirigidas** (núcleo8, bridge15, propiedad12,
runtime/import5), build operativo y compilación de tests pasan. Fixture inicial audible sin referencia
audio rechazó correctamente; se corrigió a documento silencioso con volumen0 y se agregó rechazo
explícito por audio obligatorio. Se corrigió narrowing V4 del test, sin debilitar contratos productivos.
Factory validado por import/admisión negativa, no por recorrido completo; lectores/comparadores y
Win32 simulados, archivos/hash reales. No prueba de Supabase/PowerShell/decoder/SDK físicos ni QA formal.

## Transporte de mediciones con job Windows propio (2026-10-08)

`createWindowsComparisonProcessPorts` implementa ahora los dos puertos existentes del comparador (`execute` UTF-8 y `consumePcm`) mediante un job Windows independiente por operación. No reutiliza el job cerrado del productor. El ciclo de vida y el bridge se generalizan con tipos de resultado, conservando la API de render y los mismos controles: propiedad síncrona, deadline, fence durable, STOP correlacionado, árbol vacío y cierre limpio del bridge antes de recoger resultados. No se fabrica un resultado de render para transportar una medición.

Driver fijo `run-owned-measurement.mjs`, referencia acotada SHA/tamaño a request privado, binario/argv exclusivamente host, entorno allowlist y límites separados stdout/stderr. Escribe spool con creación exclusiva/backpressure y receipt local ligado a ejecución/operación/request; no envía datos del decoder por el canal de control. Requiere build operativo sin fallback a tests. Instalación y ejecutables provienen del inventario aprobado, roles/comparisonTools fijados y rechecks; módulos de transporte/bridge/helper se exigen declarados. Directorio y padre se revalidan por identidad/realpath, sin atribuirles inmutabilidad OS.

El consumidor solo recibe bytes después de confirmar stop/cierre. UTF-8 inválido rechaza; PCM se consume incrementalmente, con contador/hash de bytes realmente leídos y recheck del archivo. Deadline externo cubre preparación/ejecución/consumo; aborto no publica resultados tardíos. Cierre incierto conserva fence/spool, pone en cuarentena este host y prohíbe nuevos starts; no reclaims automáticos ni PID fallback. Fallos con cierre confirmado liberan el fence pero conservan spool para reconciliación; éxito limpia únicamente los cuatro archivos fijos y su directorio privado. Retención y cuota de disco acumulada siguen pendientes operativos, no resueltos por límites de bytes por operación.

**Configuración importante:** `measurementFence` debe reservar un slot durable propio, distinto del fence del productor. El fence del productor todavía está tomado mientras `collectResult` mide su resultado; compartirlo provocaría rechazo o un diseño incorrecto de propiedad. Configurar este puerto no instala, despliega ni activa el worker. El llamador del `measure` debe pasar la instancia como `processPorts` al comparador; aún falta conectar/admitir el medidor completo con referencias preview/audio/corpus autorizadas en el bootstrap del host. No se afirma que el recorrido audiovisual automático esté terminado.

Validación: ocho nuevas integraciones con driver/schema/archivos/crypto/inventario/fence reales y bridge/decoder simulados; cubren texto, PCM, falta de ACK, aborto antes del cierre, exceso de bytes, recibo ajeno, binario no autorizado, driver no declarado, UTF-8 inválido y consumidor no cooperativo. Once regresiones de bridge, doce de propiedad y cuatro de build operativo pasan. Build operativo y compilación de tests pasan; no se ejecutaron PowerShell/Win32 Job/SDK/FFmpeg/renderer ni QA formal. Primer corte falló bajo sandbox y una aserción esperaba un error distinto; repetición dirigida fuera del sandbox y corrección de fixture/aserción conservan controles. Se detuvo una ejecución antigua propia que quedó esperando un mock incompleto; las pruebas corregidas tienen timeout y cierre de su driver simulado.

**Estimación vigente: CAP-027 88.0% → 88.3%, parcial (+0.30 pp).** Identidad/ejecutor75→77 con peso15% por conectar propiedad independiente y transporte a los puertos reales del comparador, equivalente al crédito parcial previo del bridge del productor. Es juicio de ingeniería, no porcentaje de procesos físicos comprobados. Otros bloques conservan89/89/90/95/92/75/95/99; no crédito adicional de audio/corpus/color/procedencia desde mocks o desde la mera disponibilidad del puerto. Media siete `(600+88.3)/7 = 98.3286%`, presentada **~98.3% estimada**. CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente individual; no cierre nuevo R-ID. Pendientes: integración del medidor completo, garantías Windows de token/ACL/red/cuotas, mediciones color/A-V/corpus y procedencia efectiva, además de QA. HyperFrames/Core preserva el pipeline original; CAP-022/025/029, SQL, flags y vendor intactos.

## Reestimación acumulada vigente — aproximadamente 88% (2026-10-07)

Esta revisión sustituye **85.80%** como estimación vigente, no como historial. El indicador anterior permaneció fijo durante integraciones nuevas porque se condicionó su actualización al cierre de bloques enteros, pese a que la rúbrica ya admitía crédito parcial. Se mantienen los nueve bloques y pesos; no se redefine el alcance ni se contabiliza QA, número de archivos o tests. La inspección confirma conexiones implementadas en bootstrap, observer, receipt, colector y bridge; no acredita ejecución física ni permite atribuir un porcentaje objetivo de requisitos aprobados. Los valores internos siguen siendo **juicio de ingeniería**, no fracciones calculadas desde un checklist exhaustivo. Presentación recomendada: **~88%**, sin precisión aparente de dos decimales.

| Bloque original | Peso | Estimación anterior reconstruida | Estimación revisada | Contribución revisada |
| --- | ---: | ---: | ---: | ---: |
| Identidad congelada de documento, assets y entorno | 15% | 69% | 75% | 11.25 pp |
| Corpus de fixtures completo | 10% | 89% | 89% | 8.90 pp |
| Checkpoints de bordes, efectos y cues | 10% | 89% | 89% | 8.90 pp |
| Imagen, SSIM y máscaras de texto | 15% | 90% | 90% | 13.50 pp |
| Tiempo y repetibilidad forward/reverse | 10% | 92% | 95% | 9.50 pp |
| Audio, RMS, loudness, true peak y A/V | 15% | 92% | 92% | 13.80 pp |
| Fuentes, codecs y SDR Rec.709 | 10% | 65% | 75% | 7.50 pp |
| Diagnóstico por etapas | 5% | 95% | 95% | 4.75 pp |
| Gate seguro y evidencia durable | 10% | 99% | 99% | 9.90 pp |

Justificación del ajuste acumulado, sin doble crédito:

- **Identidad +0.90 pp:** después del bridge Windows que originó el 69%, se conectaron paquete observado versionado, configuración del operador y plan V3 pinneados, observaciones de archivos/CDP originales, recibos ligados al vídeo y consumo independiente en el colector/bridge. Evidencia: `admitted-observed-producer.mjs`, `run-observed-materialized-producer.mjs`, `materialized-producer-collector.mjs` y `materialized-producer-bridge-configuration.mjs`. Falta cierre dinámico/inmutabilidad efectiva, sandbox y procedencia autenticada integral. No se acredita aislamiento desde pins.
- **Tiempo +0.30 pp:** `composition-original-session-seek-capture.ts` compara RGBA forward/reverse desde buffers y capturas originales bajo lease SDK; bootstrap y bridge conectan reportes por contrato único/conjunto de eventos. Se exige cobertura/orden/binding, sin reemplazar la página. No se vuelve a contar la planificación de checkpoints ya incluida en 89%, ni se acredita repeatability física, paridad preview o sync acústica.
- **Fuentes/SDR +1.00 pp:** la fábrica de fuentes prestadas está conectada antes de navegación y a captura/repetición/finalización nativa; el archivo forward y los puertos V4 conectan encoder/probe/verificación post-ensamblaje al bootstrap V3, con observación vinculada y admisión restringida. Evidencia: `original-session-native-observer.mjs`, `composition-original-session-native-capture.ts`, `composition-original-session-font-capture.ts`, `original-session-sdr-stages.mjs` y `run-observed-materialized-producer.mjs`. Se acredita conexión que faltaba, no la creación previa del encoder/mux. No demuestra fuentes de sistema, color efectivo o funcionamiento físico del SDK completo.

Sin incremento en imagen, corpus, audio, diagnóstico o gate: geometría/glifos conservan pendientes de máscaras generales/decks; silent/AAC del fixture no cierran timing/RMS/A-V del host ni corpus autorizado; bindings/guards complementan obligaciones ya contabilizadas. El 99% del gate es una estimación heredada de implementación local, **no 99% de garantía durable productiva**; DB/autoridad/OS reales continúan gates abiertos. Las bases no cambiadas no se presentan como una nueva auditoría exhaustiva de cada requisito.

Cálculo: `85.80 + 0.15×(75−69) + 0.10×(95−92) + 0.10×(75−65) = 88.00`. Ajuste **+2.20 pp acumulados**, no avance de código realizado en esta respuesta. Media simple de las siete: `(600+88)/7 = 98.2857%`, presentada **~98.3% estimado**, no avance total del roadmap ni esfuerzo/tiempo restante. CAP-004/009/010/017/023/026 conservan **100% implementación registrada, QA pendiente** cada una; esta inspección no reaudita su cierre completo. CAP-027 permanece **parcial**; ~12% pendiente es una estimación, no únicamente QA. Cierre de implementación registrado roadmap continúa 7/30; no se cierra ningún R-ID con este ajuste.

Validación actual: inspección de la ruta original y reejecución **10/10** dirigidas (cuatro stages, seis bridge) pasan, con PNG/archivos/hashes reales y ejecución multimedia simulada. No se reejecutó el bootstrap completo, corpus nativo, renderer, QA formal ni migraciones. HyperFrames/Core distingue ownership de medios y pipeline original de prueba de conformidad. Solo cambia seguimiento; no runtime, vendor, flags, despliegue o módulos CAP-022/025/029. Siguiente trabajo funcional: procesos de medición independientes, cierre confirmado y comparación efectiva; no volver a congelar la estimación hasta cerrar todo CAP-027.

## Inventario del bootstrap SDR y límite de medición posterior (2026-10-07)

El bridge observado exige ahora declarar `original-session-sdr-stages.mjs` y `closed-stage-executor.mjs`. El entry observado importa el primero incondicionalmente y este importa el segundo: la exigencia también corresponde a contratos sin SDR. Antes podían faltar en el inventario obligatorio del host. La corrección no autoaprueba hashes, no instala paquetes y no acredita el cierre de todo el grafo dinámico; la verificación de integridad existente conserva su responsabilidad. Dos regresiones independientes omiten cada archivo y exigen rechazo al construir el bridge, antes de lanzar o medir. Fixtures observados completos continúan pasando.

Validación de esta iteración: **6/6** pruebas del bridge, syntax Node y `git diff --check` pasan. La prueba de colección usa archivos y hashes reales con vídeo/observaciones fixture; no ejecuta PowerShell, Chromium, SDK ni FFmpeg. Sin QA formal, despliegue, migración aplicada o cambios en CAP-022/025/029. HyperFrames/Core conserva el pipeline original y el ownership de medios.

La revisión de conexión audiovisual confirma un límite funcional, no solo QA: `createMaterializedProducerBridgeConfiguration` exige un `measure` externo y lo invoca después de cerrar el job del productor. `compareExportedVideoWithPreview` ya acepta `ComparisonProcessPorts` para probe, checkpoints, loudness y PCM/timing, pero el ejecutor de stages solo confirma el hijo directo y no sirve como implementación de esos puertos después del cierre del productor. El bridge Windows actual transporta estados de control, no stdout/stderr/PCM de medición. No debe reutilizarse el job terminado ni presentarse la ruta PCM legacy como prueba de cierre de descendientes.

Siguiente implementación concreta: separar el transporte de resultados del canal de control; ejecutar cada medición en un job Windows propio con binarios/pins/argv fijados por el host, límites de bytes y deadline, y salida acotada; entregar stdout/stderr o consumir PCM únicamente bajo un ciclo de vida que confirme el árbol vacío. Aborto, timeout, exceso de cuota o cierre incierto deben rechazar y conservar archivos/fence. Después conectar esos puertos al comparador existente con referencias preview/audio pinneadas y cobertura de eventos, sin promover tags/recibos locales a prueba de color efectivo o procedencia autenticada. Esto continúa pendiente; no se ha construido ni activado ese host en esta iteración.

CAP-027 **85.80% estimado parcial**; CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** individual. Media de los siete **97.97%**. Sin crédito nuevo por un guard de inventario o cantidad de tests; permanecen medición efectiva color/A-V/corpus, procedencia y aislamiento Windows, además del QA formal.

## Bootstrap SDR integrado y admisión observada V3 (2026-10-07)

Nueva integración dirigida recorre `prepareMaterializedProducerLaunch` → configuración/plan pinneados → admisión real de paquete V4/árbol/roles/comparisonTools → observers originales → archivo forward/RGBA reverse → encoder/probes → ensamblaje → observación → receipts → colector independiente. Casos silent y AAC pasan; drift de decode timing llega al probe y rechaza sin `original-native.json`. Se elimina el silent temporal SDK antes de finalizar para demostrar que bootstrap conserva/revalida el encoded retenido, no depende de un temporal dispuesto. Drift posterior del output invalida el pin del colector. SDK/CDP/FFmpeg/audio/mux simulados; no render físico, fuentes personalizadas/decks/corpus ni aislamiento acreditados.

La integración detectó y corrigió dos incompatibilidades concretas: `createRenderJob` upstream normaliza FPS a `{num, den}`, no número; puerto usa num con den1 y limita24/25/30/60. Fracciones no admitidas rechazan. El full driver fija `enableStreamingEncode:false` y el runtime con puertos lo exige: un streaming encode podía saltar `runEncodeStage`. Preserva captura/audio/ensamblaje SDK originales, sin fallback sintético. El inventario de fixture inicialmente omitía comparisonTools; su rechazo temprano se corrigió agregando bindings reales, no relajando admisión. Test de drift exige llegar a cinco llamadas encoder/probe para no contar fallos tempranos ajenos como rechazo correcto.

Launch ahora permite SDR/mux **solo con instalación observada + plan V3**, contrato operativo válido y límites de perfil/duración/frames. Legacy y V2 sin plan continúan rechazando SDR. Bootstrap sigue verificando hashes del operador, paquete, plan, archivos y bindings en tiempo de ejecución; no inventa políticas desde el contrato. Puerto `sdrStagePorts` es exclusivamente una dependencia host de test, nunca campo de request/configuración serializada; CLI usa el ejecutor fijo de cierre. Paquete/runtime actualizado requiere nuevos pins aprobados por operador. Esto completa conexión/admisión en código; **no instala, activa ni despliega un worker**.

Validación actual **38/38** dirigidas: cuatro bootstrap (tres subcasos y suite), seis request/admisión, nueve full pipeline, cinco stages/VM y14 receta/runtime. Paquetes/árboles/PNG/pins/hashes/receipts reales, todos los binarios y CDP simulados. Tests escalados de bootstrap/receta para realpath/spawn syntax sobre temporales propios, sin quitar controles. Syntax MJS y build operativo pasan. No QA formal, render físico, migración aplicada, rollout ni vendor edits. HyperFrames/Core mantiene ownership de medios y pipeline; CAP-022/025/029 intactos.

CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** cada una; media siete **97.97%**. Conexión SDR integrada queda implementada con validación dirigida; bloque ponderado completo sigue abierto por medición propia color/A-V/corpus/procedencia/imagen efectiva/aislamiento Windows. No solo QA ni incremento por cantidad de tests. Próximo: conectar comparación audiovisual efectiva al host de procesos y cerrar esas obligaciones, no reiterar preparación de SDR ya conectada.

## Conservación de vídeo en remux silencioso conectada al adaptador (2026-10-07)

`verifySdrSilentAssemblyOutput` verifica la rama faststart original sin exigir igualdad del contenedor MP4. Comparte enumeración/probe/pins/metadata/paquetes/timing con AAC mux, pero exige un único stream de vídeo y ausencia de audio/streams extras. Conservación significa mismo payload ordenado, tamaños, extradata y timestamps normalizados, con perfil SDR/frameCount/duración/start observados y recheck de ambos archivos/probe. Rechaza cambios de payload, decode timing, perfil, archivos o señal. Pinning/recheck ahora reciben signal también en el verificador compartido. No repara ni modifica salida ni acredita color efectivo/origen/sync.

Nuevo identificador **interno de resultado** `COPIED_H264_REC709_SILENT_ASSEMBLY_V1`, scope `LOCAL_PROBED_SILENT_VIDEO_COPY_NOT_RENDER_ATTESTATION`, no añade una obligación esperada ni una política audio ficticia al contrato. `buildControlledExecutionObservation`/`buildOriginalExecutionObservation` exigen sus hashes de silent/output/probe y payload/timing para aceptar un output distinto del encoder. Sin resultado, cambio de hash sigue rechazado. Resultado silent en contrato AAC o sin SDR se rechaza; resultado incompleto/ajeno también. Legacy con output directo del encoder conserva su vinculación estricta de hash.

Adaptador V4 llama la verificación antes de disponer temporales SDK y devuelve `sdrSilentAssembly` al bootstrap, cuyo ensamblador consume el resultado. Audio mantiene su verificador AAC y la normalización/mux originales. Ya no se confunde reempaquetado de contenedor con recodificación del vídeo. **Admisión materializada continúa cerrada para SDR/mux hasta probar integración completa del bootstrap V3 con plan/observer/puertos y revisar admisión**; no despliegue ni habilitación productiva. Procedencia/sandbox Windows, color efectivo/A-V/corpus y QA formal continúan abiertos.

Validación **41/41** dirigidas: diez verificador mux/silent (dos nuevas), diez ejecución (una nueva con vínculo original), cuatro adaptador (una nueva; silent reescrito actualizado), nueve encoder, tres cierre hijo directo y cinco puertos/funciones SDK parcheadas en VM. PNG/filesystem/hashes reales; binarios/SDK/mux/CDP son fixtures. No FFmpeg/render físico/QA formal. Build operativo, compilación conjunta y syntax MJS pasan. HyperFrames/Core mantiene ensamblaje/medios/audio originales; CAP-022/025/029 preservados. Sin vendor edits, migración aplicada, instalación/rollout/despliegue.

CAP-027 **85.80% estimado parcial**; CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** individual; media siete **97.97%**. Se resuelve el bloqueo funcional del remux silencioso, pero no se declara cerrado el bloque SDR completo ni se concede crédito ponderado desde pruebas aisladas.

## Adaptador SDR conectado a puertos V4 y observación original (2026-10-07)

`original-session-sdr-stages.mjs` conecta el archivo forward completo al encoder SDR operativo: contrato/dimensiones/fps/count/paths/audio/signal fijados, rechecks de fuentes y frames, copia exclusiva del silent codificado al path SDK y comparación de sus bytes. Después del ensamblaje original verifica el output con el verificador mux operativo, incluyendo metadata, payload/extradata y tiempos de paquetes. Finalización revalida los archivos retenidos y frames; no depende de un silent temporal ya eliminado por SDK. Errores/etapas ausentes/output ajeno/aborto invalidan la finalización.

Bootstrap construye callbacks host exclusivamente desde el plan/paths fijados y se los entrega al loader V4. Combina resultados exitosos encoder/mux con file/CDP mediante `buildOriginalExecutionObservation`; no copia políticas esperadas. Resultados faltantes/foreign video se rechazan. Mantiene el código de error previo de binding para discrepancias archivo/CDP. Candidate y receipt no reciben callbacks ni paths privados del encoder.

`executeClosedStageFile` espera el cierre del **hijo directo**, incluso si execFile reporta aborto antes. Spawn fallido sin PID se rechaza sin inventar proceso vivo. Output buffered/timeout/env/argv siguen las cuotas de cada encoder/probe; no es prueba de cierre de descendientes ni de aislamiento Windows. Encoder conserva temporales al fallar en esta ruta (`retainWorkFilesOnFailure`), sin cleanup recursivo mientras puede haber árbol incierto. SDK/worker owner y su cierre/fence conservan responsabilidad sobre el árbol y retención; el modo legacy de encoder conserva su comportamiento previo de cleanup.

**Pendiente concreto, no solo QA:** admisión materializada aún rechaza SDR/mux explícito. Sin audio, `applyFaststart` upstream ejecuta un remux `-c copy`; su contenedor puede cambiar aunque el vídeo sea idéntico. La ruta actual exige hash idéntico y rechaza una reescritura: falta comprobar conservación de paquetes/timestamps del silent sin audio y vincular ese resultado antes de abrir el gate. No sustituir esta comprobación por metadata, expectativa ni cambio silencioso de política. Bootstrap V3 completo SDR con plan/observer/puertos también requiere prueba de integración dirigida; color efectivo/A-V/corpus/procedencia/sandbox continúan abiertos.

Validación dirigida: tres ejecutor con eventos de proceso simulados, tres adaptador operativo (PNG/archivos reales, FFmpeg/probe/mux simulados), nueve ensamblado de ejecución, nueve encoder (incluye retención nueva), ocho mux y ocho admisión/driver/bootstrap V2. Ambas compilaciones y syntax MJS pasan. No binarios reales/render/QA formal; pruebas loader escaladas por realpath/enlaces en temporales propios. Construcción del fixture usa test-build solo dentro del test; adapter/worker requieren exclusivamente build operativo. Sin vendor edits, aplicación de migraciones, instalación/rollout ni despliegue. HyperFrames/Core conserva captura/ownership de medios/audio originales; CAP-022/025/029 intactos.

CAP-027 **85.80% estimado parcial**; CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** cada una; media siete **97.97%**. Conexión en código no cierra todavía el bloque ponderado SDR completo ni acredita ejecución física; no crédito nuevo por tests aislados.

## Puerto de codificación y verificación post-ensamblaje en receta V4 (2026-10-07)

La extensión versionada ahora se identifica `COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V4`. Seis hooks y el wrapper son las únicas diferencias respecto a los bytes upstream fijados0.7.106. Nuevo puerto `onEncode` actúa en `runEncodeStage` después de la captura completa; sustituye únicamente esa etapa cuando el host proporciona también `onAfterAssemble`. Sin ambos callbacks se conserva el encoder upstream. No son campos serializados del request ni scripts enviados por el cliente.

El runtime vincula ambos puertos al job y AbortSignal originales, exige MP4 opaco/no GIF/no PNG sequence, número completo de frames, ausencia de capturas pendientes y paths distintos. Entrega solo un payload congelado de dimensiones/fps/cantidad/paths/audio/signal, no el job mutable. Callbacks se copian al entrar y en el loader admitido. Codificación única y resultado `encodeMs` estricto; etapas omitidas/repetidas, concurrencia de verificación, output ajeno y errores absorbidos quedan rechazados/latched. El tiempo reportado por el callback no es prueba de ejecución, color o rendimiento físico.

Hook post-ensamblaje corre **después** del mux/faststart upstream exitoso y **antes** de la disposición de temporales SDK. Normalización de duración del audio, preservación del priming cuando aplica y mux AAC originales permanecen intactos. Falla de mux no invoca verificación. Esto permite verificar el silent/output originales sin recodificar audio ni rescatar archivos después de su eliminación.

**Integración aún pendiente:** bootstrap no proporciona todavía estos callbacks; faltan conectar el encoder SDR y su probe/verificación con manejo seguro de procesos, resultados reales y ensamblado de observación. Admisión materializada sigue rechazando contratos SDR/mux explícitos. V4 no habilita SDR productivo ni cambia ese gate. Paquetes anteriores requieren reconstrucción y nuevos hashes aprobados por operador; no se autoaprueban ni se instalan. Scope `ORIGINAL_SESSION_HOOKS_NOT_CONFORMANCE_OR_SANDBOX` se conserva.

Validación **35/35** dirigidas:14 receta/runtime, cinco puertos/VM, ocho packaging y ocho admisión/driver/bootstrap V2. VM ejecuta funciones originales parcheadas de encode/assemble con encoder/audio/mux simulados; no importa SDK ni ejecuta Chromium/FFmpeg. Reversión de las seis inserciones reproduce exactamente upstream; syntax Node y árboles/hashes/archivos reales. Tests de syntax/packaging/admisión se ejecutan escalados por spawn/realpath en temporales propios, sin quitar controles. Sin QA formal, migración, rollout/despliegue ni vendor edits. HyperFrames/Core preserva ownership de medios y pipeline; CAP-022/025/029 intactos.

CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual; media siete **97.97%**. Puerto funcional y punto de verificación correctos no cierran por sí solos el bloque ponderado SDR/color/A-V/procedencia/aislamiento/corpus.

## Archivo acotado de frames forward originales para SDR (2026-10-07)

`createOriginalSessionFrameArchive` conserva copias de los screenshots forward originales en un subdirectorio exclusivo `original-forward-frames`, con escritura secuencial/backpressure. No incluye las recapturas reverse ni abre otra página. Exige índices consecutivos y tiempos cuantizados; rechaza concurrencia, duplicados, cobertura incompleta, aborto, directorio preexistente y excesos de las cuotas SDR existentes (36 000 frames, 20 MiB por PNG, 4 GiB totales). Copia el buffer antes del primer await y compara el pin de cada archivo con esos bytes; una operación rechazada no libera el bloqueo de otra operación todavía activa. Los fallos quedan latched.

Finalización verifica las fuentes y todos los pins, además de validar geometría, PNG opaco/perfil y cobertura completa mediante el validador SDR existente. Propaga signal durante hashing y rechecks. El resumen conserva `LOCAL_RECHECKS_NOT_IMMUTABLE_CAPTURE_OR_COLOR_ATTESTATION`: ni PNG opaco ni un hash acreditan color efectivo, aislamiento OS o procedencia física.

Observer operativo archiva condicionalmente cuando el contrato declara conversión SDR; bootstrap finaliza y revalida esos archivos. **La admisión materializada todavía rechaza SDR/mux y el ensamblador original exige resultados reales de esas etapas**. Por tanto, esta conexión preparatoria no habilita SDR productivo, no ejecuta encoder/mux y no elimina esos pendientes. No se entrega el resumen privado como evidencia de conformidad. Los archivos pertenecen al workspace de salida del job: este módulo no elimina directorios mientras la terminación del proceso puede ser incierta; su limpieza debe respetar el cierre/fence del propietario.

Validación actual **33/33** dirigidas: cinco nuevas del archivo (bytes prestados modificados inmediatamente, concurrencia, drift de fuentes/archivos, orden, aborto y perfiles), seis de secuencia SDR y 22 de captura nativa/fuentes. PNG/sharp/filesystem/hashes reales; CDP/SDK/video son fixtures. Se corrigió el fixture SDR para declarar las etiquetas de color obligatorias, sin debilitar el schema. Build operativo, compilación conjunta y syntax MJS pasan. No prueba de bootstrap SDR end-to-end, render físico ni QA formal; no migraciones/despliegue/vendor edits. HyperFrames/Core preserva ownership de medios y pipeline original; áreas paralelas CAP-022/025/029 intactas.

CAP-027 **85.80% estimado parcial**; CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** cada una; media siete **97.97%**. Sin nuevo crédito ponderado: faltan conexión encode/mux real, medición color/A-V/corpus y garantías de procedencia/aislamiento Windows, además de QA diferido.

## Observación de archivos/CDP conectada al recibo y al comparador (2026-10-07)

Admisión expone `readFileObservations` desde **pins calculados sobre bytes reales**, no copiando identidades esperadas del contrato/manifest. Re-enumera/revalida el árbol antes de entregar copias de roles y comparisonTools, sin paths. Hashing/recheck ahora transmite signal entre chunks. Scope conserva `DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF`: no acredita inode del ejecutable realmente cargado, DLLs, cachés de módulos, inmutabilidad OS ni aislamiento.

Loader observado y driver leen estas identidades antes/después del pipeline admitido. Su retorno interno las transporta a bootstrap; el archivo candidate bounded conserva su schema y no se convierte en evidencia. Bootstrap V3 combina los pins con Browser.getVersion original antes/después y hash del video mediante `buildOriginalExecutionObservation`, sin copiar políticas SDR. Receipt nativo exige `renderExecutionObservation`, colector lo vincula a documento/video/expectativas y puente lo incorpora al artefacto único o al conjunto de eventos. Observación contradictoria del medidor se rechaza. Recibos V3 antiguos sin este campo no pasan; V1/V2 conservan sus scopes y rutas.

**Límite funcional, no solo QA:** el productor materializado aún rechaza contratos que requieren conversión SDR explícita/mux. Archivos/CDP no prueban esas etapas, y el nuevo ensamblador exige sus resultados reales en lugar de declarar cumplimiento desde la expectativa. Su conexión operativa completa sigue pendiente junto con color/A-V, corpus, procedencia/aislamiento Windows. No se relaja el contrato para lograr MATCH.

Validación **75/75** dirigidas:12 inventario (observaciones/copia/drift ampliadas),8 ensamblado ejecución (cuatro nuevas),22 nativo/fuentes (receipt y conflicto del puente ampliados),14 eventos,8 admisión/driver/bootstrap V2,7 colector y4 puente. Árboles/pins/hashes/PNG reales; SDK, navegador/CDP/glifos/video y resultados SDR de tests son simulados. Rechazo de roles/CDP/output ajenos, observaciones ausentes y políticas SDR inventadas cubierto; no prueba física de runtime ni bootstrap V3 end-to-end real. Pruebas de inventario/admisión escaladas para realpath/enlaces en temporales propios, sin eliminar controles. Build operativo, compilación conjunta, syntax MJS y diff check pasan (avisos LF/CRLF).

HyperFrames/Core preserva pipeline/ownership de medios. No vendor edits, instalación, QA formal, migración aplicada, rollout ni despliegue; CAP-025/029 intactos. CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** cada una; media siete **97.97%**. Conexión file/CDP no cierra el bloque completo ni aporta crédito ponderado nuevo por sí sola.

## Repetibilidad RGBA desde screenshots originales del productor (2026-10-07)

Receta versionada `COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V3` conserva los cuatro puntos de instrumentación y el pipeline completo. El lease after-frame ahora permite preparar **y recapturar** un checkpoint con `prepareFrameForCapture` y `pageScreenshotCapture` originales del SDK. Capacidad temporal, límites de posición, aislamiento AsyncLocal, errores latched y restauración del frame original antes de devolverlo se conservan. Los bytes entregados al pipeline y a cada observador son independientes. Nuevos hashes de receta/runtime/output requieren reconstrucción y aprobación de inventario, sin cambiar vendor/instalación ni activar el worker.

`createOriginalSessionSeekCapture` recibe screenshots forward del productor, conserva hashes RGBA por checkpoint y recaptura reverse mediante el lease original. Decodificación PNG/dimensiones/cuotas por frame y sweep, orden/tiempo, documento congelado, recheck de archivos y aborto se validan. Todos los lotes reciben reportes ligados a sus contratos; un mismatch invalida la publicación completa. No conserva todo el video/frames en memoria ni compara solo el hash del PNG: compresiones PNG diferentes con el mismo RGBA pasan.

Observer/bootstrap agregan estos reportes al receipt nativo pinneado. Colector requiere `seekRepeatability` y, para eventos, `eventSeekRepeatability` cuando la política congelada los exige; ausencia, reordenamiento, contratos ajenos y discrepancia raíz/primer hijo rechazan. El puente integra los reportes originales en SINGLE_CONTRACT/EVENT_BATCH_SET y rechaza mediciones contradictorias, en vez de inventar reportes o copiar políticas esperadas. PASS de este reporte significa únicamente repetibilidad local SDK, no paridad preview/render, attestation, color/A-V ni cierre CAP-027.

Validación **77/77** dirigidas:14 receta/runtime (una nueva y VM ampliada con screenshot),8 packaging,8 admisión/bootstrap V2,14 eventos (tres nuevas RGBA y validación V3 ampliada),22 nativo/fuentes (observer operativo ampliado a RGBA),7 colector y4 puente. PNG/RGBA se decodifican realmente con sharp; filesystem/hashes/paquetes/criptografía son reales. Preparación SDK, screenshot/DOM/CDP/glifos y video son fixtures. VM ejecuta la función de captura parcheada y llama preparación/screenshot simulados, sin importar ni renderizar SDK. Bootstrap V3 completo con renderer real y fuentes multilote todavía no se acredita. Tests de receta/packaging/admisión necesitaron ejecución escalada por spawn/realpath/enlaces en temporales propios; no se eliminaron controles. Build operativo, compilación conjunta, syntax MJS y diff check pasan, salvo avisos LF/CRLF.

HyperFrames/Core mantiene ownership de medios y pipeline. CAP-025/029 preservados; no QA formal, migración aplicada, rollout ni despliegue. CAP-027 **85.80% estimado parcial**, seis CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual; media siete **97.97%**. Cierre de adquisición/consumo de repetibilidad en código no acredita aún el bloque completo del corpus, medición de ejecución/color/A-V, procedencia y sandbox Windows; no nuevo crédito ponderado.

## Evidencia nativa propia para particiones de eventos (2026-10-07)

El observer selecciona el nuevo orquestador de eventos cuando el contrato tiene `checkpointBatch`. Todos los contratos hijos se derivan del documento/plan padre congelado, y sus capturadores se conectan antes de navegar a la misma sesión CDP prestada. Un recorrido global forward captura cada lote; al último checkpoint global se verifican lotes y checkpoints en orden inverso mediante el lease original del SDK. Cada lote obtiene su propio texto/geometría y, cuando corresponda, sus propios glifos. No se copia el testigo padre para representar checkpoints posteriores. Error, cobertura incompleta o drift invalida el conjunto sin finalización parcial.

Bootstrap V3 publica `eventNativeEvidence` acotada en el mismo archivo nativo pinneado. El colector requiere este campo si el contrato es particionado; rederiva identidades desde el documento autorizado del host y valida cantidad/orden/contratos/cobertura, además de exigir que el testigo raíz coincida con el primer hijo. Recibos V3 particionados antiguos sin cobertura completa se rechazan, no hay fallback silencioso. V1/V2 y V3 de contrato único conservan sus rutas.

El puente conecta automáticamente cada evidencia a su lote `EVENT_BATCH_SET`, comprobando documento/contrato/video y conflictos con mediciones entregadas. Un evento particionado no puede degradarse a `SINGLE_CONTRACT`. No genera observaciones de ejecución, repetibilidad RGBA, audio ni color; el medidor sigue siendo obligatorio. Scope local/no-attestation y gates existentes se preservan. HyperFrames/Core conserva pipeline completo, ownership de medios y preparación/restauración SDK, sin modificar vendor.

Validación: build operativo y compilación conjunta pasan, resolviendo el bloqueo transitorio observado en el corte previo sin editar CAP-029. **44/44** dirigidas:11 eventos (tres nuevas),22 nativo/fuentes,7 colector y4 puente. Nuevas pruebas recorren orquestador, validación real del receipt V3 y construcción real del conjunto de comparación; geometría, CDP, preparación SDK, imágenes de repetibilidad y video son fixtures, no render físico. Las regresiones de archivos/pins usan filesystem real. `node --test` multiarchivo fue bloqueado por spawn EPERM del sandbox; ejecución directa de las cuatro suites pasa sin desactivar controles. Syntax MJS y diff check pasan. Fuentes personalizadas de múltiples lotes, bootstrap V3 end-to-end real, color/A-V, corpus y aislamiento Windows quedan por validar/cerrar, no se atribuye prueba física a la preparación simulada.

CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** cada una; media siete **97.97%**. Hay avance funcional en cobertura nativa por lote, pero no cierre del bloque completo de medición/procedencia/sandbox ni crédito ponderado nuevo. QA formal, migraciones, rollout y despliegue siguen diferidos; CAP-025/029 preservados.

## Consumo del testigo nativo por el comparador (2026-10-07)

La vinculación nativa distingue geometría de texto de observación de fuentes personalizadas. Contratos v4 sin bindings de fuentes pueden consumir texto original sin inventar un testigo de glifos; con bindings, las fuentes siguen siendo obligatorias y conservan `OBSERVED_UNATTESTED`. El colector V3, constructor de artefactos y comparador del video exportado usan el mismo validador. El comparador entrega geometría a la medición visual y agrega resumen de fuentes únicamente cuando existe.

El puente incorpora automáticamente la evidencia original al artefacto `SINGLE_CONTRACT`, comprobando identidad del contrato congelado, documento y video. Una geometría distinta entregada por el medidor se rechaza. Copias y recheck de bytes se conservan. No sintetiza ejecución, seek, audio, color ni PASS. `EVENT_BATCH_SET` no recibe el testigo padre: necesita cobertura propia validada; ese bloque sigue pendiente.

La integración dirigida recorre receipt/colector V3/puente/construcción de artefactos con archivos y hashes reales. Video, CDP, glifos y observación de ejecución son fixtures, no se ejecutan binarios ni se acredita render físico. **59/59** dirigidas pasan:22 nativo/fuentes (dos nuevas y una integración ampliada),26 ejecución/eventos/firma y11 colector/puente. Build operativo pasó. Última compilación conjunta detenida por `html-editing-slots.server.ts:25` de CAP-029 (`detach` no pertenece a `Cheerio<AnyNode>`); no se modifica el archivo paralelo. Pruebas TypeScript emitidas ejecutadas directamente no sustituyen compilación aprobada. Syntax MJS y diff check pasan; solo advertencias LF/CRLF.

Revalidación final: el build operativo que había pasado también quedó detenido por el mismo error paralelo `detach` de CAP-029 al entrar su nuevo módulo en el grafo. No se declara build final aprobado ni se modifican archivos del compañero. Los59 resultados dirigidos se mantienen como evidencia acotada del código emitido, no del conjunto compilado ni del render físico.

Se preservan CAP-025 y CAP-029, QA formal, migraciones y despliegue diferidos. HyperFrames/Core mantiene ownership de medios, seeks y pipeline completo. CAP-027 **85.80% estimado parcial**: consumo del contrato único no cierra medición original completa ni pendientes operativos. CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** individual; media siete **97.97%**. Sin crédito adicional hasta auditar el bloque completo con la rúbrica existente.

## Orquestador nativo conectado a sesión original y colector V3 (2026-10-07)

`startOriginalSessionNativeCapture` reutiliza la captura DOM/geometry y fábrica de glifos ya existentes. Se inicia antes de navegar; checkpoints forward se leen después de preparación SDK, en frame/time congelados. En after-frame del último checkpoint, prepara cada punto en orden inverso mediante lease SDK V2, relee geometría y glifos, exige igualdad exacta y cobertura completa antes de finalizar. El runtime del lease restaura posición original antes de devolver frame al SDK; no se llama un seek manual ni se reemplaza la página. Errores/omisión/drift/timing quedan latched; cleanup solo elimina listeners/handles propios.

Bootstrap V3 conecta observer fijo y crea `original-native.json` exclusivo/bounded ligado a request/plan/documento/proyecto/ejecución/hash+tamaño del vídeo. Pin/recheck del archivo y fuentes antes de entregar resultado. Colector V3 exige testigo, schemas/bindings y revalida texto contra contrato y fuentes mediante validador operativo; ausencia/scope inventado/fuentes omitidas/drift rechazan. Puente entrega clones/testigo/pin a measure y comprueba bytes después. V1/V2 preservados; nuevo módulo/recibo declarados en inventario. No se genera baseline de operador, se instala ni activa el worker.

Alcance **SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY / OBSERVED_UNATTESTED** conservado: datos CDP no prueban binarios de renderer, fonts de sistema/deck/color ni paridad física del vídeo. `measure` sigue obligatorio y debe consumir el testigo con comparación completa; no se crean artifacts/PASS a partir de receipt o digest. Coste de verificaciones y reverse/media en SDK real requiere medición posterior; sin inmutabilidad OS no se omiten hashes por rendimiento.

Validación: **52/52** dirigidas en selecciones20 native/fonts (cinco nuevas),24 recipe/collector/bridge y8 loader/bootstrap. Nuevo test del observer fijo ejecuta lector geometry operativo con CDP/DOM/glifos/lease simulados; testV3 usa bytes/filesystem reales, validadores operativos y contrato con custom font, ausencia/plan/video/scope/font omission/drift rechazados. Build operativo pasó antes de cambios paralelos de CAP-029. Última compilación conjunta detectó cuatro errores transitorios CAP-029 en compiler/inspector HTML; no se corrigieron desde este bloque. Tests emitidos actuales del observer fijo se ejecutaron directamente20/20; esto no convierte la compilación conjunta fallida en verde. Syntax/diff pasan. Sin SDK/Chromium/FFmpeg real/QA formal/DB/migración/deploy; loader en temporales propios fuera del sandbox para controles de alias reales. No cierre físico de reverse/media ni fonts/procedencia por usar mocks.

HyperFrames/Core preserva timing/medios/ownership y pipeline completo. CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual, media siete **97.97%**. No hay cierre de bloque operativo completo ni crédito ponderado nuevo: quedan color/A-V/corpus/procedencia/sandbox Windows y consumo completo de mediciones, además de QA diferido. Cambios CAP-029 paralelos preservados, sin tocar store/API/DB de CAP-025.

## Preparación inversa mediante sesión original del SDK (2026-10-07)

Receta identificada `COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V2` conserva fuente upstream fijada0.7.106 y sus cuatro puntos de hook; after-frame recibe capacidad temporal que llama **prepareFrameForCapture original**, incluyendo seek, onBeforeCapture de medios, composición y esperas del SDK. No se implementa un seek manual del DOM ni un render alterno. Callback solo puede preparar frames ya alcanzados, dentro de la misma ejecución; secuencias concurrentes, resultados inválidos, escape de lease y fallo SDK/restauración quedan latched.

Si se usó la capacidad, antes de devolver el frame al pipeline se prepara/restaura su posición original y se comprueba quantizedTime. Bytes de screenshot originales se conservan. Paquetes anteriores no se adoptan silenciosamente: la nueva receta/id/runtime/output requieren reconstrucción y aprobación de digest/inventario; no se modifica node_modules, configuración productiva ni instalación.

Esto habilita conexión de geometría/fuentes en orden inverso; aún falta el orquestador que capture ambos recorridos, compare y publique evidencia. No acredita conformidad ni comportamiento físico de extracción/medios en reverse. HyperFrames/Core preserva ownership/timing y pipeline completo. CAP-02785.80% estimado parcial, CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente individual, media siete97.97%; sin nuevo crédito hasta cerrar medición integrada.

Validación **34/34** dirigidas:26 recipe/runtime/adapter/observer y8 packaging. Dos pruebas nuevas, VM ejecuta función capture parcheada real con prepare/screenshot simulados e invoca el lease. Restauración, escape/errores absorbidos y bytes preservados cubiertos; reversión byte-a-byte y syntax del bundle, hashes/filesystem/paquete completos reales. Packaging fuera del sandbox en temporales propios para enlaces/realpath; no import ni render SDK/Chromium/FFmpeg/QA formal/DB/deploy. TypeScript no cambió en este corte.

## Cancelación incremental del pin de archivos (2026-10-07)

El lector comprueba aborto entre archivos y transmite signal al hash/recheck operativo. `pinConformanceFile` conserva compatibilidad y observa cancelación antes de abrir, durante cada chunk y después de validar identidad; finally libera el handle. No prueba cancelación del I/O nativo ya enviado ni terminación del proceso: owned/deadline/STOPPED siguen necesarios.

Build operativo aprobado y **15/15** dirigidas (dos nuevas con bytes/filesystem reales y aborto determinista en primer checkpoint de stream,13 regresiones request/collector). Sin SDK/render/QA formal/DB/rollout; no se revalidan los45 anteriores como conjunto. Pendiente conectar plan a fonts/geometry/seeks originales. CAP-02785.80% estimado parcial, seis restantes100% implementación registrada/QA pendiente individual, media siete97.97%; sin nuevo crédito ponderado.

## Transporte de plan autorizado al proceso observado (2026-10-07)

Materialización escribe `controlled-measurement-plan.json` exclusivo/bounded, fuera de sus propios pins para evitar hash autorreferencial. Conserva documento/contrato/fonts/pins de fuente autorizada; el host pinnea el archivo y lo revalida en sus lecturas/ciclo owned. Request V3 lleva solo hash/tamaño de ese nombre fijo y digest execution, sin ruta de plan/código/callback configurable. V1/V2 mantienen sus contratos; materialización nueva con instalación observada selecciona V3, sin caída a legacy.

Bootstrap V3 lee bytes con pin/UTF8 estricto, schemas operativos de documento/contrato/fonts, bindings tenant/revisión/proyecto/documento/contrato/fps/execution, cuotas y archivos requeridos; verifica hashes/tamaños/font paths y rechaza traversal/case aliases/enlaces observados. Rechecks antes/después de SDK y antes de entregar testigo; imports de lectura/política incluidos en inventario del puente. La procedencia autorizada proviene del host que fija el hash, no del plan por sí solo. No prueba inmutabilidad OS ni aislamiento de red/archivos.

Plan recibido por proceso, todavía no consumido por captura de fuentes/geometría/seeks originales: siguiente bloque debe enlazarlo al observer y preparar/verificar/restaurar checkpoints mediante pipeline del SDK. Scope fuente/no evidencia conservado. HyperFrames/Core preserva pipeline/medios/timing. Sin render físico/QA formal/FFmpeg/migraciones/deploy ni modificaciones store/API/DB de CAP-025.

Validación final: build operativo y compilación de pruebas pasan; **45/45** dirigidas (16 materialización,21 request/bridge/collector/observer,8 loader/bootstrap), tres pruebas nuevas y asserts bootstrap V3 ausente antes de import SDK. Filesystem/ZIP/hash/admisión reales; SDK/CDP/arranque/media simulados, manifiesto vacío en nueva fixture. Lector/loader fuera del sandbox para controles realpath/enlaces de temporales propios; fallo dentro del sandbox reproducido, sin debilitar validación. Syntax checks de reader/bootstrap y diff whitespace pasan. No TypeScript global ni pruebas físicas.

CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual; media siete **97.97%**, cierre roadmap7/30=23.33%, no implementación global. Sin crédito ponderado hasta medición original integrada.

## Plan de medición nativo conservado en materialización (2026-10-07)

Materialización conserva una copia privada del documento/contrato/manifiesto de fuentes ya verificados desde el archivo autorizado, junto a tenant/revisión/proyecto/documento/contrato SHA y pins de archivos. `readMeasurementPlan` revalida archivos y permisos HTML actuales antes de entregar una copia. El adapter entrega el plan al ejecutor y un verificador host en un argumento separado: workspace sigue siendo serializable y las mutaciones del consumidor no cambian autoridad ni pins. Compatibilidad legacy conserva plan/controles opcionales; su ausencia no habilita medición de fuentes.

Executor owned consume ese verificador bajo deadline antes de arrancar y después de confirmar STOPPED, antes de entregar candidato. Fallo previo no inicia procesos; fallo posterior rechaza resultado sin fingir terminación incierta de un Job ya cerrado. El callback host no se serializa ni se transmite como código al proceso Windows.

Scope `AUTHORIZED_MATERIALIZED_SOURCE_NOT_CAPTURE_EVIDENCE`: no se infiere el documento desde HTML ni se declara conformidad. El transporte autenticado al proceso observado y su conexión con seeks/geometry/fonts originales siguen pendientes. HyperFrames/Core conserva medios/timing del SDK; sin QA formal/render/FFmpeg/migración/deploy ni cambios store/API/DB de CAP-025. Pruebas dirigidas usan archivo ZIP y filesystem reales con red/media simulados y manifiesto vacío; no prueban carga física de fuentes.

Validación del corte: build operativo y compilación de pruebas aprobados sobre código final; **37/37** dirigidas (14 materialización,12 ownership,11 puente), cuatro nuevas. Mutaciones de copias, drift nativo/fonts, clonabilidad del workspace, orden verify/start/stop/verify y fallos antes/después del proceso cubiertos. Puente/procesos/medios simulados; ninguna ejecución SDK/Chromium/FFmpeg ni QA formal. `git diff --check` sin errores (advertencias LF/CRLF).

CAP-027 **85.80% estimado parcial**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual, media siete **97.97%**. Sin nuevo crédito ponderado mientras no se cierre el bloque completo de medición original; cierre roadmap7/30=23.33%, no implementación global.

## Fábrica de fuentes sobre CDP prestado del productor (2026-10-07)

Adapter CompositionQaCdpClient para canal SDK send/on/off: solo listeners propios, nunca detach/cierre del SDK ni listeners ajenos. Quota32, cleanup/reintento de off fallido, error latched de callbacks/suscripción, abortos y respuestas tardías; Runtime.releaseObject permite liberar handles tras aborto. No se confunde aborto con terminación del comando remoto: SDK/host conservan ownership/fence.

Fábrica startOriginalSessionFontCapture toma canal original, URL loopback del SDK, documento/contrato/fonts congelados y verifyFiles; reutiliza startControlledFontCapture, no duplica captura de glifos. Limpia listeners en captura/repeat/finalización fallidas, exige todas las verificaciones de checkpoints en orden inverso antes de finish, sin aceptar una etiqueta repeatability como sustituto. Esa secuencia de llamadas no prueba seek físico: siguiente conexión debe controlar seek/restore del pipeline e inspeccionar geometría original. Witness conserva scope no-attestation; no promover a fuentes PASS ni conformidad general.

Entradas nuevas añadidas al build operativo y smoke de carga de módulos sin procesos; build operativo y compilación de pruebas aprobados. **15/15** regresiones de fuentes, tres nuevas de fábrica (happy/missing repeatability/reverse calls/fallback); CDP/events/fonts/geometry simulados, sin Chromium/render/FFmpeg/QA formal/migración/deploy. Fábrica aún no conectada al bootstrap: falta transferir el plan completo autorizado/documento/fonts y medición original de texto/seeks, no una reconstrucción synthetic o preview posterior. HyperFrames/Core mantiene medios/timing y ownership del SDK.

Más **9/9** checks del CDP prestado y runtime emitido (cinco nuevos, cuatro de carga/cierre de imports): listeners ajenos intactos, no detach, cuotas/suscripción fallida, errores latched seguros, abortos/respuestas tardías/handle release, orígenes remotos/plans inválidos, sin ejecutar procesos. Total del corte **24/24** sobre estas selecciones, no una ampliación de los56 del corte anterior.

CAP-027 **85.80% estimado parcial**, media siete **97.97%**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual. Sin crédito del bloque de fuentes aún no integrado; closure roadmap7/30=23.33%, no implementación global. Continúan fuentes/color/texto/checkpoints/A-V, procedencia y sandbox Windows pendientes. Las pruebas anteriores de collector/bootstrap56 no se dan por ampliadas con este corte diferente.

## Colector exige testigo original antes de medición (2026-10-07)

Bootstrap liga registro original a hash/tamaño del vídeo final y recheck después de escribir; colector V2 exige expectativa execution del descriptor y ceil(durationSeconds*fps), valida schema estricto/bindings request/ejecución/documento/proyecto/vídeo/expectedBrowser/count/frameDigest, quota8192/UTF8, rechazo de enlaces/hardlinks observados y pin real/recheck. Scope candidato/registro original no se convierte en artifacts. V1 conserva contrato legacy, sin promoción.

Puente consume registro antes de measure, entrega clones de registro/pin y revalida archivo/receipt/vídeo después. Callback no puede mutar pins privados por sus clones; archivo ausente antes de medición no llama al medidor, drift en callback impide devolver artifacts. El medidor sigue siendo obligatorio y debe poseer/cerrar sus procesos: no se generan métricas desde el registro. No recomputar frameDigest desde vídeo ni presentarlo como fuentes/color/attestation física.

**56/56 dirigidas**: selección conjunta packaging/recipe/loader/bootstrap/observer/adapter/request/collector/bridge, cuatro nuevas de collector+bridge además de cuatro legacy del colector incorporadas. Filesystem/hash/admisión reales y SDK/CDP/arranque/medición simulados; bytes no-media. Bootstrap fixture ahora crea vídeo byte real y se comprueba pin; no SDK real/Chromium/FFmpeg/render/QA formal/DB/migración/deploy. Pruebas de paquetes fuera del sandbox para realpath/enlaces de temporales propios; controles collector/bridge pasan también dentro. TypeScript global y siete checkpoints históricos no revalidados.

CAP-027 **85.80% estimado parcial**, media siete **97.97%**; CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual. Se cierra enlace de registro estructural original a colector/measure, no bloque operativo completo: sandbox Windows/cierre transitivo, mediciones propias completas de fuentes/color/texto/checkpoints/A-V y procedencia siguen pendientes. Sin nuevo crédito ponderado ni cierre por cantidad de tests. Cierre roadmap7/30=23.33%, no implementación global. HyperFrames/Core conserva pipeline y distingue candidato/testigo/evidencia. Próximo: conectar mediciones existentes a la sesión productora original, no sustituirlas por digest o preview posterior.

## Bootstrap observado fijo y testigo de sesión original (2026-10-06)

Puente selecciona entry fijo run-observed-materialized-producer cuando el operador suministra referencia path+SHA declarada en inventario padre. JSON bootstrap4MiB/UTF8 estricto/claves exactas, sin código/callback/ruta de módulo configurable. Debe vivir en raíz de metadata separada del runtime para evitar hash autorreferencial; padre declara bootstrap+runtime. Request V2 incluye digest canónico renderExecution del descriptor, comparado con execution de configuración aprobada; V2 sin instalación observada rechaza antes de SDK y no cae a V1. Rechecks de configuración conservados, sin generar baseline desde job.

Observer fijo conserva CDP original antes de navegación, valida Browser.getVersion frente al contrato y registra digest incremental de los frames originales (máximo36000, sin guardar buffers completos). Rechaza secuencia/cambio de sesión/versión/bytes/aborto/fallo absorbed. Browser se consulta tras cada frame antes del cleanup SDK: overhead por frame pendiente de medición. Escribe original-session.json separado, ligado a digest request/ejecución/documento/proyecto. Scope explícito candidato/testigo, **no** conformance/supervisor artifact/fonts/color/pixel parity/attestation binaria. Colector y measure todavía deben integrarlo con mediciones existentes, no usar el digest como PASS.

Bootstrap y puente conectados en código, sin instalación/configuración baseline ni arranque Windows real. PS bridge existente ya sanea entorno por allowlist antes de Start; la observación anterior sobre NODE_OPTIONS intraproceso no elimina ese control existente ni prueba aislamiento. Token/ACL/red/cuota disco/dynamic loading y evidencia completa siguen pendientes. Rama legacy no se promueve. HyperFrames/Core conserva stages/medios y separa registro original de conformidad. CAP-02785.80% estimado parcial, seis restantes100% implementación registrada/QA pendiente individual, media siete97.97%; cierre roadmap7/30=23.33%, sin nuevo crédito del bloque operativo aún incompleto.

**48/48 dirigidas** en selección conjunta: bootstrap con configuración/filesystem/hash reales y SDK/CDP/arranque simulados; captura/versión/secuencia/drift/aborto, requestV2/digest canónico, V2 sin fallback, referencia declarada del puente y regresiones de loader/packaging/adapter. Siete comprobaciones adicionales respecto al corte41; no import SDK real/Chromium/FFmpeg/render/QA formal/migración/DB/deploy ni TypeScript global en este corte. Ejecución fuera del sandbox para controles realpath/enlaces de temporales propios, sin omitirlos. Próximo: colector exige y vincula testigo original antes de measure/supervisor, manteniendo separación frente a conformidad física.

## Admisión antes de cargar y port del driver observado (2026-10-06)

`admitted-observed-producer.mjs` reutiliza admitControlledDependencyInventory del build operativo. Admite contrato+inventario declarado, verifica paquete con digest aprobado, liga rol producer al entry y exige todos sus pins declarados; rutas browser/encoder/decoder deben coincidir con roles antes del import. Recheck antes/después de importar y antes/después de ejecutar; solo namespace instrumentado, wrapper ligado a señal/callbacks, sin exposición de executeRenderJob legacy. Sigue siendo gate de bytes declarados, no prueba de caché ESM segura/cierre dinámico/OS image/immutabilidad; proceso owned fresco requerido.

Driver acepta instalación y callbacks host-only, ausentes del schema request/client; limpia entorno antes de cargar, liga rutas nativas del request a roles y propaga señal. Instalación observada parcial o producer arbitrario en paralelo rechaza sin fallback; drift impide receipt. Candidate conserva scope no-conformance. Bridge declara imports estáticos nuevos. **El CLI/bridge todavía no suministra instalación observada**: no confundir conexión por port con bootstrap de proceso terminado. Rama legacy no se promueve ni elimina silenciosamente; falta bootstrap operativo y observación/medición efectiva. Limpiar NODE_OPTIONS dentro del driver no evita preloads previos: pendiente entorno saneado antes de arrancar, token/ACL/red/disk del host Windows.

**41/41 dirigidas**: siete comprobaciones nuevas con paquete/crypto/filesystem reales y admisión operativa existente; namespace SDK/import/binaries/proceso simulados. Rechazos digest/roles/package/dependency drift, cambios durante import o tras render, namespace sin hooks, señal/callbacks ajenos, recibo candidato y secretos limpiados. Selección conjunta incluye packaging/receta/adapter/request/bridge. Ejecutadas fuera del sandbox para realpath/enlaces de temporales propios; no SDK real/Chromium/FFmpeg/render/QA formal/DB/migración/deploy. No TypeScript global revalidado en este corte MJS; errores Buffer informados por otro compañero no se dan por resueltos.

CAP-027 **85.80% estimado parcial**, media siete **97.97%**; seis CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** individual. Sin crédito del bloque de ejecutor integrado mientras bootstrap/mediciones/aislamiento siguen abiertos. Cierre roadmap7/30=23.33%, no implementación global. HyperFrames/Core conserva productor completo y separa candidate/observación/evidencia. Próximo bloque: configuración fija del operador vinculada al bootstrap de proceso, no módulos/rutas enviados por cliente.

## Packaging reproducible de extensión y fragmento de inventario (2026-10-06)

`build-producer-extension-v1.mjs` copia archivos del paquete completo a destino nuevo fuera de node_modules, conserva recursos/dist/package.json/LICENSE y agrega runtime junto al index transformado. Fuente/version/hash fijados por receta; manifesto determinista con pins de entrada/salida y hash de receta, completion marker escrito al final tras rescans. Límites de árbol/bytes, rechazo de enlaces/junctions/hardlinks/aliases observados, lectura por handle con recheck de identidad/tamaño/mtime/ctime; sin overwrite ni cleanup de salida parcial. Archivo mode0600 no acredita ACL Windows ni cuotas/immutabilidad OS.

Verificador exige digest aprobado externamente: no deriva autoridad del propio artifact/job. Proyector devuelve todos los pins, incluido marker/runtime, y solo rol producer; fragmento requiere admisión completa del host existente. No es inventario global, cierre dinámico, instalación productiva ni nueva ruta de fallback. Destino final debe resolver y declarar dependencias npm/transitivas; todavía no se importa SDK ni se conecta el driver. Aborto tras marker puede conservarlo, pero devuelve fallo y no promueve la salida.

**28/28 dirigidas** con filesystem/crypto reales: dos builds idénticos del paquete instalado, vendor intacto, todos los archivos/recursos/licencia preservados salvo entry instrumentado, fragmento/rootId, pins externos, overwrite rechazado, runtime alterado/archivos extra/marker ausente, hardlinks/junctions y regresiones originales. Realpath/enlaces dieron EPERM dentro del sandbox; repetición fuera con temporales propios pasó sin omitirlos. Una revisión automática adicional expiró sin ejecución; reintento autorizado terminó aprobado. Sin SDK real/render/Chromium/FFmpeg/QA formal/migraciones/deploy. Temporales de prueba eliminados, sin instalación persistente.

CAP-027 **85.80% estimado parcial**, media siete **97.97%**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual. Se cierra la preparación reproducible del paquete, no aún el bloque ponderado de inventario/ejecutor integrado; sin doble crédito. Cierre roadmap7/30=23.33%, no implementación global. Próximo: admisión del paquete en configuración/driver observado, observaciones efectivas y medición owned, restricciones Windows. HyperFrames/Core conserva stages y recursos originales.

## Decisión confirmada y receta de extensión original (2026-10-06)

El usuario confirmó **Windows con permisos restringidos** y autorizó una **extensión versionada del productor completo**, sin modificar silenciosamente node_modules ni desplegar/QA formal. Sustituye la decisión pendiente del corte siguiente; no acredita que Windows esté ya aislado. Job Object sigue siendo control de procesos/cuotas, no token/ACL/red/filesystem/disk sandbox.

Receta pura `producer-extension-v1.mjs`, fijada a productor0.7.106 y SHA-256/tamaño del bundle instalado: cuatro hooks originales y wrapper que delega a executeRenderJob completo, sin sustituir compile/probe/medios/audio/capture/encode/assemble/cleanup. Runtime separado con AsyncLocalStorage, callbacks host-only antes de navegación y alrededor del screenshot ya preparado, CDP original del SDK, copia del buffer/hash original, perfil single-worker/software/screenshot sin pool/dedup, failure latch y abortos. Adapter admite observer únicamente con extensión explícita; no fallback cuando se solicita observar. La ruta legacy conserva su comportamiento y el driver no se activa.

**20/20 pruebas dirigidas**: transformación del bundle real y reversión byte-exacta, sintaxis sin importar SDK, drift, callbacks/fallo absorbido/abortos/perfiles/concurrencia, función captureFrameCore transformada en VM con captura/seek simulados y regresiones del adapter. No ejecución del SDK real/Chromium/FFmpeg/render/QA formal/migración/deploy. Callbacks confiables pueden usar sesión mutable: no son aislamiento ni causalidad física. Packaging/inventario de dist completo más runtime/recursos/licencia, integración de medición owned/evidencia original y sandbox Windows siguen pendientes.

CAP-027 **85.80% estimado parcial**, media siete **97.97%**; CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** individual. Sin crédito de cierre por receta todavía no instalada/integrada; cierre roadmap7/30=23.33%, no implementación global. Próximo bloque: packaging reproducible fuera de node_modules e inventario del runtime, después conexión a observaciones/medición y restricciones Windows. HyperFrames/Core conserva el pipeline audiovisual original.

## Decisión requerida para la integración productora (2026-10-06)

Revalidación de código, no nueva implementación: `createMaterializedProducerBridgeConfiguration` todavía exige `input.measure`; el candidato del adapter no constituye los artifacts requeridos. `OwnedRenderJob.cs` declara control de procesos/cuotas, no sandbox de filesystem/red/token. Los Dockerfiles API/audio no son una decisión del entorno del renderizador. Falta definir Windows restringido o Linux con contenedor aislado antes de implementar garantías específicas de ese entorno.

La instalación fijada @hyperframes/producer0.7.106 exporta createRenderJob/executeRenderJob, pero RenderConfig no admite un hook para observar su sesión CDP original. El createBeforeCaptureHook observado está en executeDiskCaptureWithAdaptiveRetry; ese módulo interno no es un subpath público en package.json (solo raíz/server/distributed). Importar internals por ruta absoluta, modificar node_modules silenciosamente u observar otra sesión no cierra el requisito.

Hace falta acordar el mecanismo de integración: extensión versionada del pipeline completo para exponer observación original, o composición propia de stages que conserve todas las obligaciones de medios/captura/encode/assemble/cleanup. La segunda opción no puede reducirse al corpus neutral o a captura de screenshots sin audio. Antes de asumir mantenimiento de un fork/extensión de tercero, solicitar dirección explícita. La elección del entorno y del mecanismo no autoriza despliegue, cambios de dependencia instalados, QA formal ni migraciones.

Sin cambios de runtime ni nuevas pruebas en este corte. CAP-02785.80% estimado parcial y media siete97.97% sin incremento; seis restantes100% implementación registrada/QA pendiente individual. El bloqueo de cierre no es falta exclusiva de QA. No marcar objetivo completado ni recortar el alcance al adapter existente.

## Supresión nativa sin alterar superficies currentColor (2026-10-06)

Revisión del bloque de texto encontró que la supresión nativa forzaba color transparente, a diferencia del deck. Eso podía alterar fondos/bordes dependientes de currentColor y contaminar el delta atribuido al texto. Se elimina esa modificación: solo fill/stroke/shadow/caret de texto cambian. La función CDP autocontenida exige IDs únicos, namespace HTML, cuota incluyendo roots sin descendientes y snapshots acotados de CSS/texto/hijos/geometría. Drift de propiedades no suprimidas, contenido, identidad de hijos o bounds rechaza antes de tomar la captura suprimida. El wrapper conserva eliminación del stylesheet y comprobación del PNG restaurado incluso tras fallo.

**39/39 pruebas dirigidas**, cuatro nuevas sobre DOM simulado: currentColor intacto en la regla, drift de cuatro clases, root quota/IDs ambiguos/SVG, CSS oversized. Regresiones de deck, captura/restauración, derivación de PNG reales, máscara/halo/expansión, glifos/oclusión y comparación permanecen verdes. No navegador/render/SDK productivo/FFmpeg/QA formal/migraciones/despliegue. La simulación no prueba comportamiento CSS físico en Chromium ni convierte máscaras conjuntas en causalidad por glifo.

CAP-027 **85.80% estimado**, sin crédito por corregir una garantía previamente contabilizada; media siete **97.97%**, CAP-004/009/010/017/023/026 **100% implementación registrada/QA pendiente** individual. Sigue parcial, con14.20% estimado pendiente de integración/aislamiento/evidencia efectiva. HyperFrames/Core mantiene el timing y la separación de evidencia audiovisual.

## Build operativo separado de pruebas (2026-10-06)

`tsconfig.composition-worker.json` selecciona entradas operativas y imports transitivos, emite a `apps/web/dist/composition-worker` sin tests/API routes, con noEmitOnError y resolución Node16. Esta última conserva el import dinámico del subpath ESM color-grading. Contrato/schema HyperframesPlan extraído a módulo sin IA; factory/project-builder importan el contrato directamente, servicio conserva reexport compatible. Evita arrastrar el servicio Gemini por un import de tipos al compilar el worker.

Colector materializado y runners de conformidad/gate final consumen esa salida fija sin fallback al build temporal. `build:composition-worker` y `test:composition-worker-runtime` documentados en README de herramientas; comandos de arranque/gate compilan el runtime operativo. No se ejecutan dichos comandos de arranque/gate. Prototipos synthetic conservan su build de pruebas, sin promoción a producción.

Build dedicado y diez comprobaciones dirigidas aprobados: carga de entradas sin iniciar trabajo, cierre emitido sin tests/rutas/imports temporales/servicio IA, import dinámico ESM conservado y seis regresiones collector/configuración con filesystem/crypto reales y procesos simulados. Selección ampliada **44/44** añade regresiones del plan determinista, project-builder y factory del documento. TypeScript web/build de pruebas y diff-check aprobados. No imagen/bundle autónomo ni inventario operativo aprobado: librerías dinámicas, binarios, aislamiento físico, medición owned y sesión CDP original siguen pendientes. Dockerfiles existentes pertenecen a API/audio, no resuelven entorno del renderizador. Sin invocar SDK productivo/render/FFmpeg/QA formal/migraciones/flags/despliegue.

CAP-027 **85.80% estimado**, sin crédito nuevo por packaging parcial; media siete **97.97%**. CAP-004/009/010/017/023/026 **100% implementación registrada, QA pendiente** individual. El build propio elimina una dependencia operativa de pruebas, pero no cierra ejecución integrada ni el 14.20% pendiente. HyperFrames/Core mantiene el pipeline audiovisual sin sustitución por un productor reducido.

## Comparador audiovisual conectado a ejecución del host (2026-10-06)

Comparador existente conservado: probe/dimensiones/fps/timeline, extracción checkpoints, métricas visuales, loudness y PCM A/V. `ComparisonProcessPorts` permite sustituir conjuntamente pixelDecoder/probe/execute/consumePcm por implementación del operador; comparación de referencia persistida propaga ese objeto host-only. Configuración parcial rechaza antes de lectura/spawn, rutas no provienen de receipt/client y pins de herramientas permanecen obligatorios. Sin ports, consumidores locales legacy conservan comportamiento; esto no activa el worker ni acredita que el port implementado sea sandbox.

La revisión detectó una consecuencia de propiedad: loudness/timing absorbían cualquier fallo como métrica fallida y los finally borraban archivos incluso si un decoder no confirmaba cierre. Ahora errores de intervención del lifecycle/fence se propagan antes de cancelar/continuar; comparación conserva workDirectory y servicio de referencia conserva su materialización cuando cierre es incierto. No cleanup/retry automático; requiere reconciliación operativa. Fallos normales y flujo exitoso mantienen cleanup anterior.

**33/33 tests dirigidos**, cuatro nuevos (3 ports+1 referencia), más casos en tests existentes: recorrido probe/frame dirigido al host con PNG/píxeles reales y decoder simulado, configuración parcial sin fallback, loudness/timing con cierre incierto, referencia y directorio retenidos. Fixture byte-vídeo no es vídeo real: no se ejecutó FFmpeg/Chromium/render/QA formal/DB/migraciones. TypeScript web/build pruebas y diff-check aprobados. CAP-02785.80% estimado sin crédito adicional hasta integración del host/medición originales; media siete97.97%, CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente individual. Selección de entorno sigue pendiente; no implica elegir infraestructura ni reducir el objetivo. HyperFrames/Core conserva las obligaciones audiovisuales y evidencia separada del control de procesos.

## Captura final reportada por SDK y límite de instrumentación (2026-10-06)

Inspección de contrato público RenderConfig/executeRenderJob/RenderObservabilitySummary de @hyperframes/producer0.7.106: el pipeline completo expone resumen final de captura, pero no hook CDP antes/después de sus sesiones. El createBeforeCaptureHook encontrado pertenece a executeDiskCaptureWithAdaptiveRetry interno, no a RenderConfig del entry point público. Las APIs públicas createCaptureSession/captureFrameToBuffer sí exponen sesión para un pipeline propio; no asumir que observar otra sesión posterior atestigua la sesión productora. Decisión de integración pendiente: instrumentar pipeline completo o componer stages con propiedad explícita, conservando obligaciones de medios/encode/observaciones.

`materialized-producer-capture-audit.mjs` verifica el resumen **resuelto final**: forceScreenshot/screenshot, worker1, software, no HDR ni fallback/retries/memory exhaustion. Ausencia o drift rechaza candidato aunque status complete; resultado expone solo proyección acotada `SDK_REPORTED_CAPTURE_NOT_CDP_OR_COLOR_ATTESTATION`. Driver/receipt/collector conservan y revalidan esa proyección; el módulo adicional debe estar en inventario. No sustituye observación CDP original, fonts/color físico, probe independiente, procedencia o sandbox.

**16/16 tests** dirigidos pasan, uno nuevo con nueve variantes de captura ausente/cambiada/fallback; SDK simulado, filesystem/crypto reales para collector y bytes no-vídeo. Sin QA/render/SDK real/migraciones/rollout. CAP-02785.80% estimado sin nuevo crédito, media siete97.97%, seis restantes100% implementación registrada/QA pendiente. Se solicita elección de entorno productivo Windows restringido vs Linux contenedor aislado antes de implementar/activar garantías específicas del host; aún no decidido ni desplegado. HyperFrames/Core exige distinguir configuración solicitada, observación SDK y evidencia de sesión audiovisual.

## Colector de candidato y configuración del puente preparados (2026-10-06)

`materialized-producer-collector.mjs` lee recibo con buffer8193 bytes/límite8192/UTF8 estricto, valida schema exacto/scope/ID/digest/documento/proyecto/revisión y ruta fija del candidato; rechaza archivo no regular, symlink y hardlink observado. Pin/recheck metadata más SHA/tamaño/pin real de vídeo reutilizan primitivas existentes. Recheck después de medición detecta drift/aborto. Son controles de archivo local, no prueba de vídeo reproducible, autoridad independiente, aliases en ancestros o inmutabilidad OS durante medición.

`createMaterializedProducerBridgeConfiguration` suministra prepareLaunch/collectResult compatibles con el host Windows: Node/browser/encoder/probe se resuelven exclusivamente de roles del inventario; PowerShell/helper y driver/imports de proceso deben estar declarados. collectResult enlaza candidato validado → puerto obligatorio de medición independiente → recheck de metadata/vídeo → artifacts para supervisor; el supervisor mantiene la validación completa del binding. No construye métricas desde el recibo ni inicia procesos automáticamente. Puerto measure debe tener **su propia** propiedad/cierre de procesos: el Job del productor ya terminó y no contiene esos procesos. Compilación e inventario de tools dependen aún del build de pruebas existente, no instalación autónoma production-grade.

**15/15 pruebas dirigidas** (5 adapter+4 request/proceso+4 collector+2 configuración), seis nuevas. Collector usa filesystem/crypto reales sobre bytes de fixture que NO son vídeo; productor/SDK/medición/proceso no ejecutados. Sin QA formal/render/Chromium/FFmpeg/DB/migraciones/rollout. **CAP-02785.80% estimado sin nuevo crédito** hasta integrar medición y host operativo; media siete97.97%, seis restantes100% implementación registrada/QA pendiente. Pendientes medición audiovisual realmente instrumentada/owned, sandbox, cuota disco, aliases/ACL/inventario operativo y demás cierre original. HyperFrames/Core mantiene medios/timing del framework y no confunde candidato con conformidad.

## Entrada de proceso y proyección de launch preparadas (2026-10-06)

`materialized-producer-request.mjs` define metadata estricta4KiB, UTF8/base64 canónico, IDs/hashes/rutas/fps y digest estable por orden; no HTML, credenciales ni config arbitraria. `prepareMaterializedProducerLaunch` proyecta descriptor host/materialización ligada a owner/revisión/documento/proyecto a Node+driver fijo+request. Rechaza perfil distinto high/MP4, fps inconsistente, materialización distinta y contratos de conversión/mux SDR explícitos que este pipeline aún no implementa; no convierte incompatibilidad en PASS ni reduce alcance original.

`run-materialized-producer.mjs` proporciona entrada `--operator-request` para proceso owned. Borra secretos/overrides antes del import SDK, fija encoder/probe/browser del operador, utiliza DEFAULT_CONFIG de instalación admitida (no resolveConfig ambiental), crea directorio output exclusivo por executionId y escribe candidate.json con wx tras éxito del pipeline. Recibo metadata ligado al request/documento/proyecto/revisión; **no observation, artifacts ni conformidad**. No borra ni reintenta salida existente/fallida.

Puerto prepareLaunch y driver preparados, **composición final worker aún no activada ni completa**: el operador debe ligar browser/encoder/probe/config a roles admitidos; falta collector independiente y sandbox. Path checks no acreditan ausencia de aliases/symlinks externos ni ACL. AbortSignal del driver no sustituye STOP/Job Object del padre, y creación de salida no acredita cuota disco. Tests9/9 (5 adapter+4 request/proceso/launch) pasan con SDK/filesystem/environment simulados, sin import SDK real ni procesos Chromium/FFmpeg/render/QA formal/migraciones/rollout. CAP-02785.80% estimado sin nuevo crédito, media siete97.97%, seis restantes100% implementación registrada/QA pendiente; cierre roadmap7/30=23.33%. HyperFrames/Core conserva responsabilidad del pipeline sobre medios y separación entre candidato/evidencia.

## Pipeline completo — adapter de productor materializado preparado (2026-10-06)

Inspección local de @hyperframes/producer0.7.106 confirma API pública createRenderJob/executeRenderJob y RenderJob status/outcome/warnings/outputPath. El driver anterior observe-neutral-render usa captura/encode y corpus synthetic; no se elimina su restricción ni se lo promueve. Nuevo controlled-materialized-producer.mjs invoca el pipeline completo sobre entry local dentro del workspace y output fuera; requiere AbortSignal y configuración host explícita/browser absoluto. Perfil inicial SDR MP4/high, strict, PNG de vídeo fuente, un worker/software/screenshot, sin pool/dedup/drawElement/override de variables. Rechaza warnings, outcome/status no completos, output ajeno y abort tardío; errores SDK seguros sin retry ni diagnósticos raw.

Devuelve CANDIDATE_VIDEO_NOT_CONFORMANCE, no artifacts/PASS. Adapter preparado **no conectado aún** al Job bridge/worker; import SDK solo al invocar y tests lo sustituyen. Requiere instalación admitida y sandbox del host; configuración no demuestra identidad/captura/color efectivos, ni evita accesos del compilador SDK fuera del workspace. Perfil inicial no redefine alcance de HDR/perfiles/corpus requerido: no se acepta un contrato incompatible en silencio. Falta descriptor/launch aprobado, configuración congelada del engine completa, collector independiente y medición/output bindings antes de conectar producción.

Cinco pruebas nuevas5/5 pasan con SDK simulado: configuración/rutas, invalid/preabort sin execute, aborto tardío, warnings/outcome/output y errores seguros. Sin import/ejecución SDK real, Chromium/FFmpeg/render/QA formal/migraciones/rollout. **CAP-02785.80% estimado sin nuevo crédito**, media siete97.97%; CAP-004/009/010/017/023/026100% implementación registrada/QA pendiente cada una. No contabilizar adapter aislado como ejecución integrada. HyperFrames/Core conserva control de medios/timing del framework y evidencia separada.

## Corrección — recopilar resultados únicamente después del cierre (2026-10-06)

La revisión del puente encontró que ROOT_EXITED exitoso habilitaba collectResult antes de terminar descendientes. Se corrige: completion solicita STOP idempotente, espera STOPPED0 y salida limpia del puente, revalida aborto y recién entonces recopila. El lifecycle externo reutiliza la misma confirmación; no hay espera circular ni segundo STOP. Root fallido nunca recopila. Dos pruebas nuevas cubren aborto entre root/cierre y el recorrido exitoso del lifecycle; las pruebas existentes exigen cero recopilaciones antes del cierre y ante salida fallida del puente. Esta corrección no acredita inmutabilidad frente a procesos externos ni sandbox.

Validación: 21/21 pruebas dirigidas (11 puente y 10 lifecycle) aprobadas, TypeScript web y build de pruebas aprobados. Transporte simulado; no acredita recorrido nativo ni QA formal. Sin crédito porcentual adicional: CAP-02785.80% estimado parcial, media siete97.97%; seis restantes100% implementación registrada/QA pendiente. Sigue pendiente productor/colector aprobado y aislamiento físico, además de brechas audiovisuales. No se ejecuta render, QA formal ni migración. HyperFrames/Core mantiene control del host separado de la evidencia de paridad.

## Corte de implementación — puente Windows y composición explícita del host (2026-10-06)

`composition-windows-job-bridge.ts` conecta el contrato ownedExecutor con PowerShell y `OwnedRenderJob.cs` mediante START/STOP por stdin y estados JSON estrictos ligados a executionId. Acota bytes/UTF8/secuencia, rechaza mensajes ajenos o duplicados y exige STOPPED con cero miembros **más salida limpia del puente** antes de confirmar cierre. Fallo o cierre incierto conserva fence/workspace; kill del puente es un intento de limpieza, nunca prueba de terminación. El helper lee el canal acotado en un Task para no bloquear la observación del root y del deadline.

`createWindowsControlledRenderWorkerHost` exige plataforma Windows y PowerShell/script/helper en los árboles declarados; el launch usa el Node del rol verificado y un driver declarado. No hay driver sintético por defecto ni activación de flags. prepareLaunch/collectResult siguen siendo puertos del operador: falta configurar productor aprobado y medición real. El Job Object controla procesos/cuotas, **no** acceso a red, archivos o token; el puente/compilador no queda cubierto por las cuotas del productor.

Evidencia del bloque: **86/86 pruebas dirigidas, 9 nuevas** con transporte simulado; build de pruebas, TypeScript web, parser PowerShell y compilación C# aprobados sin iniciar procesos nativos. Revalidación de esta continuación: 9/9 del puente y TypeScript web pasan; no equivale a ejecutar el recorrido Windows real. No QA formal/browser/render/FFmpeg/DB/SQL/migraciones/rollout; siete fallos históricos de checkpoint sin revalidar.

**CAP-027 85.50% → 85.80% estimado (+0.30 pp)**: identidad/ejecutor congelado67→69%, peso15%, por conexión explícita al host con inventario y canal correlacionado; no acredita cierre transitivo dinámico, inmutabilidad OS o aislamiento físico. Gate/evidencia permanece99%, demás subbloques sin cambio. Media siete prioridades `(600+85.80)/7 = 97.97%`. Seis restantes100% de implementación registrada/QA pendiente; CAP-027 parcial con14.20% estimado restante. Crédito de cierre roadmap7/30=23.33%, sin cierre nuevo ni porcentaje global de implementación auditado.

Siguiente unidad obligatoria: productor aprobado y colector de mediciones conectados a este host, más aislamiento efectivo del entorno. Permanecen procedencia física, fuentes/color efectivos y corpus audiovisual. HyperFrames/Core conserva composición/timing y separación entre control de ejecución y evidencia de paridad; no se escribió composición ni se ejecutó CLI.

## Corte de implementación — fence persistente por host (2026-10-06)

La revisión posterior confirmó que la cuarentena anterior se perdía al recrear el host. Se añade `CompositionControlledExecutionFenceStore`, archivo metadata exclusivo por host (`wx`, modo0600, write/fsync/close) adquirido **antes** de `start`. Liga nonce/host/org/revisión/ejecución/hash de documento/proyecto, sin HTML, claves o URLs. Un archivo existente, incluso corrupto, nunca se sobrescribe ni expira automáticamente; no se usa PID, mtime o TTL para inferir que un proceso terminó.

`ownedExecutor.fence` es obligatorio en el host de worker; el adapter independiente conserva compatibilidad para tests/consumidores que no son ese host. Tras stop confirmado, el lifecycle libera solo su lease exacto, con lectura acotada/UTF8 estricto/schema/correlación/pin/recheck antes de unlink. Abort durante adquisición no inicia proceso y libera su propia reserva si se adquirió; adquisición/liberación incierta conserva tracking y exige intervención. El clasificador y la política de retención del materializador comparten ese criterio. Un host recreado con **el mismo hostId y directorio** rechaza ejecución si queda pendiente; cambiar esos valores no constituye reconciliación.

**77/77 dirigidas; 7 nuevas**, TypeScript web y build pruebas aprobados. Evidencia real de filesystem para exclusividad concurrente, instancia recreada, nonce ajeno, record corrupto, orden fence→start→stop→release, reinicio simulado tras cierre incierto, aborto durante adquisición y liberación fallida. Ejecutor/OS y DB simulados: no proceso real terminado, reboot/power-loss, ACL Windows, volumen compartido/lock distribuido ni sandbox red/filesystem. Persistencia de entrada de directorio ante corte de energía no se acredita por fsync del archivo. No ejecutar launcher/Chromium/FFmpeg/render/QA formal, SQL, migraciones ni rollout; siete fallos históricos de checkpoint siguen sin revalidar.

**CAP-027 85.40% → 85.50% estimado (+0.10 pp)**: gate/evidencia98→99%, peso10%, por bloqueo persistente local de reejecución desconocida. No se acredita guard distribuido/OS real ni procedencia/fuentes/color/corpus. Media siete prioridades `(600+85.50)/7 = 97.93%`. Seis restantes100% de implementación registrada/QA pendiente; CAP-027 permanece parcial, **14.50% estimado restante**. Crédito de cierre roadmap sin cambios7/30=23.33%; no reducir el objetivo completo a esta selección.

Siguiente unidad sigue siendo conectar el ejecutor real con el host/stop confirmado y completar aislamiento físico; el launcher local sintético no se promueve a ejecutor de documentos no confiables. Hace falta política operativa de retención y reconciliación del fence/workspace bajo autorización vigente, sin cleanup/retry automático. HyperFrames/core conserva la separación entre composición, control del host y evidencia audiovisual; no se escribió composición ni se ejecutó CLI.

## Corte de implementación — propiedad del ejecutor y cierre incierto (2026-10-06)

Revisión de infraestructura existente: el launcher Windows `run-owned-sdk.ps1` usa `OwnedRenderJob.cs`, prueba de capacidad previa, límites de procesos/memoria/tiempo, terminación y confirmación de miembros vacíos. Sigue restringido al corpus local synthetic y declara que **no** aísla filesystem/red/token. No se ejecutó ese launcher ni se decidió migrar a contenedores.

Nuevo `composition-controlled-owned-executor.ts` compone el puerto operator-owned con deadline compartido y confirmación de cierre acotada a 5 s. `start` debe devolver sincrónicamente el handle ya poseído (un start async podría perder su recurso tras aborto); completion y stop tienen responsabilidades separadas. Tanto root exitoso como root fallido deben pasar por `stopAndConfirm`, con executionId exacto y respuesta estricta. Aborto/deadline no libera resultado tardío; cierre ausente/ajeno/fallido/timeout o start incierto genera `CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED`. La confirmación es una obligación del puerto, **no evidencia OS independiente**.

El host de worker requiere `ownedExecutor` en lugar de una función execute sin contrato de propiedad. Conserva una instancia entre claims; cierre incierto la pone en cuarentena sin reset automático y rechaza nuevos trabajos antes de adquirir clave. Materializador retiene workspace propio ante ese error, sin borrarlo mientras pueda usarlo un proceso vivo; worker clasifica intervención requerida y no retry. La cuarentena es **en memoria**, no fence durable entre reinicios/hosts: ese cierre operativo y una política de retención/reconciliación aún faltan. No atribuir filesystem/network isolation a esta capa.

**70/70 dirigidas, 11 nuevas**: 10 ciclo de vida y 1 preservación del workspace; TypeScript web y compilación de pruebas aprobados. Confirma retención hasta STOPPED, fallo seguro, pre-abort, late completion, aborto durante cierre, binding/strictness, stop fallido/no cooperativo, start incierto, deadline y bloqueo de invocación posterior. Ejecutor/OS/DB simulados; filesystem y crypto reales. Tests de enlaces regresivos fuera del sandbox, sin skips. No QA formal, spawn nativo, SDK/Chromium/FFmpeg/render, DB/SQL, migraciones ni rollout. No revalida los siete fallos históricos de checkpoint.

**CAP-027 85.30% → 85.40% estimado (+0.10 pp)**: gate/evidencia pasa de 97% a 98%, peso 10%, por enforcement de confirmación/cuarentena/preservación antes de publicar; `0.10×(98−97)=0.10`. No incrementa aislamiento OS, corpus, fuentes, color ni procedencia física. Media siete prioridades **97.91%**, seis capacidades restantes100%/QA pendiente; CAP-027 continúa parcial, **14.60% estimado pendiente**, no solo QA. Próximo bloque: conectar el launcher/ejecutor real a esta interfaz y completar garantía física y fence durable, sin admitir contenido no confiable en el prototipo local. HyperFrames/core preserva composición/timing y distinción entre control del host y evidencia de render.

## Corte de implementación — admisión de dependencias en el host (2026-10-06)

`composition-controlled-dependency-inventory.ts` añade un manifiesto esperado, configurado por el operador, con raíces declaradas, identidades SHA/tamaño y binding de siete roles del contrato de ejecución; pixel decoder/probe se exigen conjuntamente si el contrato los declara. Digest canónico estable por orden de raíces/archivos; no aprender un baseline desde un job/upload. Se enumeran todos los archivos de cada raíz, rechazando ausencias, adicionales, duplicados, traversal, symlinks/junctions, hardlinks, raíces ajenas y roles con otra identidad. Se permiten archivos vacíos incidentales, no ejecutables vacíos; el pin compartido sigue rechazando vacíos por defecto en sus consumidores anteriores.

Límites explícitos: 16 raíces, 20 000 archivos/directorios, profundidad 32, manifiesto 4 MiB, archivo 1 GiB y total 16 GiB. Adquisición secuencial acota descriptores abiertos; se reenumera después de adquirir pins, antes de ejecutar y después, con señales de aborto y errores seguros sin paths. Recibo metadata declara `DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF` y no se promueve a atestación ni PASS.

El host `createControlledRenderWorkerHost` **requiere** inventario del operador antes de adquirir clave; el adapter materializado lo comprueba antes de materialización, revalida antes de invocar ejecutor y retiene resultado si cambia después. El adapter independiente conserva su interfaz legacy opcional para consumidores existentes; esa compatibilidad no permite omitirlo en el host de worker. No hay nuevo ejecutor, spawn, fallback sintético ni activación operativa. El inventario local preexistente `controlled-sdk-installation.mjs` sigue siendo un mecanismo del prototipo: no se acredita como baseline autorizado del host.

**Validación: 59/59 dirigidas, 15 nuevas** (12 inventario/admisión + 3 integración del adapter). Filesystem y crypto reales; fetch/ejecutor/DB simulados. Symlinks/hardlinks requirieron ejecutar estos tests fuera del sandbox tras EPERM; no se omitieron. Se corrigió una fixture sin fuente de duración y se repitió la selección completa. Compilación TypeScript de pruebas aprobada. No QA formal, navegador, FFmpeg, render, SQL, DB/RLS/locks ni migraciones/flags/rollout. Los siete fallos históricos de checkpoint no se revalidan con esta selección.

**Estimación de implementación: CAP-027 85.00% → 85.30% (+0.30 pp)**. Dentro de la rúbrica original, identidad congelada pasa de 65% a 67%, peso 15%: `0.15×(67−65)=0.30`. Es crédito parcial por admisión esperada de árboles/roles en el host, no cierre de dependencias transitivas o inmutabilidad durante ejecución. Otros subbloques sin cambio. Media siete prioridades `(600+85.30)/7 = 97.90%`. Aún falta **14.70% estimado**; CAP-027 sigue parcial, no completada con solo QA pendiente.

Pendientes del bloque 1: inventario aprobado de la instalación real, resolución transitiva fuera de raíces/dynamic loading y vinculación de su identidad a evidencia durable; bloques 2–5 permanecen abiertos. La infraestructura local tiene un helper Windows Job Object (`OwnedRenderJob.cs`) con límites/cierre de procesos, pero declara que no es sandbox de filesystem/red/token. Antes de implementar garantías OS del ejecutor se solicita definir el entorno objetivo; no elegir ni desplegar infraestructura silenciosamente. HyperFrames/core mantiene composición y evidencia separadas, sin cambio de timing/medios ni ejecución del CLI.

## Prioridad vigente (2026-10-06)

Por instrucción del usuario, el trabajo inmediato vuelve a las capacidades incompletas del grupo de siete prioridades. La única con implementación parcial registrada es CAP-027. CAP-004/009/010/017/023/026 mantienen su cierre de implementación registrado y QA pendiente; no se reabren sin detectar una brecha funcional concreta.

CAP-022/025/029 quedan fuera de la prioridad inmediata, conservando sus cambios y pendientes. No se reduce el alcance del roadmap general ni se declara completada ninguna capacidad adicional. QA formal, smoke de navegador/renderer, aplicación de migraciones y rollout siguen diferidos.

## Diagnóstico del punto de partida

CAP-027 conserva **85.00% estimado**; la media del grupo sigue siendo `(6×100+85)/7 = 97.86%`. Repriorizar no añade implementación ni concede incremento porcentual. La rúbrica y sus pesos se conservan en la hoja de seguimiento; cada siguiente incremento debe identificar el subbloque cambiado y su evidencia, sin contar dos veces código ya implementado.

El código inspeccionado ya incluye materialización autorizada, recompilación separada para render, pins/rechecks, políticas locales de recursos, firma del supervisor y host de worker con cola/checkpoint. Sin embargo:

- `createMaterializedControlledRenderer` recibe un ejecutor externo; declara expresamente que no proporciona aislamiento del sistema operativo.
- `createControlledRenderWorkerHost` exige ese ejecutor y no sustituye el prototipo sintético por ejecución productiva.
- `CompositionRenderSupervisorService` firma identidad del emisor y binding del output; la firma no acredita aislamiento ni conformidad por sí misma.
- CSP/admisión de fuentes locales y pins no cierran por sí solos dependencias transitivas, inmutabilidad durante ejecución, cuotas o terminación de procesos.

Por ello no es correcto reclasificar el 15% restante como exclusivamente QA.

## Orden de implementación

| Orden | Bloque pendiente | Entrega verificable de implementación | Límite de la evidencia |
| --- | --- | --- | --- |
| 1 | Cierre de dependencias y ejecutor controlado | Inventario transitivo del runtime/SDK/binarios/recursos, identidad congelada y admisión que rechace dependencias faltantes o diferentes; conectar el ejecutor al host existente sin fallback sintético | Inventario y hashes no demuestran inmutabilidad OS ni aislamiento |
| 2 | Aislamiento, cuotas y ciclo de vida | Adaptador de ejecución con política explícita de red/filesystem, presupuesto de recursos, cancelación y cierre de procesos hijos antes de liberar propiedad | El soporte real depende del mecanismo de aislamiento del host; no simular garantías con flags o solo AbortSignal |
| 3 | Procedencia e integración del supervisor | Completar el recorrido ejecutor → mediciones propias → supervisor → autoridad tenant/job/intento → checkpoint/finalización, preservando recuperación sin rerender | Firma y mocks no sustituyen autorización, transacción ni procedencia efectiva |
| 4 | Fuentes y color efectivos | Completar adquisición y validación de fuentes usadas y perfil efectivo de captura/encoder, con rechazo de fallback o evidencia ausente y obligaciones conservadas downstream | Tags Rec.709 o manifiestos declarados no demuestran captura/conversión efectiva |
| 5 | Cobertura audiovisual y comparación | Completar los casos y consumidores pendientes de decks, texto/glifos/oclusiones, crop/fit/transiciones, checkpoints y A/V; conservar cobertura completa y diagnósticos | Preparar fixtures/medidores es implementación; campaña real y aceptación del tester permanecen como validación pendiente |

Estos bloques refinan CAP-027/R04, no crean nuevos CAP ni cambian el denominador del seguimiento. Los contratos, tests y mecanismos existentes deben reutilizarse; no reconstruir componentes ya disponibles ni aumentar porcentajes por cantidad de archivos/tests.

## Próxima unidad concreta

Auditar el cierre transitivo de la ruta SDK controlada y su punto de entrada al ejecutor. Primero identificar qué dependencias están fijadas hoy y cuáles se resuelven durante ejecución; después implementar la admisión faltante en un módulo separado y conectarla antes del spawn. Los límites y errores deben ser explícitos, con pruebas de dependencia ausente/alterada, scope incorrecto, aborto y ausencia de fallback.

Si el mecanismo OS requiere una elección de infraestructura no documentada, completar primero los contratos y verificaciones independientes del host y pedir esa elección antes de activar una ejecución o atribuir garantías reales. No aplicar SQL, activar flags, instalar herramientas ni desplegar como parte de esta repriorización.

## Seguimiento por iteración

Cada corte debe informar: bloque trabajado, brecha realmente cerrada, pruebas dirigidas ejecutadas y límites de evidencia, pendientes funcionales, porcentaje individual de las siete capacidades y media del grupo. Diferenciar implementación completa con QA pendiente de implementación parcial. Los siete fallos previos de checkpoint permanecen sin revalidar hasta ejecutar su suite; ningún test ajeno los elimina.

Esta entrega es de planificación y trazabilidad: **sin cambios de runtime ni nuevas pruebas de código**. HyperFrames/core se usaron para preservar la separación entre composición, preview, render y evidencia; no se generó una composición ni se ejecutó el CLI de render.
