## ADDED Requirements

### Requirement: Posición manual compartida
El inspector SHALL ofrecer controles X/Y con deslizador horizontal y campo numérico en píxeles para los clips visuales.

#### Scenario: Reposicionar un medio o texto
- **WHEN** el autor cambia X mediante el deslizador o Y mediante su campo
- **THEN** se actualiza el valor del control complementario y se guarda con clip.layout
- **AND** se conservan tamaño, rotación, opacidad y el otro eje

#### Scenario: Encontrar el selector horizontal
- **WHEN** el autor selecciona video, imagen, diapositiva, texto o subtítulos y abre Propiedades
- **THEN** encuentra una única sección Posición manual antes de los ajustes de tiempo y audio
- **AND** Horizontal (X) y Vertical (Y) identifican los deslizadores y sus campos numéricos sin controles X/Y duplicados

#### Scenario: Posiciones negativas y cambio de formato
- **WHEN** se selecciona un clip con posición negativa o se cambia el tamaño del lienzo
- **THEN** los controles conservan la posición y adaptan su rango sin exceder el esquema

#### Scenario: Entrada incompleta o fuera de límites
- **WHEN** el campo numérico está vacío o fuera del esquema
- **THEN** no se persiste una posición inválida

#### Scenario: Pista bloqueada
- **WHEN** la pista está bloqueada o la edición restringida
- **THEN** los nuevos controles están deshabilitados

### Requirement: Vista de posición durante la interacción
El editor SHALL reflejar cada posición válida en el monitor antes de guardar el gesto, sin escribir una versión por cada movimiento.

#### Scenario: Arrastrar sin soltar
- **WHEN** el autor desplaza X o Y y mantiene pulsado el deslizador
- **THEN** el elemento cambia de posición en el iframe durante el gesto
- **AND** el guardado espera al final de la interacción

#### Scenario: Confirmación anterior y nuevo borrador
- **WHEN** llega un patch canónico durante un movimiento posterior pendiente
- **THEN** el preview conserva ese movimiento sobre la base actualizada
- **AND** al retirar el preview se restaura esa base actualizada

#### Scenario: Cambiar selección o bloquear
- **WHEN** el inspector cambia de clip, se desmonta o queda bloqueado
- **THEN** retira la superposición temporal sin cambiar la posición persistida
