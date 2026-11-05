## ADDED Requirements

### Requirement: Hallazgos trazables
El registro SHALL conservar ID estable, estándar, evidencia, impacto, incertidumbre,
prioridad, esfuerzo, aceptación y dependencias para cada hallazgo del corte.

#### Scenario: Riesgo dependiente del ambiente
- **WHEN** el código demuestra un patrón pero falta configuración productiva
- **THEN** el registro separa el hecho local de la hipótesis de exposición
- **AND** no declara un incidente ni un cierre productivo

### Requirement: Progreso verificable
El seguimiento SHALL conservar la línea base y separar descubrimientos posteriores.

#### Scenario: Cierre de un hallazgo
- **WHEN** se solicita cerrar un hallazgo
- **THEN** se registra fecha, cambio, comando y resultado que cumplen la aceptación
- **AND** los pendientes de auditoría permanecen visibles

### Requirement: Alcance autorizado
La auditoría SHALL limitar sus mutaciones a documentación y evidencia local.

#### Scenario: Validación que requiere producción
- **WHEN** una comprobación requiere secretos, migración remota o efecto externo
- **THEN** se registra el procedimiento pendiente sin ejecutarlo en esta fase

### Requirement: Correcciones divididas por contexto
El plan SHALL dividir fases en unidades con entrada mínima, dependencias explícitas,
frontera de cambios y criterio de salida, conservando la aceptación del hallazgo.

#### Scenario: Una corrección excede el contexto disponible
- **WHEN** una unidad necesita más investigación o dominios de los que pueden verificarse en la sesión
- **THEN** se divide en subunidades y se guarda un registro de continuidad
- **AND** no se acredita cierre por terminar un chat o escribir el plan

### Requirement: Continuidad verificable
Cada unidad SHALL conservar su estado en el OpenSpec de corrección con HEAD,
diff pendiente, decisiones, comandos/resultados, límites y siguiente acción.

#### Scenario: Retomar en otro chat o después de compactar
- **WHEN** se retoma una unidad
- **THEN** se contrastan Git y fuentes con el registro de continuidad antes de editar
- **AND** la evidencia extensa se consulta desde archivos sin depender de memoria conversacional
