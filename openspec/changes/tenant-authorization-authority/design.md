# Autoridad y compatibilidad

## Fuentes contrastadas

- session.ts verifica JWT HS256, sub/email y expiración. organization_ids es una
  instantánea opcional; cf_user_orgs/cf_active_org son navegación.
- login/auth-bridge.ts consulta SofLIA organization_users por user_id y status
  active; sincroniza organizations y organization_user_roles localmente. Password
  no rechaza organizationError como SSO: puede emitir una sesión sin membresías.
- auth-bridge-helpers.ts emite acceso por siete días, conserva DTO de navegación.
- switch-organization valida IDs firmados y conserva expiración; toma DTO de cookie.
- admin/users/route.ts escribe roles locales tras comprobar pertenencia del sujeto
  active/invited. Login vuelve a escribir roles desde SofLIA (source soflia), incluso
  si el administrador había escrito source courseforge: precedencia a revisar.

## Decisión para F1.2/F1.3

SofLIA organization_users es la autoridad de membresía activa para el usuario
autenticado. Consultar por identidad verificada, status active y organización
objetivo; cargar slug/nombre desde relación organizations, no desde cookies.
No inventar una tabla local de membresías. organization_user_roles de Engine es
la autoridad de rol por par user_id/organization_id; normalizar con la función
existente. Fila ausente o rol desconocido deniega; profiles, rol JWT y cookie no
reponen ese permiso. SUPERADMIN tampoco concede membresía por sí solo.

Las consultas deben ser acotadas y usar retry/timeout de tenant-lookup-retry;
memoización solo dentro de request. Sin caché compartida de permisos en esta
corrección. Revocación observable en la siguiente solicitud que verifica autoridad;
no promete revocar trabajo ya autorizado ni transacciones iniciadas.
Fallo de autoridad produce TenantContextLookupError/TENANT_LOOKUP_UNAVAILABLE,
sin acceso privilegiado posterior; APIs deben proyectarlo a 503 seguro y UI a
estado indisponible. Ausencia comprobada es denegación (403); identidad ausente
401. Mantener 404 donde el contrato de recurso oculta existencia.

Claims antiguos vacíos/ausentes pueden seguir identificando al usuario si el JWT
es válido: solo una consulta actual de autoridad puede recuperar membresía. No
exigir logout global ni ampliar expiración. Sin rol local, indicar nueva
autenticación/sincronización; no crear rol durante lectura. La sincronización de
login debe verificarse antes de acreditar recuperación. Cambiar organización
conserva exp y debe validar membresía actual, nunca rehabilitar una revocada.

Conservar DTO y cookies de navegación para UI. Se pueden usar como selector entre
organizaciones ya verificadas; ni rol, slug ni ID de cookie conceden acceso.
El helper privilegiado debe verificar identidad/membresía antes de consultar
artefactos. TenantContext recibido tampoco sustituye identidad del actor. Sin
contexto válido no consultar organización ajena ni abrir organización null legacy;
un flujo global legacy necesita autorización separada explícita y pruebas propias.

## Condiciones pendientes y alcance

F1.3.c.3.c.3 cubre dieciséis métodos de conexiones/validaciones HeyGen y
HyperFrames, settings, assembly-branding y LiveAvatar. Se añaden guards antes
de log/error genérico; LiveAvatar reutiliza su handleError común. La firma de
los helpers de autorización se conserva. Role/tenant/identidad deben resolverse
antes de crear clientes privilegiados o servicios de credenciales. Las clases
de error de credenciales y LiveAvatar conservan sus códigos/DTO; no se cambia
la coordinación entre save/revoke y webhooks ni finalización/media cleanup.

F1.3.c.3.c.2 añade el mapper al catch exterior de diez métodos de medios/audio/SFX.
Conserva catches internos de auditoría opcional, redirects privados 302/307 y sus
TTL, filtros tenant de assets/jobs, revisión antes de acceso y errores específicos
de audio/SFX. No se interceptan errores de auditoría que el contrato existente
permite registrar sin cancelar la descarga ya autorizada. Los bytes, ventanas de
audio, documento y creación de jobs no se rediseñan. Los tests usan NextResponse
real y schemas/clases reales con DB/Storage/dominio simulados.

