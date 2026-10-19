## ADDED Requirements

### Requirement: Importación revisada y aislada
El sistema SHALL admitir HTML estático mediante un administrador del tenant activo, presentar un reporte de limpieza y exigir revisión antes del guardado.

#### Scenario: HTML con código y recursos externos
- **WHEN** se analiza un archivo con scripts, handlers o URLs externas
- **THEN** se retiran o rechazan esas construcciones y el preview no puede ejecutar scripts ni acceder a red

### Requirement: Reutilización del diseño
El sistema SHALL renderizar la estructura HTML/CSS importada con campos validados y sin truncar contenido silenciosamente.

#### Scenario: Contenido nuevo compatible
- **WHEN** una diapositiva cabe en los campos de una plantilla importada seleccionada
- **THEN** se conserva su estructura y se insertan valores escapados del contenido nuevo

#### Scenario: Capacidad insuficiente
- **WHEN** ninguna plantilla admite el contenido
- **THEN** se devuelve un error explícito y no se sustituye silenciosamente por el layout estándar

### Requirement: Aislamiento y reintentos
El sistema SHALL resolver organización y permisos en servidor y conservar una identidad por importación normalizada dentro del tenant.

#### Scenario: Reintento de guardado
- **WHEN** se vuelve a guardar el mismo diseño revisado en la misma organización
- **THEN** se recupera la misma importación sin crear versiones duplicadas
