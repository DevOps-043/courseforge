## ADDED Requirements

### Requirement: Biblioteca de plantillas con autoridad vigente
La biblioteca de slides MUST resolver la organización exclusivamente mediante
autoridad vigente y no consultar clientes privilegiados desde claims o cookies
de navegación; sus consumidores deben distinguir indisponibilidad de lista vacía.

#### Scenario: Claims o cookies señalan otra organización
- **WHEN** existe identidad válida y el resolver devuelve la organización autorizada actual
- **THEN** todas las consultas de biblioteca se filtran por esa organización, sin usar los claims o cookies como grant

#### Scenario: Tenant ausente o autoridad caída
- **WHEN** el resolver no concede contexto o arroja una clase interna de lookup
- **THEN** no se construye cliente privilegiado y se devuelve fallo serializable seguro, proyectado como 403 o 503 en HTTP

#### Scenario: UI distingue error de vacío
- **WHEN** falla la biblioteca
- **THEN** la página muestra un aviso de error en lugar de afirmar que no hay plantillas

### Requirement: Proyección de autoridad en operaciones HeyGen
Las rutas de operaciones, clips y jobs HeyGen MUST proyectar las clases internas
de indisponibilidad de autoridad como 503 seguro antes de errores genéricos,
sin alterar los códigos del proveedor o la compensación de efectos ya iniciados.

#### Scenario: Autoridad no disponible antes del efecto
- **WHEN** identidad, rol, tenant u ownership produce una clase interna conocida
- **THEN** la ruta devuelve 503 correlacionado/retryable/no-store sin efectos posteriores

#### Scenario: Reserva de sincronización existente
- **WHEN** una excepción de autoridad alcanza el catch después de reservar la sincronización
- **THEN** se conserva la compensación existente antes de proyectar el error

#### Scenario: Worker de clips no despachado
- **WHEN** falla el despacho después de encolar clips
- **THEN** se conservan el marcado de fallo y la respuesta de dominio existentes

### Requirement: Autoridad HTTP en conexiones y configuración
Las conexiones/validaciones HeyGen y HyperFrames, settings de generación,
identidad de ensamble y LiveAvatar SHALL distinguir indisponibilidad de autoridad
de denegación y errores propios del proveedor, sin iniciar efectos posteriores.

#### Scenario: Identidad, rol o tenant indisponible
- **WHEN** un método recibe una clase interna conocida de fallo de autoridad
- **THEN** responde 503 seguro con retryable, correlación y private no-store
- **AND** no accede a credenciales, webhooks, DB ni medios después del fallo

#### Scenario: Contratos propios preservados
- **WHEN** la autoridad es válida y la solicitud es válida o falla validación/proveedor
- **THEN** mantiene DTO, filtros tenant y códigos de validación, conflicto, cuota y proveedor
- **AND** mantiene el orden existente de credenciales, webhooks y finalización de assets

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

### Requirement: HTML de slides limitado al componente autorizado

El servidor MUST limitar los paths de HTML al namespace del componente autorizado
antes de cualquier lectura, transformación, eliminación o sobrescritura.

#### Scenario: Transformación de HTML ajeno
- **WHEN** html-to-png, animated-deck/prepare o appearance reciben un path de otro componente en el payload o en assets
- **THEN** se responde 404 antes de leer, transformar o eliminar ese archivo

#### Scenario: HTML propio recién subido
- **WHEN** un actor autorizado prepara un HTML válido recién subido al namespace de su componente
- **THEN** no se exige que la persistencia asíncrona de la referencia haya terminado
- **AND** se conservan normalización de path, límites y autorización previa

### Requirement: Errores de autoridad de slides y open-design

Las fronteras HTTP MUST proyectar las clases conocidas de indisponibilidad de
autoridad como 503 seguro y conservar los contratos de dominio y recuperación.

#### Scenario: Autoridad temporalmente no disponible
- **WHEN** cualquiera de los ocho handlers restantes recibe una clase interna de indisponibilidad de identidad o tenant en su frontera de autorización
- **THEN** responde 503 seguro, reintentable, correlacionado y sin caché
- **AND** no continúa con efectos posteriores a esa frontera
- **AND** conserva los errores de dominio, CSP, firmas, reutilización de trabajos y compensaciones existentes

### Requirement: Errores de autoridad de automatización

