## ADDED Requirements

### Requirement: Validación de captions sin dependencia del servicio de efectos
El schema de cues MUST validar énfasis mediante un módulo puro que no dependa
del propio schema ni del servicio de efectos, conservando su comportamiento.

#### Scenario: Grafemas compuestos
- **WHEN** un rango divide emoji, una secuencia ZWJ, una bandera o un carácter con acento combinante
- **THEN** se conserva el rechazo existente usando offsets UTF-16

#### Scenario: Rangos adyacentes y entrada desordenada
- **WHEN** los rangos cubren grafemas completos sin solapamiento
- **THEN** se aceptan sin modificar el orden de la entrada original

#### Scenario: Consumidores del servicio existente
- **WHEN** un consumidor importa las funciones desde el servicio de efectos
- **THEN** la interfaz y el comportamiento permanecen disponibles mediante reexports

#### Scenario: Grafo estructural
- **WHEN** se vuelve a analizar el grafo sin cambiar su configuración
- **THEN** el grupo effects.service/text-layer.types/text-presentation deja de ser cíclico
