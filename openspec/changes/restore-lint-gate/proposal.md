# Restaurar compuerta lint — F0.2 / TD-08

## Why
ESLint termina por configuración antes de comprobar el producto: los overrides
globales usan plugins del preset Next cuyo selector no incluye CommonJS.

## What Changes
- Registrar los plugins existentes del preset para todos los overrides globales.
- Comprobar TypeScript, módulos y CommonJS con canarios de error y warning.
- Inventariar warnings existentes y rechazar incrementos por archivo/regla.
- Registrar diferencias entre dependencias instaladas, instalación limpia y CI.

## Impact
Configuración y scripts locales de calidad; sin cambios en permisos, APIs o BD.
No se relajan reglas ni se omiten archivos del gate para obtener aprobación.
El objetivo completo sigue el plan principal; F1.3.c.3.c sigue pendiente.
