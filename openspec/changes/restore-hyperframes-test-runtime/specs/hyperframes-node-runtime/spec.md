## ADDED Requirements

### Requirement: Dependencias ejecutables en Node compilado
El adaptador del proveedor de composición SHALL cargar su transporte interno en
el árbol CommonJS emitido por tsc y en Next, conservando el mismo lector limitado.

#### Scenario: Ejecución de prueba de modelos
- **WHEN** Node ejecuta composition-agent-model-output.test.js tras compilar
- **THEN** resuelve el transporte interno y ejecuta los asserts existentes

#### Scenario: Suite completa
- **WHEN** se ejecuta test:hyperframes
- **THEN** la carga del adaptador no interrumpe los comandos posteriores
- **AND** se conservan los códigos de salida de cualquier fallo de producto
