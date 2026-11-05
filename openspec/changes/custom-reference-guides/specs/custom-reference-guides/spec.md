## ADDED Requirements

### Requirement: Guías editoriales configurables
El editor SHALL ofrecer guías horizontales/verticales con posición en píxeles, color y eliminación.

#### Scenario: Encontrar las guías
- **WHEN** el autor utiliza el monitor en escritorio o pantalla estrecha
- **THEN** encuentra un botón con texto visible Guías sin abrir Herramientas
- **AND** abre el panel de líneas personalizables, diferenciado de la rejilla fija
- **AND** puede cerrarlo mediante el mismo botón, Cerrar guías o Escape sin perder sus referencias

#### Scenario: Crear y mover
- **WHEN** el autor agrega una guía y cambia su posición desde el panel o arrastrándola
- **THEN** se actualiza inmediatamente en el monitor sin mover ningún clip
- **AND** puede ajustar su posición con flechas y Shift para pasos mayores

#### Scenario: Persistencia local
- **WHEN** se vuelve a abrir el mismo draft en el navegador
- **THEN** se recuperan guías y visibilidad locales sin modificar el documento
- **AND** una falla de almacenamiento se informa sin impedir trabajar

#### Scenario: Snap y visibilidad
- **WHEN** hay guías visibles y Snap está activo
- **THEN** los bordes/centros pueden alinearse con ellas
- **AND** al ocultarlas dejan de participar en Snap

#### Scenario: Cambiar formato
- **WHEN** cambia el tamaño del canvas
- **THEN** se conserva la posición proporcional de cada guía y se actualiza su valor en píxeles

#### Scenario: Video final
- **WHEN** se compila el render o snapshot final
- **THEN** no se incluyen líneas de referencia ni sus preferencias

#### Scenario: Datos no válidos
- **WHEN** llega una posición no finita, un color arbitrario, IDs repetidos o más de 32 guías
- **THEN** se rechaza la configuración sin alterar la última configuración válida
