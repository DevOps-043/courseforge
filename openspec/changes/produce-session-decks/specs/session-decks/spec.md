## ADDED Requirements

### Requirement: Producción visual de cada sesión
El sistema SHALL producir y guardar desde Producción un deck visual de los materiales síncronos aprobados usando el renderer y QA compartidos con Academy.

#### Scenario: Producción y recarga
- **WHEN** un autor produce el deck de una sesión vigente
- **THEN** se guarda el asset y QA; la recarga lo recupera y el reintento no crea duplicados

#### Scenario: Contenido reservado
- **WHEN** se produce o descarga la presentación
- **THEN** no contiene notas, soluciones ni preparación reservadas al facilitador

### Requirement: Integridad, autorización y QA
El sistema SHALL verificar acceso por curso y organización, vigencia y aprobación antes de producir, mostrar o descargar; SHALL conservar los errores bloqueantes del QA visual.

#### Scenario: Error de QA
- **WHEN** el contenido no supera QA
- **THEN** se muestra el diagnóstico y se bloquea utilizar o descargar el deck hasta corregir los materiales

#### Scenario: Cambio posterior
- **WHEN** cambian materiales, aprobación o entradas del curso
- **THEN** el asset previo no aparece como vigente ni se sirve por su identificador anterior

#### Scenario: Sesión ajena o manipulación
- **WHEN** se consulta una sesión de otro curso o se manipula el HTML guardado
- **THEN** no se devuelve contenido no autorizado ni HTML manipulado
