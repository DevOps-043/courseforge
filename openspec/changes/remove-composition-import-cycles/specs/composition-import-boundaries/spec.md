## Purpose
Conservar un grafo acíclico sin alterar el comportamiento del compositor usado en la entrega.

## ADDED Requirements
### Requirement: Fronteras acíclicas compatibles
Los contratos compartidos MUST evitar importar implementaciones que los consumen y MUST conservar los exports públicos existentes.
#### Scenario: Compilación y arquitectura
- **WHEN** se ejecutan tipos y architecture:cycles sobre todo el producto
- **THEN** los tipos son compatibles y no existen ciclos sin excluir módulos ni tipos del análisis.

### Requirement: Validación y autoridad conservadas
La reorganización MUST conservar límites Unicode, presupuesto de captions, referencias de fuentes, propiedad del proceso y autorización HTTP.
#### Scenario: Entradas inválidas y efectos inciertos
- **WHEN** se ejercitan las suites existentes de captions, fuentes, render controlado y HTTP
- **THEN** se mantienen las respuestas de rechazo, los límites y la recuperación anteriores.
