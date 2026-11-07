## ADDED Requirements

### Requirement: Captura confirmada
El editor SHALL guardar el preset desde el documento confirmado más reciente.

#### Scenario: Hay valores pendientes al crear
- **WHEN** se solicita crear un preset manual o por instrucciones
- **THEN** se confirma la edición pendiente antes de capturar
- **AND** un error conserva los datos del formulario.

### Requirement: Parámetros portables y fuentes propias
El preset SHALL reutilizar configuración validada sin sustituir medios ni texto.

#### Scenario: Aplicación a otra lección
- **WHEN** se aplica un preset V2
- **THEN** las fuentes y el contenido son los del destino
- **AND** se restauran los parámetros portables cubiertos por el contrato.

### Requirement: Compatibilidad y límites explícitos
El sistema SHALL leer presets V1 y evitar pérdidas silenciosas.

#### Scenario: Configuración ligada al medio original
- **WHEN** una captura contiene parámetros no portables
- **THEN** la respuesta y el panel muestran diagnósticos
- **AND** la aplicación conserva esos parámetros en el destino.
