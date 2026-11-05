## ADDED Requirements

### Requirement: Base reproducible por unidad
El registro SHALL distinguir cambios heredados, runtime, códigos reales y límites.

#### Scenario: Gate falla antes de tipos
- **WHEN** el gate termina en lint
- **THEN** el registro conserva ese fallo y ejecuta tipos y grafo por separado
- **AND** no declara corregido ningún hallazgo por aprobar pruebas preexistentes

#### Scenario: Checkout con auditoría pendiente
- **WHEN** existen modificaciones previas
- **THEN** la unidad las identifica y conserva sin reinstalar dependencias
