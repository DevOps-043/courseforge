## ADDED Requirements

### Requirement: Generación nativa optativa
El sistema SHALL crear subtítulos nativos transparentes para ejecuciones aprobadas con `nativeCaptions: true` y voz por escena con tiempos válidos.

#### Scenario: Assets listos
- **WHEN** el refresco encuentra todos los assets requeridos y timestamps actuales
- **THEN** persiste una capa `NATIVE_CAPTIONS`, origen `TRANSCRIPT`, con `backgroundOpacity: 0`, sin pulsar el botón del editor.

#### Scenario: Compatibilidad y override
- **WHEN** la opción está ausente o el componente la desactiva
- **THEN** no se crea ni elimina ninguna capa automáticamente.

### Requirement: Protección editorial e idempotencia
El sistema SHALL preservar captions existentes y usar persistencia optimista.

#### Scenario: Reintento
- **WHEN** ya existe la misma capa con los mismos cues y tiempos
- **THEN** confirma el resultado sin escribir otra versión ni duplicar capas.

#### Scenario: Edición, recorte o eliminación
- **WHEN** existen captions incompatibles o se eliminó la capa registrada
- **THEN** requiere revisión sin reemplazar o recrear contenido.

#### Scenario: Usuario confirma sobrescritura de una capa
- **WHEN** el usuario acepta reemplazar la única capa existente y confirma su item, clip y hash vigentes
- **THEN** regenera esa capa desde la voz, conserva su identidad y estilo de capa, y establece fondo transparente.

#### Scenario: Usuario cancela o cambia el documento
- **WHEN** cancela el diálogo o la versión ya no coincide con la confirmada
- **THEN** no sobrescribe la capa y una nueva versión requiere otra confirmación.

#### Scenario: Conflicto de versión
- **WHEN** el documento cambia antes del append
- **THEN** no sobrescribe la edición concurrente y comunica un estado pendiente de revisión.

### Requirement: Dependencias y autorización explícitas
El sistema SHALL mantener el item fuera de READY_FOR_ASSEMBLY cuando los subtítulos solicitados no estén disponibles, y resolver recursos por organización en servidor.

#### Scenario: Tiempos incompletos
- **WHEN** una voz no tiene timestamps o su guion cambió
- **THEN** informa la dependencia sin generar subtítulos parciales ni solicitar transcripción pagada.

#### Scenario: Organización distinta
- **WHEN** el componente o borrador no pertenece a la organización autorizada
- **THEN** rechaza la operación antes de guardar captions.
