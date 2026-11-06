## ADDED Requirements

### Requirement: Configuración efectiva y deuda visible
Lint SHALL resolver plugins para todas las extensiones incluidas, conservar los
niveles de reglas existentes y rechazar errores o warnings nuevos por archivo/regla.

#### Scenario: Scripts CommonJS
- **WHEN** ESLint evalúa un archivo cjs junto con tsx y mjs
- **THEN** encuentra los plugins referenciados sin eliminar reglas

#### Scenario: Canario de error
- **WHEN** se introduce una infracción de regla bloqueante
- **THEN** el gate termina con código no cero

#### Scenario: Canario de warning
- **WHEN** un archivo incorpora más warnings de una regla que su baseline
- **THEN** el gate falla y conserva diagnóstico y reporte de warnings

#### Scenario: Sustitución de deuda sin variar cantidades
- **WHEN** se retira un warning y aparece otro de la misma regla en código distinto del mismo archivo
- **THEN** se rechaza por su nueva huella aunque la cantidad total no aumente
- **AND** un desplazamiento de línea del mismo código conserva su identidad

#### Scenario: Diferencias de entorno
- **WHEN** falta evidencia de instalación limpia o de Node 22
- **THEN** se registra pendiente sin certificar equivalencia ni cerrar TD-08

#### Scenario: Comprobación fría de tipos
- **WHEN** se ejecuta typecheck sin caché incremental bajo Node 22
- **THEN** conserva todas sus comprobaciones con un máximo explícito de heap de 4 GiB
- **AND** el OOM previo y los resultados del reintento se conservan por separado
