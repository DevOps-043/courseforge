# Recorte y descarga del clip seleccionado

## Why
El editor permite eliminar intervalos mediante marcas del cursor, pero no ofrece descarga individual. La UI también usa un mínimo de un frame distinto del mínimo de 50 ms del documento y puede seleccionar un fragmento derecho que no llegó a crearse cerca de un borde.

## What Changes
- Añadir controles explícitos del intervalo relativo al clip y reutilizar el patch existente.
- Corregir validación y selección posterior contra el documento guardado.
- Descargar el tramo fuente seleccionado como MP4 (video) o WAV (audio), con cancelación y límites locales. Esta descarga temporal no renderiza efectos del ensamble.

## Capabilities
### New Capabilities
- `selected-clip-export`: recorte temporal y descarga individual del medio seleccionado.

## Impact
UI y servicios cliente de producción. Sin migraciones, permisos nuevos ni envíos a proveedores.
