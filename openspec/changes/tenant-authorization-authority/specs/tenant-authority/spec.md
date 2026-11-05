## ADDED Requirements

### Requirement: Autoridad HTTP en medios y audio
Los endpoints de media privada, descarga de assets/SFX, preview y biblioteca SFX,
waveform y jobs de audio SHALL devolver 503 seguro ante indisponibilidad de
identidad/tenant/rol antes de firma, lectura del recurso, upload o creación de jobs.
SHALL conservar redirects privados 302/307, TTL, descargas, DTO y errores del dominio.

#### Scenario: Frontera de identidad, tenant, rol o componente caída
- **WHEN** un método de medios o audio recibe un error interno conocido de autoridad
- **THEN** devuelve 503 con correlación, retryable y private no-store
- **AND** no firma, lee el recurso, ingiere bytes ni encola trabajos después del fallo

#### Scenario: Entrega válida de medio privado
- **WHEN** el actor y el recurso están autorizados
- **THEN** conserva el redirect privado y TTL específico de media, descarga o preview
- **AND** conserva el filtro por organización antes de acceder a un asset

#### Scenario: Contratos del dominio y permisos
- **WHEN** faltan identidad/rol/componente, el path es ajeno o el dominio rechaza una operación
- **THEN** conserva sus respuestas de denegación, validación y error de audio/SFX

### Requirement: Errores de autoridad en proveedores de producción
Los listados e importaciones de Artlist, Google Drive y cloud, y la importación
externa de vídeo SHALL mapear indisponibilidad de autoridad a 503 seguro, antes
de sus mappers de proveedor. SHALL conservar errores de validación, conexión,
cuota, timeout y capacidad del proveedor; no añadir autoridad a sus payloads.

#### Scenario: Autoridad caída antes del proveedor
- **WHEN** falla identidad, tenant o autorización de componente en estos handlers
- **THEN** se informa indisponibilidad segura con correlación, retryable y no-store
- **AND** no se inicia importación, consulta al proveedor ni persistencia después del fallo

#### Scenario: Resolución tardía de autoridad de HeyGen
- **WHEN** import-external necesita resolver el tenant para consultar un videoId de HeyGen y esa autoridad falla
- **THEN** devuelve 503 seguro sin consultar HeyGen ni descargar el vídeo

#### Scenario: Proveedor indisponible o entrada inválida
- **WHEN** el error proviene del proveedor o la solicitud no cumple el contrato
- **THEN** conserva su código y Retry-After existentes sin reclasificarlo como fallo de identidad

### Requirement: Firma de thumbnails vinculada a un recurso
El servidor SHALL autorizar el artefacto contra el tenant vigente antes de firmar
una miniatura. SHALL generar un objeto nuevo bajo organización y artefacto, con
UUID y extensión derivada de MIME permitido, sin sobrescritura ni path del cliente.
La firma genérica SHALL rechazar production-videos y purpose production-video;
los flujos específicos de vídeo conservan sus contratos.

#### Scenario: Miniatura propia
- **WHEN** el actor tiene tenant vigente y acceso al artefacto indicado
- **THEN** se firma un path nuevo del tenant y artefacto con upsert false
- **AND** se conservan el DTO de respuesta y las URLs históricas de lectura

#### Scenario: Ruta ajena o purpose adulterado
- **WHEN** se envía un path ajeno con un artefacto propio
- **THEN** el path firmado se genera en servidor y no usa el path recibido
- **AND** cambiar purpose no permite firmar thumbnails sin artefacto ni production-videos

#### Scenario: Recurso ajeno o autoridad caída al autorizar miniatura
- **WHEN** el artefacto no está autorizado o la autoridad está indisponible
- **THEN** se responde 404 o 503 seguro respectivamente sin firmar

#### Scenario: Metadata de miniatura inválida
- **WHEN** falta artifactId, MIME permitido o tamaño positivo de hasta 5 MiB
- **THEN** se rechaza antes de firmar, incluso si el cliente evita la UI

### Requirement: Autoridad verificable
El servidor SHALL comprobar identidad, membresía activa vigente y rol tenant local
antes de conceder permisos. Cookies y claims históricos no conceden membresía.

#### Scenario: Cookie owner y rol ausente
- **WHEN** un constructor presenta cookie owner sin fila local de rol
- **THEN** se deniega el acceso sin elevarlo a ADMIN

