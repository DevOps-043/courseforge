## ADDED Requirements

### Requirement: Capas visuales extensibles
El editor SHALL conservar 0–10 como base y registrar capas extra en el documento.

#### Scenario: Agregar y recargar
- **WHEN** el usuario agrega las capas 11 y 12 y guarda
- **THEN** permanecen disponibles tras recargar, incluso vacías

#### Scenario: Quitar una capa vacía
- **WHEN** se elimina una capa extra sin clips
- **THEN** desaparece sin renumerar las demás ni modificar capas base

#### Scenario: Quitar una capa ocupada
- **WHEN** el usuario confirma dos veces los elementos de una capa extra
- **THEN** se eliminan atómicamente la capa y sus clips, conservando los assets

#### Scenario: Cancelación, bloqueo o edición concurrente
- **WHEN** falta confirmación, cambia el conjunto de clips o una pista está bloqueada
- **THEN** no se elimina la capa ocupada

#### Scenario: Documento histórico
- **WHEN** se abre un documento sin registro de capas extra
- **THEN** conserva la normalización histórica y las profundidades predeterminadas
