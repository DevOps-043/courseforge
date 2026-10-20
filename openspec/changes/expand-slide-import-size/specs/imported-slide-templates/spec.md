## ADDED Requirements

### Requirement: Presupuestos independientes de importación
El sistema SHALL permitir hasta 2 MB de fuente HTML y hasta 2 MB de familia procesada, conservando las restricciones editoriales.

#### Scenario: Deck de más de 500 KB compatible
- **WHEN** se importa un deck HTML/CSS/SVG superior a 500 KB y dentro de todos los nuevos presupuestos
- **THEN** se analiza y permite guardar sin aplicar el límite anterior

#### Scenario: Tamaño UTF-8 o transporte excesivo
- **WHEN** la fuente, la familia o el stream JSON excede su presupuesto, incluso sin Content-Length
- **THEN** se rechaza explícitamente sin consumir un stream ilimitado ni persistir datos

#### Scenario: Previews demasiado grandes
- **WHEN** la respuesta serializada de previews excede el presupuesto de transporte
- **THEN** se informa una incompatibilidad de previews en lugar de enviar una respuesta que exceda el límite del despliegue
