# CAP-027 — frontera de red Windows

## Estado y alcance

Ruta nativa opt-in `WINDOWS_APPCONTAINER_NO_NETWORK_V5`, implementada pero NO activada ni
verificada físicamente. No acredita aislamiento productivo ni cierre CAP-027. Mantiene el
pipeline completo original; no reemplaza servidor HTTP, captura, audio, encode o mux por fixtures.
La defensa HTTP de la página original es complementaria, no sustituto de esta frontera.

Microsoft documenta que AppContainer utiliza capacidades para acceder a la red y explica su
[arranque mediante atributos de proceso](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
Se elige solicitar CERO capacidades, no conceder internetClient, internetClientServer o
privateNetworkClientServer para hacer pasar el render. La compatibilidad y la política efectiva
siguen sin demostrarse; se rechaza el arranque si Windows no acepta la combinación con token LUA.

## Contrato del operador

La configuración host pinneada admite `reducedToken` con exactamente:

- `policy`: `WINDOWS_APPCONTAINER_NO_NETWORK_V5`.
- `desktop`: estación/desktop privados ya provisionados; nunca `default`.
- `appContainerSid`: SID de paquete privado canónico `S-1-15-2` + siete uint32; no SID de
  capacidad, cuenta ni All Application Packages. El operador deriva/provisiona la identidad real.
- `readOnlyPaths`, `deniedPaths`: listas explícitas de la política ACL existente.
- `treeAudit`: `maximumEntries`, `maximumDepth`, `timeoutMilliseconds` explícitos y acotados.

Requiere cuotas `resourceLimits` explícitas. No acepta lista de capacidades, flags de fallback,
credenciales o `restrictingSid` heredado de V4. El canal sigue siendo V3, porque sus campos de
transporte no cambian. Es una alternativa deliberada, no una actualización automática de V4.
La admisión exige `OwnedRenderAppContainer.cs`, además de los helpers previos. Deben regenerarse
inventario y pins aprobados; inventarios antiguos fallan cerrados, no se corrigen silenciosamente.

## Ejecución y limpieza

1. Conserva token LUA sin privilegios, cuotas y TEMP/TMP/TMPDIR del workspace propio.
2. Construye `SECURITY_CAPABILITIES` con SID exacto, capacidades nulas/count cero/reserved cero.
3. Crea hijo suspendido usando `STARTUPINFOEX`/SECURITY_CAPABILITIES y sin herencia de handles.
4. Lo asigna al Job Object sin breakaway; verifica el token del hijo real: AppContainer=true,
   sin elevación, cero capacidades, SID exacto e integridad baja `S-1-16-4096`.
5. Audita permisos y subárboles con clon del token DEL HIJO, no del token anterior al atributo.
6. Solo entonces llama ResumeThread. Fallo posterior a la asignación cierra el job/árbol; fallo
   de asignación usa la limpieza explícita del proceso suspendido ya existente. No fallback a
   CreateProcess normal, render alternativo, capacidades extra o excepción de red automática.

Buffers de atributos, SID y tokens se liberan; tamaños y punteros retornados se comprueban antes
de usarlos. Verificar SID/IL/capacidades no es verificar conexiones físicas ni IPC/brokers.
AccessCheck de DACL no acredita MIC/SACL ni elimina carreras de filesystem.

## Provisión y aceptación pendientes (NO ejecutadas)

El host separado necesita perfil/identidad dedicados, ownership y ACL mínimos para binarios,
recursos, workspace, desktop y archivos temporales compatibles con integridad baja. No basta con
conceder escritura a Everyone/All Application Packages o a toda la instalación. TEMP del proceso
y rutas de perfil que Windows pueda redirigir deben verificarse realmente; código no garantiza
que bibliotecas o el sistema respeten el workspace indicado.

HyperFrames crea servidor en loopback y anuncia `http://localhost:<puerto dinámico>`. Microsoft
describe la [provisión explícita de loopback para AppContainer](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/troubleshooting-uwp-firewall).
No se ejecutó CheckNetIsolation, no se crearon perfiles, reglas WFP/firewall ni excepciones. Una
excepción por paquete puede permitir otros servicios locales: NO equivale a limitar loopback al
puerto del render. Debe diseñarse/auditarse esa restricción a nivel OS si el contrato exige puerto
exclusivo. La guard HTTP solo protege su página; otros procesos/targets/WS/WebRTC no quedan cubiertos
por ella. No decidir silenciosamente que todo localhost sea confiable.

Antes de activar en un host desechable autorizado, se requiere evidencia de:

- SDK completo, captura/seek, fuentes, decode/encode y audio/mux dentro del perfil, sin desactivar
  protecciones de Chromium ni sustituir el productor.
- HTTP loopback original funciona; otros puertos y protocolos se rechazan según contrato.
- IPv4/IPv6 externas, UDP/DNS, WebSocket/WebRTC y descendientes no eluden la frontera; revisar
  política efectiva, proxies y brokers locales, no solo errores de fetch de una página.
- Token/ACL/IL/procesos reales, cancelación, límites y cleanup bajo concurrencia; ninguna
  publicación de evidencia tras rechazo o resultado incierto.
- Reserva/fence y recuperación conservan job/evidencia ante cierre incierto; no rerender ni
  reconsumir autoridad. Configuración y dependencias permanecen pinneadas.

Rollback consiste en NO activar la política experimental y conservar pins/versiones previamente
aprobados. Volver a V4 elimina esta frontera y debe declararse: no permite afirmar red aislada.
Cualquier limpieza de perfiles o excepciones requiere identificar objetivos y autorización
separada; este desarrollo no modifica la configuración de seguridad del equipo.
