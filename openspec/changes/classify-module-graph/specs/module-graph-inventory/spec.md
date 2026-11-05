## ADDED Requirements

### Requirement: Inventario reproducible de dependencias
El diagnóstico MUST conservar entradas, versiones, HEAD, hashes, advertencias
y aristas sin modificar la política de aceptación del gate.

#### Scenario: Dependencia borrada por TypeScript
- **WHEN** un import solo aporta tipos y desaparece en la emisión aislada
- **THEN** el inventario lo distingue de imports conservados sin afirmar ejecución real

#### Scenario: Dependencia sin clasificación demostrable
- **WHEN** una arista de Madge no puede asociarse a la resolución de TypeScript
- **THEN** se informa como pendiente y no se descarta del grafo

#### Scenario: Ciclos presentes
- **WHEN** el grafo todavía contiene ciclos
- **THEN** architecture:cycles conserva su resultado fallido y TD-12 sigue abierto

#### Scenario: Recorridos alternativos
- **WHEN** un módulo pertenece a una componente cíclica pero no a los recorridos iniciales de Madge
- **THEN** se clasifican también sus aristas internas sin presentarlas como ejecución real
