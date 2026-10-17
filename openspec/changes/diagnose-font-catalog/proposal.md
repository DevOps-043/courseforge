# Diagnóstico del catálogo de fuentes

## Why
El inspector muestra «No se pudieron cargar las fuentes. Puedes continuar con las fuentes incluidas». Se necesita identificar el origen sin modificar datos remotos.

## What Changes
- Registrar evidencia del endpoint, el consumidor y la definición de la tabla remota.
- Identificar la migración existente que aporta el contrato requerido.
- Preparar verificaciones SQL de solo lectura antes y después de una aplicación autorizada.

## Capabilities
### New Capabilities
Ninguna: investigación operativa; no cambia el contrato del producto.

## Impact
Solo documentación y consultas de diagnóstico locales. La aplicación de SQL remoto queda fuera de esta investigación.
