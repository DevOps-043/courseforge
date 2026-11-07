# Guardar presets fieles a la edición confirmada

## Why
Se reporta un preset guardado incorrectamente que sí modifica los medios al
aplicarlo. La inspección confirma captura sin flush previo, errores de creación
ocultos al formulario y pérdida de parámetros añadidos al documento.

## What Changes
- Capturar después de confirmar las ediciones pendientes, en ambos modos.
- Conservar el formulario en errores y mostrar diagnósticos de captura.
- Leer V1 y escribir V2 con pistas/tipos separados, timing irregular, color,
  fades, capas ampliadas, motion personalizado, estilos nativos y mezcla completa.
- Mantener fuentes y contenido del destino y advertir sobre datos no portables.

## Capabilities
### New Capabilities
- `composition-preset-capture`: captura y aplicación fiel, compatible y verificable.

## Impact
Contrato de presets, extracción/aplicación compartidas, almacenamiento existente,
controlador y panel del editor. Sin SQL remoto, generación pagada ni despliegue.
