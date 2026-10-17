# Presets de animación específicos para captions

## Why
Los captions necesitan lectura estable y seguimiento de voz; los movimientos genéricos de assets no cubren este propósito. Se requieren presets Educativo, Lectura guiada y Social con resaltado de fondo sincronizado.

## What Changes
- Catálogo de presets de animación independiente de los presets visuales existentes.
- Modo BACKGROUND de karaoke con colores validados y restauración de énfasis estático.
- Selector de preset de capa y controles de fondo activo, conservando personalizaciones por frase.
- Pruebas de compatibilidad, seek inverso, posiciones y paridad preview/render.

## Capabilities
### New Capabilities
- `caption-animation-presets`: configuración de lectura educativa y social.

## Impact
Contrato aditivo de efectos de captions, proyección/timeline compartida, renderer y UI del inspector. Sin SQL, proveedor ni cambios de texto/timestamps. Trabajo en rama/carpeta actuales por instrucción del usuario.