F1.3.c.3.c.1 limita la normalización HTTP a siete métodos de listado/importación
en Artlist, Google Drive, cloud-storage e import-external. El mapper compartido
se ejecuta antes de mappers externos o clases particulares de HeyGen. No altera
schemas, roles, generación de paths, contenidos, render ni acceso al proveedor.
El callback de resolución de videoId en import-external también proyecta una
caída de autoridad antes de consultar HeyGen. Listados conservan su DTO; errores
de conexión/cuota/timeout/capacidad y Retry-After conservan su contrato. El catálogo
global de Artlist mantiene autenticación sin una exigencia tenant nueva.

F1.3.c.3.b.2 protege la firma genérica: thumbnails exige purpose thumbnail,
artifactId y getAuthorizedArtifactAdminForTenant con el tenant vigente. Solo
admite JPEG/PNG/WebP/GIF y tamaño declarado positivo hasta 5 MiB (política
compartida con publicación). La ruta se genera como
organizations/{organizationId}/artifacts/{artifactId}/{UUID}.{extensión MIME},
con upsert false; el nombre enviado no concede escritura. El único consumidor
CourseDataForm recibe artifactId de PublicationClientView y usa el path devuelto.
Las URLs existentes siguen leyéndose y no se migran objetos.

production-videos sale de la allowlist del endpoint genérico y purpose
production-video se rechaza en cualquier bucket. El inventario no encontró
consumidores de esa firma genérica; importación y render tienen rutas propias.
No se aceptan otros purpose para thumbnails ni thumbnail en otros buckets.
No se cambian credenciales, TTL ni flujos específicos de producción. MIME/tamaño
declarados no inspeccionan bytes: Storage debe imponer límites efectivos.

La caracterización estática SQL encuentra INSERT amplio para authenticated en
production-videos (20260228120000). El endurecimiento 20260908121000 retira el
INSERT amplio de thumbnails pero no ese nombre de política de vídeos. No se
conoce el estado efectivo remoto ni se acredita explotación allí. La aceptación
de Storage requiere inventario de políticas/grants y pruebas anon/auth/service
en entorno descartable; sigue pendiente junto a aceptación RLS de TD-26. Este
lote no certifica que otras rutas o acceso directo a Storage sean seguros.

La migración 20260621123000_create_organization_user_roles.sql tiene políticas
INSERT/UPDATE solo por get_active_org_id, sin condición administrativa. Sin estado
de grants/políticas efectivo no se afirma explotación. Antes de certificar rol
local, probar que anon/authenticated no pueden autoasignarse permisos; reparación
SQL puntual con dependencias explícitas y ambiente descartable si se confirma.
F1.2 puede cerrar fallbacks de cookies, pero TD-26 no puede cerrarse sin esa prueba.

Los fallbacks globales de canReviewContent y helpers ForTenant requieren revisión
F1.3; los permisos de JWT/RLS existentes no quedan revocados solo por este diseño.
No certificar RLS ni cierre integral con tests simulados.

## Reversión
### Subdivisión F1.3

F1.3.a cierra assertArtifactOrgAccess/getAuthorizedArtifactAdmin/ForTenant y
canReviewContent. El contexto recibido selecciona organización; no concede rol ni
identidad. Resolver nuevamente por membresía vigente y rol local antes de leer
artefactos con service-role; sin contexto no hay acceso legacy organization_id null.
No usar cf_active_org ni claims como lista alternativa de acceso. Comparar actor
en la comprobación de revisión; no consultar roles para otro usuario arbitrario.
F1.3.b revisará prelecturas de filas/componentes y consumidores por flujo.
F1.3.c cubrirá switch-organization, GoTrue legacy y proyección HTTP 503.
Cerrar F1.3.a no cierra F1.3 ni TD-26.

