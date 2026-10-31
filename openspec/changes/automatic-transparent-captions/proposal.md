# Subtítulos transparentes automáticos

## Why
El editor genera capas transparentes desde timestamps, pero la automatización solo solicita captions al proveedor del avatar. Se necesita una capa nativa editable sin intervención por frase.

## What Changes
- Opción explícita `nativeCaptions` general y por componente, independiente de `avatar.caption`.
- Tras disponer de assets, el refresco de una ejecución aprobada prepara el borrador y crea captions desde la voz por escena.
- Creación idempotente, persistencia con hash y protección de cualquier caption existente o eliminado por el usuario.
- Estado visible cuando faltan tiempos, hay conflicto o se requiere revisión; no presentar el item como listo.

## Capabilities
### New Capabilities
- `automatic-transparent-captions`: generación de capas nativas transparentes durante producción.

## Impact
Configuración HTTP/UI, refresco de producción y servicios de composición. Sin SQL, cambio de proveedor ni generación pagada nueva. No incorpora transcripción arbitraria, render o publicación.
