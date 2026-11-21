## ADDED Requirements

### Requirement: Confirmar materiales con evidencia documental vigente

El sistema SHALL validar el respaldo factual de los materiales de ambas modalidades y asociar las citas verificadas con el contenido exacto confirmado.

#### Scenario: Material apto para confirmar

- **WHEN** el material contiene afirmaciones respaldadas, instrucciones de práctica claramente identificadas y citas literales válidas
- **THEN** el sistema confirma el resultado mediante el RPC de su modalidad y lo expone en la lectura de materiales

#### Scenario: Revisión documental incompleta

- **WHEN** la revisión devuelve citas inexactas o detecta una afirmación sin respaldo
- **THEN** el sistema puede intentar una corrección acotada y exige revisar nuevamente antes de confirmar

#### Scenario: Resultado rechazado o ejecución sustituida

- **WHEN** el resultado sigue sin respaldo, la evidencia deja de estar vigente o la ejecución pierde su revisión activa
- **THEN** el sistema conserva las versiones guardadas y comunica el fallo de la etapa correspondiente
