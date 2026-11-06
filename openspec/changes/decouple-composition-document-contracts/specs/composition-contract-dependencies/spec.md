## ADDED Requirements

### Requirement: Contratos independientes de sus consumidores
El schema del documento MUST consumir contratos de clip y fuentes que no
dependan del propio documento ni de lectores o planes que consumen ese documento.

#### Scenario: Compatibilidad de exports
- **WHEN** un consumidor importa los schemas o tipos desde las rutas existentes
- **THEN** conserva los mismos objetos de schema, reglas, defaults y tipos públicos

#### Scenario: Plan de captions
- **WHEN** el documento valida su presupuesto de captions
- **THEN** sigue ejecutando el mismo plan con los mismos targets, tiempos y errores

#### Scenario: Serialización y entradas inválidas
- **WHEN** se procesan las fixtures caracterizadas antes de la extracción
- **THEN** los documentos y planes serializados y problemas Zod permanecen iguales

#### Scenario: Grafo
- **WHEN** se analiza sin cambiar ignores ni configuración
- **THEN** documento, plan de captions y lector de fuentes ya no forman una componente circular
