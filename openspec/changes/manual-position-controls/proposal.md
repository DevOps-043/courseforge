# Posición manual desde el panel de ajustes

## Why
Los clips visuales necesitan controles de posición accesibles desde propiedades. El inspector general omite X/Y; texto y subtítulos sólo ofrecen campos numéricos.

## What Changes
- Compartir controles X/Y con deslizador horizontal y entrada numérica en píxeles.
- Derivar rangos del lienzo, conservar posiciones negativas y respetar el esquema actual.
- Reutilizar el guardado de `clip.layout` y bloquear controles durante restricciones de edición.

## Capabilities
### New Capabilities
- `manual-position`: edición de posición desde propiedades.

## Impact
Sólo UI del editor nativo. Sin nuevas APIs, migraciones, dependencias ni cambios de autorización o render.
