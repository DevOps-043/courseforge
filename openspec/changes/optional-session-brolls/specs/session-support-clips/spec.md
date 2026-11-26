## ADDED Requirements

### Requirement: Clips de apoyo opcionales
Producción SHALL permitir añadir y revisar B-rolls de una sesión sin requerir avatar, locución o video final y sin bloquear el curso si no hay clips.

#### Scenario: Sesión sin clips
- **WHEN** una sesión aprobada no tiene B-rolls
- **THEN** puede continuar su flujo y la interfaz informa que los apoyos son opcionales

#### Scenario: Carga válida
- **WHEN** se carga y confirma un MP4/WebM dentro de límites
- **THEN** se registra como apoyo de esa sesión pendiente de revisión y puede reproducirse de forma privada

### Requirement: Integridad y autorización
El servidor SHALL comprobar pertenencia a tenant, curso, sesión y revisión antes de firmar, confirmar, aprobar, retirar o reproducir. SHALL validar los bytes reales antes de servir el clip.

#### Scenario: Archivo falso o referencia ajena
- **WHEN** se intenta registrar contenido incompatible o un asset de otra sesión
- **THEN** no se obtiene un apoyo válido ni un acceso de reproducción

#### Scenario: Cambio de materiales
- **WHEN** cambia la revisión que respalda el clip
- **THEN** debe validarse otra vez y no conserva automáticamente su aprobación anterior

#### Scenario: Retiro concurrente
- **WHEN** se retira un clip mientras se verifica
- **THEN** la confirmación no lo revive y se conserva el archivo

### Requirement: Revisión humana y reintentos
La aprobación SHALL exigir rol revisor. Reintentar una carga o confirmación SHALL conservar la identidad del archivo y no crear duplicados ni sobrescribir bytes.

#### Scenario: Constructor revisa
- **WHEN** un autor sin rol revisor intenta aprobar el apoyo
- **THEN** la operación se rechaza aunque pueda consultar o cargar recursos del curso autorizado

#### Scenario: Confirmación perdida
- **WHEN** se repite una confirmación de un apoyo ya validado para la misma revisión
- **THEN** se devuelve su estado sin duplicar la inspección ni el registro
