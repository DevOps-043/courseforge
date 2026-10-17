## ADDED Requirements

### Requirement: Párrafo de palabras sincronizadas
El renderer SHALL disponer las palabras de un caption en flujo horizontal con ajuste natural al ancho disponible y conservar la identidad y tiempos de cada palabra.

#### Scenario: Caption ancho
- **WHEN** el diálogo completo cabe en el ancho disponible
- **THEN** sus palabras comparten línea y avanzan horizontalmente.

#### Scenario: Caption estrecho y redimensionamiento
- **WHEN** el diálogo requiere varias líneas y después se amplía el contenedor
- **THEN** el texto forma líneas de párrafo y vuelve a distribuirse al nuevo ancho.

#### Scenario: Seguimiento temporal
- **WHEN** se avanza y retrocede el playhead
- **THEN** el resaltado de cada palabra respeta sus tiempos sin cambiar su posición en el párrafo.

#### Scenario: Preview y render
- **WHEN** se compila el mismo caption para preview o render
- **THEN** se conserva la misma estructura de párrafo, texto y anclas de palabras.
