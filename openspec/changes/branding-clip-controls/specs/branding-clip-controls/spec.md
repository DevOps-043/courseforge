## ADDED Requirements

### Requirement: Acceso directo a propiedades de branding
El editor SHALL ofrecer Editar intro y Editar outro para los clips insertados,
abriendo sus controles compartidos de capas, transformación y animaciones.

#### Scenario: Editar un outro insertado
- **WHEN** se pulsa Editar outro
- **THEN** se selecciona únicamente ese clip y se abre su inspector de propiedades
- **AND** el cursor se sitúa al inicio del outro

#### Scenario: Sin branding insertado
- **WHEN** el documento no contiene intros ni outros
- **THEN** no aparecen accesos de edición de branding

### Requirement: Conservación de ajustes al reaplicar
El reconciliador SHALL conservar los ajustes y animaciones de una instancia
cuando el asset y su placement coinciden con los ya insertados.

#### Scenario: Reaplicar el mismo recurso
- **WHEN** una intro u outro editada se vuelve a aplicar
- **THEN** conserva identidad, profundidad, transformación, recorte y motion
- **AND** reaplicar otra vez no acumula desplazamientos ni clips

#### Scenario: Sustituir o retirar el recurso
- **WHEN** se sustituye o retira la instancia
- **THEN** se elimina su motion anterior sin borrar el del otro recurso conservado

#### Scenario: Pista bloqueada
- **WHEN** se solicita cambiar capa o animación de un clip en pista bloqueada
- **THEN** el validador existente rechaza la operación
