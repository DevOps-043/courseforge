# Audio editable con transiciones y zoom visual

## Why
Los audios admiten split y trim, pero el servicio de transiciones los rechaza y el zoom genérico no facilita seleccionar un punto preciso de la onda.

## What Changes
- Crossfade lineal entre audios adyacentes con handles de fuente verificados.
- Render y preview usan ventanas de audio extendidas sin animación visual.
- Ampliar el audio seleccionado y situar el cursor con Alt+clic en su onda; dividir con la herramienta existente.
- Zoom acotado, ruler con presupuesto de marcas y conservación del recorte/offset.

## Capabilities
### New Capabilities
- `audio-clip-editing`: crossfade y edición visual precisa de clips de audio.

## Impact
Servicios de transición, runtime, compilación y UI de timeline/transiciones. Sin SQL ni proveedores nuevos. Los cortes siguen siendo no destructivos y alineados a frames.
