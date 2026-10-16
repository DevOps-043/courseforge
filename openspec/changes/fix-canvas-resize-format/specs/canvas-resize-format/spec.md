## ADDED Requirements

### Requirement: Redimensionamiento después de cambiar orientación
El editor SHALL calcular el arrastre con las dimensiones vigentes del lienzo y permitir agrandar y reducir elementos visibles sin excepciones del runtime.

#### Scenario: Cambio de ida y vuelta
- **WHEN** el usuario cambia de horizontal a vertical y vuelve a horizontal
- **THEN** cada arrastre usa la escala vigente y conserva operativos los controles.

### Requirement: Geometría serializada independiente del minificador
El runtime SHALL conservar sus dependencias al serializarse desde el módulo minificado del servidor.

#### Scenario: Snap en staging
- **WHEN** el servidor minifica y serializa el solver de geometría
- **THEN** el iframe puede calcular el tamaño y snap sin referencias externas indefinidas.

### Requirement: Guardado con espera acotada
El editor SHALL terminar la espera de la petición y lectura de respuesta en 30 segundos y conservar el estado recuperable si el resultado remoto es incierto.

#### Scenario: Guardado sin respuesta
- **WHEN** vence el límite de espera del PUT
- **THEN** la cola vuelve a reposo y se informa que el servidor podría haber completado la escritura, sin reintento automático.
