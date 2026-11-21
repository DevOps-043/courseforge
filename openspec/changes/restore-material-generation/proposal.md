## Why

En las ejecuciones híbridas observadas, las respuestas de IA llegaban a la revisión de respaldo y fallaban antes de generar un recibo o una versión consultable. El diagnóstico genérico ocultaba la diferencia entre un rechazo de contenido, una cita incorrecta y un fallo de escritura.

## What Changes

- Alinear las instrucciones de generación y revisión documental para materiales síncronos y asíncronos.
- Permitir una corrección acotada y volver a validar el resultado completo antes de guardarlo.
- Conservar los materiales e historial existentes y mostrar un diagnóstico seguro cuando una unidad no pueda confirmarse.

## Capabilities

### New Capabilities

- `material-generation-recovery`: generación documental, revisión y confirmación de materiales por modalidad.

## Impact

Servicios de fuentes, worker de impartición, worker de materiales Nexus y pruebas de persistencia. Sin migración de base de datos.
