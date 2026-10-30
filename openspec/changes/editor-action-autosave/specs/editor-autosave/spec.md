## ADDED Requirements

### Requirement: Continuidad durante persistencia
El editor SHALL admitir comandos locales válidos durante el guardado nativo,
componer su preview en orden y persistirlos mediante la única cola existente.

#### Scenario: Respuesta tardía
- **WHEN** se realiza un segundo cambio mientras el primer PUT sigue pendiente
- **THEN** el preview refleja ambos y la respuesta del primero conserva el segundo

#### Scenario: Escritura incierta
- **WHEN** falla el primer envío con comandos posteriores admitidos
- **THEN** se cancelan los envíos posteriores, se conserva su copia recuperable y
  se requiere recuperación explícita antes de continuar escribiendo

#### Scenario: Edición de una propiedad
- **WHEN** sólo cambia X en el inspector
- **THEN** se emite layout.x sin reenviar duración, inicio ni opacidad sin cambios

#### Scenario: Texto nativo junto a HTML controlado
- **WHEN** cambia sólo el contenido de una capa de texto nativa independiente
- **THEN** se aplica texto literal sin navegar el iframe ni modificar raíces editoriales

#### Scenario: Presupuesto de observabilidad
- **WHEN** una sesión supera cien eventos en un minuto
- **THEN** se acota el envío y vuelve a admitir muestras en la siguiente ventana,
  sin incluir texto del usuario ni URLs

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
