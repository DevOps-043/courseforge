## ADDED Requirements

### Requirement: Preparación como herramienta del editor
El editor SHALL ofrecer preparación y seguimiento editorial desde Herramientas, sin un bloque superior desplegable.

#### Scenario: Abrir campos de diapositivas
- **WHEN** se elige Campos de diapositivas en Herramientas
- **THEN** se muestran las acciones existentes en un diálogo accesible sin iniciar consultas ni escrituras automáticamente

### Requirement: Conservar límites con reloj correcto
El control de solicitudes SHALL utilizar un timestamp con zona para sus ventanas, conservando límites y permisos.

#### Scenario: Solicitudes de una ventana
- **WHEN** se supera el límite configurado para una clave
- **THEN** se rechazan solicitudes adicionales y otra clave conserva su ventana independiente

### Requirement: Error previo al envío diagnosticable
La preparación SHALL conservar una referencia de solicitud segura ante un error HTTP previo al envío y no reinterpretarlo como incumplimiento del deck.

#### Scenario: Dependencia no disponible
- **WHEN** falla la comprobación inicial con 503
- **THEN** no se envía el lote ni se crea un recibo ficticio y la interfaz muestra indisponibilidad con referencia segura

### Requirement: Identidad basada en JSON persistible
El hash SHALL conservarse al serializar y recuperar el documento desde JSONB.

#### Scenario: Opcionales narrativos undefined
- **WHEN** el generador produce opcionales undefined
- **THEN** no forman parte del hash del JSON persistido

#### Scenario: Pin histórico con la firma exacta conocida
- **WHEN** una inicialización explícita reconoce el defecto narrativo y no existen campos vinculados
- **THEN** guarda una nueva versión mediante CAS y conserva el documento histórico

#### Scenario: Pin no explicado
- **WHEN** la firma histórica no coincide exactamente
- **THEN** rechaza la recuperación automática sin escribir una versión
