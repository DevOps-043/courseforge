## ADDED Requirements

### Requirement: Selección de modelos por operación de sesiones
La configuración de agenda, plan y materiales de sesión SHALL ofrecer selectores
con el mismo catálogo de modelos de texto usado por las fases del pipeline.
SHALL conservar la herencia, mostrar valores configurados fuera del catálogo y
permitir un respaldo opcional distinto del principal. Los cambios guardados
SHALL aplicarse solo a nuevas ejecuciones.

#### Scenario: Cambiar modelo y retirar respaldo
- **WHEN** el autor desactiva la herencia y selecciona modelos para una operación
- **THEN** puede guardar un principal y un respaldo distinto o elegir Sin respaldo
- **AND** no se modifica la configuración fijada de una ejecución iniciada

### Requirement: Recorrido híbrido explícito en Architect
Architect SHALL permitir guardar una secuencia ordenada de tramos asíncronos de Learning y sesiones síncronas de Hub después de aprobar el temario. Cada tramo asíncrono SHALL indicar lecciones, título y duración; cada sesión SHALL conservar sus IDs y duración. El resumen SHALL separar tiempos de ambas modalidades sin sumar dos veces la cobertura temática.

#### Scenario: Alternar modalidades
- **WHEN** el autor organiza una sesión, un tramo de estudio y otra sesión
- **THEN** conserva orden, referencias y duraciones tras guardar y recargar
- **AND** el sistema exige cubrir el temario entre ambas modalidades, sin obligar a tratar todas las lecciones en vivo

### Requirement: Validación y vigencia del recorrido
El servidor SHALL rechazar referencias ajenas, sesiones omitidas o duplicadas, lecciones asíncronas duplicadas y cobertura incompleta. Guardar el recorrido SHALL invalidar las aprobaciones y planes dependientes. Los documentos antiguos SHALL seguir siendo legibles, pero un híbrido SHALL completar su recorrido antes de generar o aprobar planes nuevos.

#### Scenario: Cambiar la distribución
- **WHEN** cambia el orden o la cobertura del recorrido
- **THEN** la revisión se guarda mediante el control de concurrencia existente y los planes quedan pendientes de actualización

### Requirement: Agenda con requisitos comprensibles y estado actualizado
La interfaz SHALL actualizar la aprobación del temario sin recargar manualmente y mostrar las causas del bloqueo. Los errores de configuración SHALL distinguirse de falta de aprobación y conservarse sin revelar información sensible.

#### Scenario: Aprobar el temario en la misma ficha
- **WHEN** cambia el estado del temario
- **THEN** se consulta de nuevo la impartición y el botón refleja los requisitos actuales

## Alcance de esta entrega
Autoría, persistencia y generación de preparación en Architect. La ampliación del pipeline aplica las reglas siguientes. El recorrido no se añade silenciosamente al manifiesto de preparación de Hub: su publicación y navegación en Academy requieren un contrato coordinado posterior. La entrega existente sigue transportando únicamente sesiones síncronas. No se ejecutan cambios remotos ni generaciones pagadas como verificación automática.

### Requirement: Generación por destino y vigencia de la distribución
Architect SHALL generar el plan de Academy únicamente para las lecciones de tramos asíncronos, conservando sus IDs curriculares y de módulo originales. La preparación de sesiones SHALL ser una operación separada sin despachar generación asíncrona implícitamente. La aprobación SHALL rechazar planes híbridos sin huella vigente de distribución. Los materiales y recursos consumidos por el pipeline de producción SHALL corresponder a Academy y a esa distribución.

#### Scenario: Temas exclusivos y compartidos
- **WHEN** un recorrido contiene temas exclusivos de Hub, temas exclusivos de Academy y un tema compartido
- **THEN** el plan de Academy contiene una entrada por lección asignada a estudio asíncrono
- **AND** la curación conserva las necesidades de ambos destinos sin perder los temas exclusivos de Hub
- **AND** cambiar la distribución impide reutilizar aprobaciones o recursos con huella anterior

### Requirement: Publicación híbrida con recepción compatible
Architect SHALL impedir publicar un híbrido en un receptor que no aplica su recorrido ni conserva identidad externa al redistribuir lecciones. La confirmación del inbox SHALL distinguirse de la aprobación final en Academy. La entrega de preparación a una sesión programada de Hub SHALL conservar su contrato y autorizaciones existentes.

#### Scenario: Receptor sin soporte de recorrido
- **WHEN** se intenta publicar un híbrido con el receptor actual
- **THEN** se informa el requisito pendiente antes de escribir al inbox
- **AND** no se comunica publicación completa entre plataformas
