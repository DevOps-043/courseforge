## ADDED Requirements
### Requirement: Identidad centralizada
El sistema SHALL obtener la identidad de presentación de una configuración pública versionada sin credenciales ni variables de entorno.

#### Scenario: Cambio de nombre
- **WHEN** el equipo modifica el nombre de producto en la configuración
- **THEN** UI, metadata, prompts predeterminados y exportaciones nuevas utilizan el nombre configurado
- **AND** el contenido histórico no se reescribe

### Requirement: Compatibilidad técnica
El sistema SHALL conservar identificadores de autenticación, proveedores, formatos, eventos y almacenamiento durante un cambio de marca.

#### Scenario: Nueva identidad sin migración
- **WHEN** cambia la identidad visible
- **THEN** los contratos técnicos existentes y la plataforma externa SofLIA mantienen su identidad

### Requirement: Interpolación segura
El sistema SHALL escapar los textos de identidad que inserta en documentos HTML generados.

#### Scenario: Nombre con caracteres especiales
- **WHEN** la identidad contiene ampersands, comillas o signos de menor que
- **THEN** se representa como texto sin crear etiquetas ni scripts
