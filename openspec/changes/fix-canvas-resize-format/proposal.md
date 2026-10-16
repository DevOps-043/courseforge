# Recuperar redimensionamiento y cambio de formato

## Why
Se reportan elementos que no cambian de tamaño y un selector de formato bloqueado hasta recargar. Se necesita reproducción local antes de atribuir una causa al incidente real.

## What Changes
- Reproducir arrastres para agrandar/reducir antes y después de cambiar orientación.
- Corregir el cierre externo que se pierde al minificar y serializar el solver de snap.
- Corregir errores confirmados en el runtime del preview.
- Limitar la espera de guardado y documentar su resultado incierto y recuperación.

## Capabilities
### New Capabilities
- `canvas-resize-format`: geometría y continuidad del editor al cambiar orientación.

## Impact
Editor de composición y pruebas locales. Sin migraciones ni cambios de proveedor o permisos.
