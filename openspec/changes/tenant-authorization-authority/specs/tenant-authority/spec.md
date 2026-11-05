## ADDED Requirements

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