#### Scenario: Claims vacíos y cookie ajena
- **WHEN** faltan membresías firmadas y la autoridad no confirma la organización
- **THEN** no se construye contexto desde cf_user_orgs

#### Scenario: Fallback privilegiado
- **WHEN** no hay contexto y cf_active_org apunta a otra organización
- **THEN** el helper no consulta artefactos de esa organización con service-role

#### Scenario: Autoridad caída
- **WHEN** falla la consulta de membresía o rol
- **THEN** se informa indisponibilidad segura y no se usa fallback

#### Scenario: Sesión antigua válida
- **WHEN** un JWT válido carece de IDs pero la autoridad confirma membresía y rol
- **THEN** se permite solo el tenant comprobado sin ampliar expiración

#### Scenario: Membresía revocada
- **WHEN** el JWT conserva una membresía eliminada o inactiva
- **THEN** la siguiente resolución rechaza el acceso aunque el rol local exista

#### Scenario: Usuario válido
- **WHEN** la autoridad confirma membresía activa y rol CONSTRUCTOR
- **THEN** se conserva CONSTRUCTOR aunque cookie o perfil indiquen ADMIN

#### Scenario: Ausencia de identidad
- **WHEN** no existe identidad autenticada verificable
- **THEN** no se concede acceso incluso si las cookies contienen organizaciones

#### Scenario: DTO de revisión adulterado
- **WHEN** se presenta un contexto con rol ADMIN o con identidad distinta del actor
- **THEN** se revalida la organización en servidor y solo el rol vigente del actor autoriza revisión

#### Scenario: Selector explícito de organización
- **WHEN** un helper ForTenant recibe una organización sin membresía y rol vigentes
- **THEN** se deniega antes de consultar artefactos con service-role

#### Scenario: Artefacto global legacy
- **WHEN** no existe contexto tenant válido o el artefacto carece de organización
- **THEN** el helper tenant no concede acceso global de respaldo

#### Scenario: Recursos derivados
- **WHEN** se consulta una fila de curación, materiales, lección o componente
- **THEN** el servidor resuelve autoridad antes de la lectura con service-role
- **AND** la consulta limita el recurso a artifacts.organization_id del tenant verificado
- **AND** un recurso ausente o sin relación válida no habilita consultas sin filtro

#### Scenario: Cambio de organización seguro
- **WHEN** una sesión válida solicita cambiar de organización
- **THEN** la membresía y el rol local del destino se comprueban contra autoridad actual
- **AND** el JWT reemitido conserva exp original y renueva la lista de membresías
- **AND** una autoridad caída devuelve 503 sin escribir cookies

#### Scenario: Identidad y credencial coherentes
- **WHEN** conviven sesiones GoTrue y Auth Bridge con actores distintos
- **THEN** Auth Bridge válido determina el actor de acciones y tenant
- **AND** el token usado para jobs corresponde a ese mismo actor

#### Scenario: GoTrue sin Bridge
- **WHEN** solo existe una identidad GoTrue verificada
- **THEN** resolver tenant exige membresía actual y rol local para ese ID
- **AND** el token concreto de GoTrue se verifica antes de entregarlo a jobs

#### Scenario: Fallo operativo de identidad
- **WHEN** falla la configuración Bridge o el proveedor de identidad está indisponible
- **THEN** se propaga AUTH_LOOKUP_UNAVAILABLE sin elegir silenciosamente otra identidad

#### Scenario: Indisponibilidad HTTP en publicación y usuarios
- **WHEN** guardar borrador, publicar o administrar usuarios recibe un error conocido de identidad o tenant
- **THEN** responde 503 DEPENDENCY_UNAVAILABLE con retryable y correlación, sin caché
- **AND** no refleja mensajes del proveedor ni continúa con efectos posteriores al fallo
- **AND** los errores de validación y fallos ajenos a autoridad conservan su contrato

#### Scenario: Indisponibilidad HTTP en syllabus y uploads
- **WHEN** falla identidad o autoridad tenant en syllabus, prompt, documentos, imports o firma de uploads
- **THEN** se responde 503 seguro sin iniciar efectos posteriores de extracción, generación, persistencia o firma
- **AND** el POST de generación conserva la compensación de reservas antes de proyectar errores

#### Scenario: Upload sin tenant vigente
- **WHEN** no se puede resolver un tenant vigente para firmar un upload
- **THEN** se deniega sin recuperar autoridad desde cookies ni claims históricos
