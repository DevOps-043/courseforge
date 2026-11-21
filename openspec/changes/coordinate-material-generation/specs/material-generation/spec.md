## ADDED Requirements
### Requirement: Inicio coordinado con destinos independientes
La vista de Materiales SHALL permitir iniciar los destinos requeridos y conservar progreso y controles separados de Hub y Academy.
#### Scenario: Fallo parcial de inicio
- **WHEN** falla el inicio de Hub y Academy sí inicia
- **THEN** Academy continúa y Hub muestra una recuperación independiente.
### Requirement: Reintentos durante la tanda
Los motores SHALL aceptar un reintento acotado de una unidad fallida mientras otras unidades continúan, sin ejecutar dos veces la misma unidad concurrentemente.
#### Scenario: Reintento de Hub con otra sesión activa
- **WHEN** una sesión falla y otra está generándose
- **THEN** el autor puede poner la sesión fallida en cola prioritaria sin cancelar la activa.
#### Scenario: Reintento de Academy con otra lección activa
- **WHEN** una lección falla y otra está generándose
- **THEN** el autor puede reservar su reintento si queda capacidad y se conservan los componentes válidos.
### Requirement: Confirmación segura del estado
Los workers SHALL comprobar reservas, versiones y unidades activas al guardar o finalizar y conservar diagnósticos seguros por etapa.
#### Scenario: Finalización concurrente con reintento
- **WHEN** se solicita un reintento al terminar la tanda
- **THEN** se conserva la solicitud o se informa un conflicto recuperable sin marcar el contenido activo como completado.
