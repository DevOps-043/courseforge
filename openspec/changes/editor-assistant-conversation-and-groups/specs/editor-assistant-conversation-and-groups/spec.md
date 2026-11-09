## ADDED Requirements

### Requirement: Respuestas conversacionales
El asistente SHALL distinguir el límite conversacional del resumen de edición.

#### Scenario: Pregunta sobre capacidades
- **WHEN** la salida tiene cero operaciones y una respuesta de hasta 1 200 caracteres
- **THEN** el editor devuelve una respuesta sin crear una propuesta.

### Requirement: Agrupación asistida reversible
El asistente SHALL ofrecer agrupación visible y desagrupación simple con confirmación.

#### Scenario: Agrupar o desagrupar
- **WHEN** el usuario solicita agrupar clips sueltos de la raíz o desagrupar un grupo simple de la raíz
- **THEN** la simulación muestra el cambio de pertenencia sin modificar clips ni tiempos.
- **AND** el guardado exige una propuesta confirmada sobre la versión base.
- **AND** deshacer restaura el estado de grupos original.

#### Scenario: Alcance fuera del contrato
- **WHEN** una operación toca pistas bloqueadas o cambia la jerarquía de grupos
- **THEN** la simulación la rechaza.
