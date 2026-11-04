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
