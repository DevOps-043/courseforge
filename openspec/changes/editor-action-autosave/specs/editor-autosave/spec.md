## ADDED Requirements

### Requirement: Persistencia por interacción editorial
El editor SHALL guardar automáticamente cada acción editorial válida completada
sin requerir un botón Guardar por herramienta.

#### Scenario: Gesto continuo
- **WHEN** se arrastra o ajusta continuamente una propiedad
- **THEN** se previsualiza durante el gesto y se guarda un comando al terminar

#### Scenario: Edición incompleta
- **WHEN** un campo contiene temporalmente un valor inválido al escribir
- **THEN** se conserva localmente y no sustituye el documento confirmado

### Requirement: Historial y recuperación de pendientes
El editor SHALL conservar los comandos admitidos mientras se confirma su
persistencia y permitir revertir las ediciones según el contrato de historial.

#### Scenario: Error en la cola
- **WHEN** falla una escritura o su resultado es desconocido
- **THEN** se pausa el envío y se conservan los comandos posteriores para recuperación

#### Scenario: Deshacer una acción
- **WHEN** se deshace un gesto completado
- **THEN** se restaura su estado previo en una versión validada sin revertir efectos externos ajenos al documento

### Requirement: Efectos externos explícitos
El editor SHALL separar autoguardado editorial de procesamiento, render,
aprobación, publicación y borrado físico de recursos.

#### Scenario: Edición ordinaria
- **WHEN** se modifica una propiedad de composición
- **THEN** no se inicia render, publicación ni generación facturable por el mero guardado

### Requirement: Integración del historial HTML
La edición HTML SHALL mantener validación, recibos e historial editorial al
migrar sus campos hacia persistencia automática.

#### Scenario: Mutación de campo HTML
- **WHEN** se completa una edición HTML válida
- **THEN** se usa el host autorizado y se confirma la revisión antes de marcarla guardada
