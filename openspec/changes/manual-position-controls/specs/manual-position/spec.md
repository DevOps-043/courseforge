## ADDED Requirements

### Requirement: Posición manual compartida
El inspector SHALL ofrecer controles X/Y con deslizador horizontal y campo numérico en píxeles para los clips visuales.

#### Scenario: Reposicionar un medio o texto
- **WHEN** el autor cambia X mediante el deslizador o Y mediante su campo
- **THEN** se actualiza el valor del control complementario y se guarda con clip.layout
- **AND** se conservan tamaño, rotación, opacidad y el otro eje

#### Scenario: Posiciones negativas y cambio de formato
- **WHEN** se selecciona un clip con posición negativa o se cambia el tamaño del lienzo
- **THEN** los controles conservan la posición y adaptan su rango sin exceder el esquema

#### Scenario: Entrada incompleta o fuera de límites
- **WHEN** el campo numérico está vacío o fuera del esquema
- **THEN** no se persiste una posición inválida

#### Scenario: Pista bloqueada
- **WHEN** la pista está bloqueada o la edición restringida
- **THEN** los nuevos controles están deshabilitados