Las ocho operaciones HTTP de automation/runs MUST clasificar las caídas conocidas
de identidad o tenant como 503 seguro sin continuar efectos tras la frontera.

#### Scenario: Caída durante autorización
- **WHEN** falla identidad, tenant, revisión o acceso al artefacto con una clase interna de autoridad
- **THEN** se devuelve DEPENDENCY_UNAVAILABLE reintentable, correlacionado y sin caché
- **AND** no se inicia consulta privilegiada, configuración, construcción de clips o despacho posterior a esa frontera

#### Scenario: Compatibilidad de automatización
- **WHEN** una solicitud válida crea, consulta, reevalúa, configura o despacha producción
- **THEN** mantiene actor y organización derivados del servidor, filtros de ownership, DTO y firma
- **AND** errores de validación, denegación y dominio conservan su semántica

### Requirement: Consulta standalone limitada a vídeo y organización

El servidor MUST exigir un comprobante firmado, versionado y vigente que vincule
vídeo y organización, además de identidad y permisos actuales, antes de consultar HeyGen.

#### Scenario: Vídeo ajeno o comprobante inválido
- **WHEN** falta comprobante, está alterado/expirado o no coincide con vídeo/organización
- **THEN** devuelve 404 uniforme sin cliente privilegiado, credenciales o consulta al proveedor
- **AND** compartir cuenta del proveedor no concede acceso a otro tenant

#### Scenario: Creación y consultas sucesivas
- **WHEN** el proveedor confirma la creación de un vídeo bajo el tenant vigente
- **THEN** el servidor emite el comprobante solo para ese ID y organización con vigencia absoluta de siete días
- **AND** el studio lo envía por header y las consultas sucesivas lo conservan sin renovarlo
- **AND** la respuesta es privada y no expone otro ID/URL si el proveedor devuelve un vídeo distinto

#### Scenario: Infraestructura o autoridad indisponibles
- **WHEN** falla autoridad conocida o no está disponible la clave de firma
- **THEN** devuelve 503 seguro y reintentable sin generación o consulta posterior a la frontera fallida
- **AND** conserva 401/403 y errores de dominio/proveedor existentes

### Requirement: Soportes HTTP HyperFrames con fallo de autoridad seguro

Los resolvers compartidos de presets, propuestas y seguimiento de render MUST
proyectar indisponibilidad conocida como respuesta 503 antes del acceso privilegiado.

#### Scenario: Consumidor recibe respuesta de autorización
- **WHEN** identidad, tenant o revisión arrojan una clase interna de autoridad
- **THEN** cada handler consumidor devuelve esa respuesta segura/reintentable y sin caché
- **AND** no inicia persistencia, generación, polling o cancelación posterior a esa frontera

#### Scenario: Contexto y compatibilidad
- **WHEN** la autoridad está disponible
- **THEN** revisión y contexto resueltos corresponden a la misma organización
- **AND** se mantienen denegaciones 401/403, formas del contexto, versiones y CSP
- **AND** los errores desconocidos se relanzan al contrato de error del consumidor

### Requirement: Frontera HTTP de envío y recuperación de renders

GET/POST renders MUST proyectar las clases conocidas de autoridad como 503 seguro
y mantener contexto, validación y recuperación existentes.

#### Scenario: Autoridad no disponible
- **WHEN** falla identidad, tenant o revisión antes del acceso privilegiado
- **THEN** devuelve 503 reintentable, correlacionado y sin caché, sin recuperación o envío posteriores

#### Scenario: Despacho fallido
- **WHEN** falla el dispatcher después de registrar una solicitud
- **THEN** intenta failDispatch antes de responder al fallo de envío
- **AND** no omite esa recuperación por clasificar una clase conocida
- **AND** no afirma reparación durable si la compensación falla

#### Scenario: Reutilización y atribución
- **WHEN** la solicitud válida crea o recupera un render
- **THEN** mantiene organización/actor del servidor y attemptId sin aceptar autoridad del payload
- **AND** un resultado reutilizado o con providerRenderId evita otro despacho

### Requirement: Rutas directas HyperFrames con compatibilidad de autoridad

Las rutas directas del inventario .7.b.2 MUST proyectar las clases conocidas de
autoridad como 503 seguro, con revisión ligada al tenant y sin efectos posteriores.