F1.3.c.1 corrige switch-organization con identidad del JWT verificado,
membresías actuales y rol local del destino. Conserva exp, rechaza sub/email
ausentes y rol ausente/desconocido. El DTO no depende de cookies de navegación.
Al reemitir actualiza organization_ids con membresías actuales; una lista
histórica vacía no impide recuperar membresía comprobada. Sincronización de roles
no ocurre durante switch. Fallo de autoridad produce 503, sin escribir cookies.
F1.3.c.2 revisará identidad GoTrue/Auth Bridge y tokens usados por jobs;
F1.3.c.3 normalizará errores de autoridad por lotes de rutas.

F1.3.c.3.a cubre save-draft, publish y admin/users: errores conocidos de identidad
o tenant se proyectan a 503 DEPENDENCY_UNAVAILABLE, retryable, con requestId y
Cache-Control privado sin almacenamiento. Una función HTTP compartida reconoce
clases internas y emite mensaje fijo; no confía en codes del payload ni refleja
mensajes del proveedor. Los otros errores conservan su contrato existente.
La caída de autorización ocurre antes de efectos. No se marca resuelto el resto
de rutas: syllabus/documentos y producción requieren lotes de consumidores propios.

F1.3.c.3.b cubre métodos HTTP de syllabus, prompt, documentos, imports y firma de
uploads. Usa el mapper de autoridad; POST syllabus conserva rollback de reserva
antes de proyectar error. Documentos rechaza tenant ausente antes de leer multipart.
Firma de uploads elimina fallbacks de cookies/claims y exige tenant vigente para
todos sus propósitos. Los errores de archivos, cuotas e importación conservan sus
contratos; el tamaño y parseo incremental siguen siendo alcance de TD-27.

F1.3.c.2 usa Auth Bridge válido primero, igual que la identidad de UI, y GoTrue
verificado si no hay Bridge válido. El resolver tenant usa la misma elección,
siempre con membresía SofLIA y rol local vigentes; GoTrue no concede permisos por
sus metadatos. Sesiones duales divergentes conservan el actor Bridge. Para jobs,
Bridge devuelve el token que se verificó; GoTrue verifica el token concreto de
getSession y exige que corresponda al usuario resuelto. Errores operativos de
identidad se propagan con código AUTH_LOOKUP_UNAVAILABLE, sin probar otro actor.
JWT Bridge sin exp, identidad o firma válidas no constituye sesión. Las señales
dinámicas de Next se conservan. Los DTO públicos siguen sin incluir tokens.

F1.3.b resuelve tenant antes de prelecturas de curation_rows, materials,
material_lessons y material_components. Las consultas usan relaciones !inner hasta
artifacts y filtro organization_id. El helper ForTenant de componentes valida el
selector contra autoridad actual; mantiene su retorno null ante error de recurso,
mientras el helper general conserva MaterialComponentLookupUnavailableError.
Curación/materiales conservan null ante fallo de recurso. Errores de autoridad
se propagan; ninguna denegación habilita una consulta sin filtro. Se conserva
autorización final del artefacto y el DTO de cada consumidor.

F1.1: retirar solo este OpenSpec. F1.2/F1.3: commits pequeños recuperables;
ante fallo de autoridad preservar denegación segura, no restaurar cookies como
fuente de permisos. Sin migración remota automática ni cambios de formato JWT.

## Implementación acotada F1.2

tenant-memberships.ts consulta membresías active para el actor con metadatos de
organizations!inner. Mantiene el DTO id/name/slug/role sin leer cf_user_orgs.
La consulta pide count exacto y máximo 1000 filas: si el máximo REST devuelve
menos, el count no coincide o hay exceso, falla como indisponible. Esta cota
defensiva evita elegir desde un conjunto incompleto; no presupone que todos los
usuarios tengan menos membresías. Paginación para más de 1000 requerirá contrato
explícito. No hay caché de autorización entre solicitudes ni nuevas dependencias.

El error vive en tenant-context-error.ts y se reexporta desde tenant-context.ts
para conservar instanceof en consumidores existentes. La fuente local de rol no
usa perfil ni JWT de respaldo. cf_active_org selecciona solo entre membresías
consultadas. La lectura no sincroniza ni modifica roles. El contrato JWT y las
cookies UI permanecen iguales.

