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
