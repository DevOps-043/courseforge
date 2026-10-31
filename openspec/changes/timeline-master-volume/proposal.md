# Volumen maestro de toda la línea del tiempo

## Why
La composición permite ajustar pistas, clips y curvas, pero no su nivel global guardado.

## What Changes
- Control maestro 0–100% en la mezcla de la línea del tiempo.
- Campo opcional `audioMix.masterVolume` y edición mediante `audio-mix.update`.
- Ganancia multiplicativa sobre la mezcla final, compartida por preview, render y referencia de audio.
- Compatibilidad de documentos antiguos, undo y curvas/fades/ducking/crossfades.

## Capabilities
### New Capabilities
- `timeline-master-volume`: ajuste global persistente del audio.

## Impact
Contrato JSON y patch aditivos, proyección de audio, compilador compartido, controles y pruebas. Sin SQL, proveedor, publicación ni generación pagada.
