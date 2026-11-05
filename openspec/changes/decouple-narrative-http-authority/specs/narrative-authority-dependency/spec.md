## ADDED Requirements

### Requirement: Autoridad narrativa independiente de handlers
El contrato de autoridad HTTP narrativa MUST ser independiente del handler
genérico y de sus adaptadores, conservando la unión y el export público previo.

#### Scenario: Resolución de autoridad
- **WHEN** un consumidor tipa su resultado de autorización con el contrato neutral
- **THEN** conserva identidad/organización y los mismos estados de rechazo sin cambios de JavaScript

#### Scenario: Compatibilidad
- **WHEN** un consumidor usa la ruta anterior del adaptador de voz
- **THEN** el tipo sigue disponible sin obligar al handler genérico a importar ese adaptador

#### Scenario: Grafo
- **WHEN** Madge analiza todas las dependencias incluidos tipos
- **THEN** no existe componente circular entre el handler genérico y el adaptador de voz
