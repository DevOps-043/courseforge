## ADDED Requirements

### Requirement: Crossfade entre clips de audio
El sistema SHALL permitir una transición lineal entre audios adyacentes de la misma pista con material de fuente suficiente.

#### Scenario: Crossfade válido
- **WHEN** se añade una transición a dos audios con handles válidos
- **THEN** preview/render solapan las ventanas correctas y aplican ganancias complementarias sin animaciones visuales.

#### Scenario: Fuente insuficiente o pista bloqueada
- **WHEN** faltan handles, duración de fuente o la pista está bloqueada
- **THEN** se rechaza el cambio sin modificar el documento.

### Requirement: Zoom y cortes sobre la onda
El sistema SHALL permitir ampliar el audio y ubicar el cursor visualmente para dividirlo sin modificar el archivo original.

#### Scenario: Ampliar y cortar
- **WHEN** se amplía un audio y se hace doble clic en su onda
- **THEN** el cursor se coloca en el frame pulsado y Dividir conserva los offsets correspondientes en ambos segmentos.

#### Scenario: Zoom acotado
- **WHEN** el documento es largo o se aplica zoom máximo
- **THEN** el zoom y las marcas del ruler permanecen acotados y la forma de onda usa la ventana visible.
