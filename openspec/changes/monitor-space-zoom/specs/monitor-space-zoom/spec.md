## ADDED Requirements

### Requirement: Zoom de vista ajustable
El editor SHALL ofrecer zoom de 25% a 400% y ajuste para encajar el lienzo completo sin modificar el documento.

#### Scenario: Ajustar y encajar
- **WHEN** se cambia el zoom mediante slider, porcentaje o preset
- **THEN** el iframe y áreas seguras usan la misma escala
- **AND** Encajar restaura 100% relativo al área disponible

#### Scenario: Límites inválidos
- **WHEN** llega un zoom no finito o fuera del rango
- **THEN** se rechaza sin alterar la vista válida

### Requirement: Monitor ampliado sin fullscreen
El editor SHALL aprovechar el área disponible y ofrecer ampliación dentro de la página.

#### Scenario: Ampliar y restaurar
- **WHEN** se amplía el monitor
- **THEN** ocupa el ancho de los laterales y más altura sin entrar en fullscreen
- **AND** restaurar recupera distribución y paneles anteriores

#### Scenario: Reabrir inspector o biblioteca
- **WHEN** se solicita un lateral mientras el monitor está ampliado
- **THEN** se restaura la distribución y se abre el lateral solicitado

#### Scenario: Pantallas pequeñas y otras proporciones
- **WHEN** se usa pantalla estrecha o canvas vertical/cuadrado
- **THEN** los controles de zoom permanecen accesibles y el lienzo encaja sin deformarse
