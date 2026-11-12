## ADDED Requirements

### Requirement: Ventanas de preset dentro del timeline
Al aplicar una regla de secuencia o superposición, el motor SHALL mantener su
ventana cuantizada dentro del límite válido de la composición destino.

#### Scenario: Duración destino entre frames
- **WHEN** el frame más cercano al final de la ventana excede el canvas
- **THEN** el motor usa el frame anterior y conserva la duración del documento
- **AND** la secuencia reparte los frames disponibles según los pesos del preset.

#### Scenario: Superposición con un solo frame disponible
- **WHEN** varios clips coinciden con una regla de superposición y la ventana tiene un frame
- **THEN** los clips editables comparten ese frame.

#### Scenario: Ventana sin capacidad
- **WHEN** la ventana tiene menos de un frame por clip de secuencia o carece de un frame para la superposición
- **THEN** se devuelve un conflicto de capacidad y no se persiste el preview.
