## ADDED Requirements

### Requirement: Los videos extendidos continúan en bucle
El preview SHALL repetir la fuente a velocidad normal cuando la duración del clip exceda su fuente, sin búsquedas reiteradas al último fotograma durante buffering.

#### Scenario: Extender un video cargado
- **WHEN** un video de dos segundos se extiende en vivo a seis segundos
- **THEN** el preview reproduce tres ciclos y permite buscar fotogramas de cada ciclo

#### Scenario: El decoder cruza el final antes que el reloj
- **WHEN** el decoder de un video en bucle está cerca de cero y el reloj sigue cerca del final de la fuente
- **THEN** el sincronizador permite completar el bucle sin regresar al último fotograma

#### Scenario: Seek explícito o entrada al clip
- **WHEN** el usuario busca una posición o entra al clip
- **THEN** el sincronizador conserva la posición fuente exacta y corrige un desfase real

#### Scenario: Medio sin bucle
- **WHEN** el medio no tiene repetición habilitada
- **THEN** se conserva la comparación lineal y la congelación explícita mantiene su contrato
