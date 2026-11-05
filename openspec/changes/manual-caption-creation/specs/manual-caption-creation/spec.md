## ADDED Requirements

### Requirement: Autoría manual de subtítulos
El editor SHALL permitir crear y editar subtítulos sin voz ni generación automática.

#### Scenario: Crear sin transcripción
- **WHEN** el autor abre Subtítulos y pulsa Crear subtítulos manuales sin voces disponibles
- **THEN** se crea una capa NATIVE_CAPTIONS con origen MANUAL y fondo transparente
- **AND** se abre su edición sin llamar a generación desde voz.

#### Scenario: Escribir varias frases
- **WHEN** el autor edita el primer subtítulo y agrega otro
- **THEN** puede escribir texto y tiempos válidos sin acortar primero la frase inicial
- **AND** se conservan las frases al guardar y recargar el documento.

#### Scenario: Generación opcional
- **WHEN** se abre la pestaña o se crea una capa manual
- **THEN** no se reemplazan subtítulos existentes ni se activa la generación automática.

#### Scenario: Restricciones de edición
- **WHEN** la pista está bloqueada o los tiempos son inválidos
- **THEN** la edición se deshabilita o se rechaza sin guardar un documento inválido.
