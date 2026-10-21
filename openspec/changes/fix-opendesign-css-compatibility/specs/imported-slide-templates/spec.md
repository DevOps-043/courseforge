## ADDED Requirements

### Requirement: CSS estático válido sin falsos positivos
El importador SHALL aceptar combinadores CSS directos y comentarios inertes con escapes, preservando el saneamiento de construcciones activas y recursos.

#### Scenario: Comentario de framework y combinador directo
- **WHEN** el CSS contiene un comentario con escapes y una regla `.axis > span`
- **THEN** se elimina el comentario y se conserva la regla aislada

#### Scenario: Escape activo
- **WHEN** una declaración o selector contiene escapes activos
- **THEN** se rechaza sin ejecutar ni descargar recursos

### Requirement: Familias OpenDesign de hasta 24 diseños
El sistema SHALL aceptar hasta 24 diseños si cumplen los demás presupuestos y el preflight, preservando atributos data-od-id usados para estilo sin conceder permisos.

#### Scenario: Export de 16 diapositivas
- **WHEN** se prepara y analiza un export compatible de 16 diapositivas
- **THEN** se conservan sus diseños y anclas visuales sin aplicar el tope anterior de 12
