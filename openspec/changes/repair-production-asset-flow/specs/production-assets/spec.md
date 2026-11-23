## ADDED Requirements

### Requirement: Contrato obligatorio de prompts audiovisuales
La generación SHALL enviar el esquema estricto de prompts al proveedor y conservar validación local y mínimo de tomas antes de guardar resultados.

#### Scenario: Respuesta sin prompts
- **WHEN** el proveedor devuelve un objeto sin el arreglo obligatorio
- **THEN** el componente conserva sus assets previos y muestra un diagnóstico de contrato; no guarda un resultado vacío como éxito

### Requirement: Seguimiento persistente de slides
La UI SHALL consultar el mismo job nuevo o reutilizado, recuperar su estado tras recargar y distinguir ausencia de trabajo de una cola real. Los workers SHALL reclamar el trabajo atómicamente antes del consumo.

#### Scenario: Recarga durante producción
- **WHEN** existe un trabajo pendiente para el componente
- **THEN** la UI recupera su identificador y consulta el estado sin crear otro trabajo

#### Scenario: Cola sin worker
- **WHEN** el usuario reintenta un job en cola por más de noventa segundos
- **THEN** una reserva atómica permite reenviar el mismo job; un worker activo o terminado no se vuelve a consumir ni se marca fallido por perder la confirmación HTTP

### Requirement: Revisión síncrona dentro del curso
La UI SHALL ofrecer sesiones desplegables y vistas por audiencia dentro de Producción. Las exportaciones SHALL permanecer opcionales y conservar los controles de acceso y aprobación.

#### Scenario: Vista del participante
- **WHEN** el autor selecciona material del participante
- **THEN** la vista omite notas del facilitador, soluciones e instrumentos reservados
