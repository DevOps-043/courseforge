## ADDED Requirements

### Requirement: Eliminación atómica por organización

El sistema SHALL exigir rol revisor y organización vigente para eliminar un
artefacto y SHALL confirmar éxito solo si la transacción elimina su fila.

#### Scenario: Borrador documental sin archivos
- **WHEN** un revisor autorizado elimina un borrador con configuración documental y sin reservas ni dependencias protegidas
- **THEN** se eliminan el artefacto y sus registros dependientes en una transacción

#### Scenario: Revisión y descarga de documentos
- **WHEN** un revisor solicita eliminar un artefacto
- **THEN** la primera confirmación solo muestra el manifiesto de documentos y la segunda autoriza su eliminación
- **AND** se ofrece el original privado cuando existe o el TXT cuando el sistema histórico solo guardó el texto

#### Scenario: Manifiesto vigente
- **WHEN** un revisor confirma la segunda etapa con el manifiesto vigente
- **THEN** se eliminan los registros del artefacto y se agenda la limpieza recuperable de los originales en la misma transacción

#### Scenario: Manifiesto cambiado o dependencia protegida
- **WHEN** el manifiesto cambió o una dependencia protegida impide eliminar el curso
- **THEN** se conservan los datos y se informa que debe revisarse la lista o que existe un bloqueo

#### Scenario: Artefacto ajeno
- **WHEN** el ID existe en otra organización o el actor carece de rol revisor
- **THEN** la acción no elimina registros
