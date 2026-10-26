# imported-template-bases Specification

## Purpose
TBD - created by archiving change imported-template-design-bases. Update Purpose after archive.
## Requirements
### Requirement: Crear plantillas desde bases importadas
El sistema SHALL ofrecer bases importadas autorizadas como punto de partida para crear nuevas plantillas en el estudio.

#### Scenario: Nueva plantilla independiente
- **WHEN** un administrador selecciona una base PACKAGED de su organización
- **THEN** el estudio muestra su HTML y crea una conversación/spec nueva con procedencia inmutable sin modificar la base

#### Scenario: Revisión conversacional
- **WHEN** el administrador solicita cambios de texto o estilo
- **THEN** la IA propone un parche acotado, el servidor valida el resultado y el estudio muestra la revisión del diseño importado

#### Scenario: Guardado y continuidad
- **WHEN** se guarda o reabre una derivada
- **THEN** conserva diseño, revisiones, selección y recursos privados sin regresar al catálogo fijo

#### Scenario: Base ajena o parche inválido
- **WHEN** se solicita una base ajena o la IA devuelve código, recursos o IDs no admitidos
- **THEN** el servidor rechaza la operación sin modificar la fuente ni persistir una revisión parcial
