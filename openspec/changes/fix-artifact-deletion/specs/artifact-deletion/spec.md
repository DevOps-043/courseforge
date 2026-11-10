## ADDED Requirements

### Requirement: Eliminación atómica por organización

El sistema SHALL exigir rol revisor y organización vigente para eliminar un
artefacto y SHALL confirmar éxito solo si la transacción elimina su fila.

#### Scenario: Borrador documental sin archivos
- **WHEN** un revisor autorizado elimina un borrador con configuración documental y sin reservas ni dependencias protegidas
- **THEN** se eliminan el artefacto y sus registros dependientes en una transacción

#### Scenario: Fuentes registradas o dependencia protegida
- **WHEN** el artefacto tiene una reserva de archivo, un original registrado o una dependencia que impide eliminarlo
- **THEN** se conserva el artefacto con sus registros y la acción informa el bloqueo

#### Scenario: Artefacto ajeno
- **WHEN** el ID existe en otra organización o el actor carece de rol revisor
- **THEN** la acción no elimina registros
