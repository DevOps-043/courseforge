# Captions sincronizados como párrafo

## Why
Las palabras sincronizadas sin efectos quedan como hijos directos de un flex en columna; ampliar el caption no elimina la columna de palabras.

## What Changes
- Separar la alineación vertical del contenedor y el flujo inline de sus palabras.
- Conservar texto, puntuación, IDs y tiempos para karaoke y seek.
- Verificar en navegador la posición de cada palabra, wrapping y paridad preview/render.

## Capabilities
### New Capabilities
- `caption-paragraph-layout`: flujo horizontal de captions sincronizados.

## Impact
Renderer compartido de overlays nativos y pruebas. Sin cambios de documento, SQL, APIs o proveedor.
