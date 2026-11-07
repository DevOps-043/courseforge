## ADDED Requirements

### Requirement: Aclaraciones durante la asistencia de edición

La asistencia SHALL responder con una aclaración cuando falte un dato material y aceptar hasta cuatro mensajes recientes para interpretar el siguiente turno.

#### Scenario: Resolver el alcance del ajuste

- **WHEN** una solicitud de volumen no identifica el objetivo y hay varios candidatos
- **THEN** el agente pregunta por el objetivo sin crear una propuesta
- **AND** el siguiente turno incluye el intercambio reciente

### Requirement: Herramientas de edición reversibles

El agente SHALL poder proponer ajustes de volumen individual, fundidos de audio, volumen maestro y encuadre por medio del contrato de edición versionado.

#### Scenario: Proponer, aplicar y deshacer un ajuste

- **WHEN** el usuario solicita un ajuste compatible sobre un clip editable
- **THEN** el agente devuelve una propuesta simulada con el cambio visible en el diff
- **AND** la aplicación requiere confirmar la propuesta sobre su versión original
- **AND** deshacer recupera el documento exacto mientras no haya una edición posterior

#### Scenario: Rechazar una herramienta no autorizada

- **WHEN** la salida intenta eliminar un clip o sustituir su fuente
- **THEN** el servidor rechaza la operación antes de persistir una propuesta