Las rutas que ya manejan TenantContextLookupError mantienen su 503. Los handlers
con catch genérico pueden devolver 500 seguro: su normalización a 503 y la
frontera GoTrue legacy se revisarán por lote con consumidores en F1.3. La
revocación de una membresía detiene el resolver; no corrige todavía el helper
privilegiado que recupera cf_active_org cuando el contexto es null.

## Lote F1.3.c.3.c.4 — operaciones HeyGen

Normalizar las dos clases internas conocidas de autoridad en assets, platform,
presets, scenes, speech, sync, videos, clips generate/status/voice y jobs general
e individual: doce rutas/diecinueve métodos. Conservar schemas, códigos de dominio,
DTO, correlación y orden de autorización anterior a credenciales/proveedor/jobs.
Los handlers que comparten formatter incorporan allí el guard. En sync el guard
va después de la compensación de una reserva existente para no dejarla pendiente.
La compensación de despacho de clips y la advertencia de sincronización opcional
del editor conservan sus catches y semántica anteriores.

Pruebas de handlers y schemas reales con credenciales/DB/SDK/workers simulados.
Inyectar ambas clases en identidad, rol, tenant y ownership del componente cuando
aplique; exigir 503 seguro/retryable/no-store y cero efectos posteriores. Conservar
401/403/404, validación, 202/DTO, Retry-After y compensación. Sin generación,
envíos, configuración, credenciales o SQL reales. Standalone dedicado, slides y
automatización permanecen en lotes siguientes; este lote no cierra TD-26.

## Lote F1.3.c.3.c.5 — slides/open-design

La inspección descubrió un fallback adicional de autoridad en
slide-template-library.actions.ts: active_organization_id/organization_ids del
bridge y lista de cookies se usan antes del resolver vigente, cuyo fallo se
convierte en lista vacía. F1.3.c.3.c.5.a corrige primero esa selección: solo
resolveActiveTenantContext concede el contexto, antes de crear el cliente
privilegiado. Sin tenant se deniega y ante fallo conocido se devuelve resultado
serializable seguro con errorCode, manteniendo el contrato success/error de UI.
La ruta de biblioteca proyecta 403/503. La página ya distingue success false de
lista vacía y los demás consumidores manejan ese fallo sin cachearlo; se conserva
esa UI existente haciendo que la acción deje de ocultar el fallo como éxito vacío.

F1.3.c.3.c.5.b abarca los otros ocho handlers de slides y open-design,
incluidos previews HTML y generación async, con sus fixtures. La biblioteca
por sí sola no acredita el lote padre. No alterar schemas, render, firmas,
CSP, idempotencia o compensación de efectos secundarios. TD-26 conserva la
aceptación de ambiente y los demás consumidores pendientes.

### F1.3.c.3.c.5.b: fronteras HTTP y ownership de HTML

Ocho handlers proyectan ambas clases internas de autoridad mediante el mapper
existente antes del error genérico. Solo se modifican catches de frontera;
despacho, compensación y errores de preparación internos conservan su orden.

La inspección comprobó además que html-to-png y animated-deck/prepare aceptan
un path independiente del componente autorizado. El primero descarga y puede
eliminar ese archivo con service-role. Exigir namespace slides/{componentId}-
antes de descargar/rasterizar, tanto al path del payload como al de assets.
La apariencia también valida el namespace de la referencia guardada antes de
descargar y sobrescribir HTML; las tres rutas comparten un predicado puro.
El path sigue pasando por el normalizador existente. No exigir que esté ya
registrado: el consumidor de upload llama a prepare inmediatamente después de
onAssetChange y esa persistencia no está confirmada todavía. Se admite HTML
recién subido al componente autorizado; se rechaza otro componente con 404 sin
lecturas, rasterización, eliminación o escrituras posteriores.

Pruebas sobre handlers/parser/schemas reales con fronteras simuladas: ambas
clases en identidad, revisión, componente y contexto según la ruta; DTO/CSP,
400/401/403/404/409/413/422/500, despacho/reutilización 202, atribución y firma,
compensación de despacho y persistencia de fallo de preparación. Sin proveedores,
render, credenciales o SQL reales. No acreditar el pipeline completo con mocks.

## F1.3.c.3.c.6 — automatización/standalone

