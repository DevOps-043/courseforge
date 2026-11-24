## ADDED Requirements

### Requirement: Conservar el editor durante actualizaciones del listado
El estudio SHALL permanecer montado cuando se refresquen los datos de materiales o se reciba el mismo alcance de Academy con otra identidad de arreglo.

#### Scenario: Actualización equivalente
- **WHEN** se consulta otra vez la lista con las mismas lecciones
- **THEN** el editor permanece visible y la preparación no se reinicia

#### Scenario: Error transitorio
- **WHEN** falla una actualización después de abrir el editor
- **THEN** se conserva la lista y se ofrece reintento sin perder el estudio

### Requirement: Vincular imágenes editoriales verificadas
La inicialización SHALL recuperar vínculos ausentes únicamente desde el artefacto reconstruido y verificado del tenant/componente, conservándolos al limpiar medios obsoletos.

#### Scenario: Borrador con imágenes sin vínculos
- **WHEN** el documento referencia imágenes presentes en el artefacto verificado
- **THEN** se vinculan idempotentemente antes de abrir el preview sin modificar el documento

#### Scenario: Referencia manipulada
- **WHEN** falta respaldo de registro, hash o tenant para una dependencia
- **THEN** se rechaza la preparación y no se concede ese vínculo

### Requirement: Monitor disponible sin aviso extenso
Ensamble SHALL mostrar el estudio sin el aviso superior extenso de Academy.

#### Scenario: Curso híbrido
- **WHEN** se abre Ensamble
- **THEN** el aviso no desplaza el monitor ni la timeline
