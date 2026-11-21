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

### Requirement: Reintentar el despacho inicial de Base documental

El sistema SHALL permitir que un editor autorizado reintente el despacho de la ejecución de Base reservada que aún no haya tomado un worker, sin iniciar otro borrador.

#### Scenario: Despacho inicial sin invocaciones

- **WHEN** la reserva tiene al menos un minuto, registra cero invocaciones y un editor autorizado solicita reintentar la ejecución vigente
- **THEN** el sistema conserva el identificador y la revisión, asigna el despacho al despliegue actual de forma condicional y usa la llamada firmada de Base

#### Scenario: Trabajo activo o solicitud obsoleta

- **WHEN** un worker ya tomó la ejecución o la solicitud corresponde a otra organización o ejecución
- **THEN** el sistema conserva la reserva vigente y evita otro despacho
