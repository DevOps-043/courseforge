## ADDED Requirements

### Requirement: Perfil HTML con campos de texto
El sistema SHALL ofrecer un perfil html-text que conserve recursos embebidos validados y sustituya textos sin convertir el diseño al editor nativo.

#### Scenario: Preview y guardado fieles
- **WHEN** se importa una plantilla html-text dentro de presupuestos
- **THEN** se deduplican sus recursos, se revisa el diseño con ellos y se guardan una sola vez en el ZIP privado

#### Scenario: Recurso inseguro o excesivo
- **WHEN** un recurso tiene MIME/binario incompatible, referencia no declarada o excede el presupuesto
- **THEN** se rechaza explícitamente sin ejecutar código ni eliminar silenciosamente partes del diseño

#### Scenario: Lectura aislada por organización
- **WHEN** se revisa o genera una plantilla guardada
- **THEN** se comprueban organización, path, hash del ZIP y manifiesto antes de hidratar sus recursos

#### Scenario: Animaciones no soportadas
- **WHEN** se revisa un diseño importado
- **THEN** se informa que su perfil es estático y no se ejecutan scripts o animaciones externas