F1.3.c.3.c.6.a cubre las ocho operaciones de cinco rutas automation/runs:
raíz GET/POST, [runId] GET/POST, configuration PUT, dispatch POST y
items/[componentId]/clips POST/PUT. Usar el mapper compartido de autoridad
antes de formatear errores genéricos/de servicio. En [runId] centralizarlo en
respond, compartido por ambos métodos. Dispatch ya devuelve 503 para otros
fallos: conservar esa respuesta, añadiendo solo la clasificación segura conocida.
No cambiar filtros de organización, permisos, atribución de actor, aprobación,
firmas, callbacks locales, errores de dominio ni estados de producción.
Los tests ejecutan handlers/parser/schemas reales con DB/servicios/worker
simulados; no generan assets, renders ni usan credenciales.

F1.3.c.3.c.6.b conserva las tres operaciones standalone. La inspección detectó
que GET heygen/standalone/videos/[videoId] consulta un ID arbitrario con la
credencial del tenant, sin vínculo local vídeo/organización; POST tampoco guarda
ese vínculo. El contrato de credenciales no garantiza cuentas de proveedor
distintas por organización. Resolver y probar ese ownership junto con errores
HTTP antes de cerrar la subunidad: no basta añadir el mapper. Revisar
HeygenStudioClient (creación y polling) y modelos/repositorios disponibles antes
de elegir persistencia o comprobante verificable. No usar firmas background de
cinco minutos como sustituto sin contrato de propósito/vigencia propio.

La configuración de automatización hace múltiples escrituras sin transacción.
Esta unidad no inventa atomicidad: conserva estados parciales y sus errores;
registrar su evaluación de concurrencia/recuperación con el plan de integridad.

### F1.3.c.3.c.6.b: comprobante standalone y errores HTTP

Se elige un comprobante HMAC SHA-256 de propósito exclusivo, versionado y con
vigencia absoluta de siete días. Contiene solo organización, ID de vídeo y fecha
de emisión; no es credencial de HeyGen ni reemplaza identidad/membresía/rol.
La clave proviene del getter servidor existente para firma; un prefijo exclusivo
separa este propósito de background y evita intercambio entre protocolos.
No modificar firmas ni vigencia del worker. Sin nueva variable, tabla o SQL.

POST comprueba disponibilidad de firma antes del cliente privilegiado/proveedor
y emite standaloneAccessToken únicamente para el ID devuelto por createAvatarVideo.
GET exige ese comprobante en x-heygen-video-token después de identidad/rol/tenant
y antes de acceder al cliente privilegiado o credenciales. Ausente, alterado,
expirado o perteneciente a otra organización/vídeo produce 404 uniforme, sin
consultar proveedor. Sin clave disponible se responde 503 seguro. Un ID devuelto
por GET distinto al solicitado produce 502 sin URL/asset. Respuestas de vídeo
privadas/no-store/Vary Cookie. IDs legacy sin comprobante quedan denegados;
no inferir pertenencia por cuenta, callback_id ni posesión del ID.

La verificación limita tamaño/formato antes de decodificar y compara HMAC en
tiempo constante. UUID de organización normalizado, ID de vídeo exacto, tolerancia
de reloj de 30 segundos y expiración sin renovación por polling. Rotar la clave
invalida comprobantes anteriores. El token no viaja en URL, logs o cookies nuevas;
su header y campo contienen token para la redacción operacional existente.
El studio transporta el header; GET conserva el token validado porque cada
polling reemplaza CurrentJob. No se añade interfaz nueva ni generación pagada.
Ambas rutas resuelven tenant antes de revisar rol y pasan ese contexto a
canReviewContent, anclando permiso, firma y credencial a la misma organización.

Las tres rutas standalone incorporan el mapper de autoridad existente. Mantener
401/403, validación, errores HeyGen/Retry-After y registro de media verificada.
El 400 existente de media por tamaño excedido no cambia en este lote. Pruebas
criptográficas con clave sintética y handlers reales con servicios simulados;
incluir dos organizaciones que comparten cliente falso, revocación y polling
repetido. No acreditar generación real, Storage/RLS o idempotencia del proveedor.
