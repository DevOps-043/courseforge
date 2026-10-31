# Animaciones visibles en el canvas del video

## Why
El contenedor de cada asset recorta su descendiente animado. Traslaciones, zoom,
pop, pulso o balanceo pueden desaparecer al rebasar el rectángulo estático del asset.

## What Changes
- El contenedor de layout permite desbordar al sujeto animado.
- El canvas del video conserva el recorte final; crop, máscaras y viewport interno del contenido se conservan.
- QA Chromium con píxeles reales, todos los presets, seek inverso y paridad preview/render.

## Capabilities
### New Capabilities
- `video-canvas-motion`: límite visual de motion en el canvas del video.

## Impact
CSS compartido del compilador de preview/render. Sin cambios de documento,
keyframes, recorridos, tiempos, origen de transformación, SQL ni proveedor.
