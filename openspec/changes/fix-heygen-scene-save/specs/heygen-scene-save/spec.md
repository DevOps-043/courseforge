## ADDED Requirements

### Requirement: Guardado de borradores de escenas
El sistema SHALL guardar una escena incompleta sin exigir generar contenido.

#### Scenario: Guion vacío
- **WHEN** el editor agrega una escena sin guion y guarda
- **THEN** el contrato admite el borrador y conserva las demás escenas

#### Scenario: Eliminación manual
- **WHEN** se elimina una escena manual y se guarda
- **THEN** se transmite su eliminación explícita y no aparece al reconstruir escenas

#### Scenario: Generación de una escena vacía
- **WHEN** se solicita generar una escena activa cuyo guion está vacío
- **THEN** se rechaza antes de enviar trabajo al proveedor

#### Scenario: Borrador no seleccionado
- **WHEN** un snapshot de generación contiene un borrador vacío no seleccionado
- **THEN** no bloquea la generación de las escenas completas seleccionadas

### Requirement: Confirmación visible del guardado
El sistema SHALL mostrar progreso y resultado junto a Guardar cambios.

#### Scenario: Guardado pendiente
- **WHEN** hay una solicitud de guardado pendiente
- **THEN** se muestra Guardando y se bloquean nuevos guardados y edición

#### Scenario: Error de guardado
- **WHEN** la API rechaza la solicitud o no devuelve escenas válidas
- **THEN** se muestra un error local sin confirmar éxito ni descartar la edición
