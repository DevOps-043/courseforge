## ADDED Requirements

### Requirement: Descriptor independiente de adaptadores y coordinador
Los consumidores del descriptor de render controlado MUST depender de un
contrato neutral equivalente al descriptor emitido por la autoridad existente.

#### Scenario: Compatibilidad de renderer y executor
- **WHEN** el supervisor invoca un renderer o un adaptador invoca su executor
- **THEN** descriptor, workspace, controles, señal y resultado conservan sus tipos y comportamiento

#### Scenario: Garantías operativas
- **WHEN** el flujo adquiere un fence, cancela o finaliza una ejecución
- **THEN** sus implementaciones emitidas permanecen idénticas y siguen exigiendo las mismas pruebas de autoridad y terminación

#### Scenario: Grafo con tipos
- **WHEN** se analiza sin excluir import type
- **THEN** el descriptor no crea dependencias de regreso a servicios o adaptadores de QA
