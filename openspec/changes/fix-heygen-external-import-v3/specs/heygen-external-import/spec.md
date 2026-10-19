## ADDED Requirements

### Requirement: Importación por ID mediante API v3 y credencial tenant
El sistema SHALL autorizar el componente antes de consultar HeyGen y utilizar
el cliente v3 con credenciales de la organización activa, sin fallback global.

#### Scenario: Video completado
- **WHEN** se importa un ID HeyGen cuyo video está completado y tiene URL
- **THEN** se consulta GET /v3/videos/{id} y se valida la URL antes de descargar

#### Scenario: Video pendiente o fallido
- **WHEN** HeyGen informa un estado pendiente o una generación fallida
- **THEN** se devuelve respectivamente 202 o 422 sin descargar contenido

#### Scenario: Empresa sin credencial
- **WHEN** se requiere una consulta por ID y no existe credencial de organización
- **THEN** se devuelve 409 y no se consulta la cuenta global

#### Scenario: URL directa
- **WHEN** la solicitud contiene URL directa, aun acompañada de un ID
- **THEN** no se consultan credenciales HeyGen y la descarga valida la URL

#### Scenario: Fallo del proveedor
- **WHEN** falla la consulta HTTP a HeyGen
- **THEN** se devuelve un error seguro 502 y no se presenta como pendiente
