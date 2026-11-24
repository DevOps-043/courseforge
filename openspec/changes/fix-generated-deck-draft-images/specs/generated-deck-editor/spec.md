## ADDED Requirements

### Requirement: Proyección de imágenes verificadas
El lector editorial SHALL proyectar la presentación para el editor permitiendo
únicamente las URLs exactas de imágenes que ya superaron la comprobación del
registro tenant/componente, ruta, checksum e integridad del deck.

#### Scenario: Deck con imágenes válidas
- **WHEN** la preparación narrativa procesa un deck de imágenes verificadas
- **THEN** puede construir su documento inicial sin rechazar esas URLs legítimas

#### Scenario: Imagen o URL manipulada
- **WHEN** cambia una URL del spec o falta el registro de la imagen
- **THEN** la lectura se rechaza sin fallback y no se amplían permisos de dominio

### Requirement: Diagnóstico editorial seguro
La ruta SHALL distinguir errores editoriales conocidos de errores internos sin
exponer datos privados y SHALL conservar correlación y semántica de reintento.

#### Scenario: Integridad rechazada
- **WHEN** falla la comprobación editorial del deck
- **THEN** responde 422 con motivo seguro y sin reintento automático

#### Scenario: Dependencia no disponible
- **WHEN** el lector editorial no puede verificar temporalmente el recurso
- **THEN** responde 503 reintentable con identificador de solicitud