#### Scenario: Respuesta JSON y detalles legacy
- **WHEN** falla identidad o tenant en una ruta directa
- **THEN** devuelve mensaje neutral, correlación, retryable y private/no-store/Vary Cookie
- **AND** conserva details.reason de tenant donde ya formaba parte del contrato

#### Scenario: Preview nativo sincronizado
- **WHEN** falla autoridad con un hash y generación válidos de sync v2
- **THEN** conserva respuesta HTML, bridge DEPENDENCY_FAILED y CSP del protocolo
- **AND** no refleja detalles internos; sin sync v2 conserva JSON de error

### Requirement: Frontera delegada de lectura HTML

La frontera compartida de lectura MUST validar identidad, correspondencia del
actor con tenant, organización válida y rol antes del cliente privilegiado.
MUST mantener errores neutrales y aislamiento de caché aunque falle el logger.

#### Scenario: Error y denegación anteriores al dominio
- **WHEN** authenticate falla, falta autoridad o la solicitud tiene origen ajeno
- **THEN** no ejecuta acceso privilegiado ni lectura de dominio
- **AND** conserva el contrato seguro existente, sin forzar reintento automático

#### Scenario: Cambio de organización y cuota
- **WHEN** el mismo handler atiende solicitudes de organizaciones distintas
- **THEN** deriva cuotas y owner del contexto actual en cada solicitud
- **AND** rechaza un resultado que no coincide con el owner autorizado

### Requirement: Observabilidad de snapshots sin alterar recuperación

Los handlers de publicación y recuperación de snapshots MUST contener las
excepciones del callback de observabilidad y conservar su respuesta segura.

#### Scenario: Logger falla durante un error de autoridad o dominio
- **WHEN** el handler captura un error y logFailure también lanza
- **THEN** responde 503 neutral con correlación, no-store y retryable false
- **AND** no repite publicación ni recuperación ni expone detalles internos

### Requirement: Observabilidad narrativa independiente del resultado

Los handlers narrativos de comandos y planificación de fragmentos MUST contener
fallos síncronos del callback y del logger por defecto sin cambiar la respuesta.

#### Scenario: Autoridad y observabilidad fallan antes de cargar servicios
- **WHEN** falla autoridad y el callback o salida del logger también lanza
- **THEN** devuelve 503 neutral con correlación, no-store y sin reintento
- **AND** conserva requestNotApplied y recoveryRequired según modo y punto de fallo

#### Scenario: Commit o lectura de recibo inciertos
- **WHEN** falla dominio después de aceptar un comando y observabilidad también falla
- **THEN** mantiene commandId, recoveryRequired y automaticRetryAllowed false
- **AND** no duplica la operación ni afirma que no hubo escritura

### Requirement: Composición HTML delegada con autoridad actual

Las rutas HTML del corte de composición inline MUST conectar su método a la
factory prevista y obtener identidad/tenant actuales sin ejecutar dominio al
componer la ruta. Sus políticas de rollout MUST fallar cerradas por defecto.

#### Scenario: Identidad, tenant y fallos entre solicitudes
- **WHEN** se invoca authenticate con usuario actual, ausente o error de lookup
- **THEN** deriva actor del servidor, resuelve tenant solo con usuario presente
- **AND** propaga el error al handler en vez de devolver autoridad sintética

#### Scenario: Lectura de recuperación con escritura desactivada
- **WHEN** los flags requeridos de GET están activos y los de escritura ausentes
- **THEN** mantiene habilitada la lectura prevista sin conceder POST
- **AND** valores distintos del literal true no activan la funcionalidad

### Requirement: Raíces compartidas conservan protocolo de autoridad

Las raíces narrativas, reconstruction y preview MUST conectar cada ruta al
handler previsto con políticas del servidor y sin conceder autoridad del payload.

#### Scenario: Escritura narrativa y recuperación
- **WHEN** se solicita nueva escritura o consulta de recibo
- **THEN** ambos modos usan identidad, tenant y revisión actuales
- **AND** escritura exige organización habilitada mientras recuperación conserva su gate independiente

#### Scenario: Preview y recursos firmados
- **WHEN** una ruta construye PAGE, RESOURCE_RENEWAL o entrega de recursos
- **THEN** el servidor decide el tipo y la configuración de audience/clave/origen
- **AND** recurso firmado conserva su protocolo capability sin aceptar actor del payload
- **AND** configuración ausente no se deriva del origen de la solicitud
