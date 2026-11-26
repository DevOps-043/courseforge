## ADDED Requirements

### Requirement: Generar y corregir planes con restricciones explícitas
El worker SHALL suministrar duración total, unicidad de bloques y vínculos
permitidos y obligatorios derivados del recorrido aprobado. Un plan inválido
SHALL recibir como máximo una corrección por unidad y ejecución del worker,
dentro del presupuesto. La corrección SHALL pasar esquema, reglas de modalidad y
respaldo antes de guardarse mediante el control de revisión existente.

#### Scenario: Vínculo de preparación omitido
- **WHEN** la sesión comparte una lección con un tramo anterior y la respuesta omite su vínculo
- **THEN** se pide corregir con BEFORE y se valida de nuevo el plan completo
- **AND** si vuelve a incumplir no se confirma ninguna versión nueva

### Requirement: Diagnóstico seguro y configuración fijada
El rechazo SHALL identificar las reglas incumplidas sin incluir contenido del
proveedor o fuentes privadas. Reanudar SHALL conservar el modelo y prompt del
snapshot, aunque cambie la configuración para nuevas ejecuciones.

#### Scenario: Plan rechazado con títulos privados
- **WHEN** el plan no distribuye los minutos disponibles
- **THEN** el diagnóstico informa minutos esperados y obtenidos sin serializar título ni contenido
