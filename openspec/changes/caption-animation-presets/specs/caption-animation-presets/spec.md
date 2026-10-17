## ADDED Requirements

### Requirement: Catálogo específico
El editor SHALL ofrecer Educativo, Lectura guiada y Social como presets de animación sin modificar texto, palabras, tiempos ni apariencia personalizada de las fuentes.

#### Scenario: Aplicar preset
- **WHEN** el usuario selecciona un preset de capa
- **THEN** se actualizan sus settings de efectos y se conservan las personalizaciones por frase.

### Requirement: Resaltado Social estable
El compilador SHALL resaltar el fondo y texto de la palabra activa sin modificar su posición y restaurar su énfasis al terminar el intervalo.

#### Scenario: Seek inverso
- **WHEN** se avanza, retrocede y vuelve al mismo instante
- **THEN** se reproduce el mismo fondo/color, posición y texto en preview y render.

#### Scenario: Sin timestamps válidos
- **WHEN** el caption no tiene palabras alineadas con el texto
- **THEN** se mantiene la frase completa y su animación, sin inventar seguimiento por palabra.

### Requirement: Compatibilidad y validación
El sistema SHALL conservar la lectura de efectos V1 existentes y rechazar colores no válidos y propiedades ejecutables.

#### Scenario: Documento anterior
- **WHEN** se valida un documento sin activeBackgroundColor
- **THEN** no se agrega ese campo a la representación persistida.
