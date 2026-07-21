# Avatar fijo izquierda con diapositiva y B-roll derecha

Plantilla externa Remotion para SofLIA - Engine.

## Layout

- Avatar fijo en todo el lado izquierdo, centrado vertical y horizontalmente.
- Diapositiva en el lado derecho.
- Cuando existe B-roll para la diapositiva activa, la diapositiva queda arriba y el B-roll abajo a la derecha.
- Cuando no existe B-roll para la diapositiva activa, la diapositiva ocupa el lado derecho.
- No se renderiza texto, subtitulos, titulos, etiquetas ni barra de progreso.

## Timeline

La duracion total se toma de `totalDurationInFrames`. Las diapositivas se reparten en segmentos iguales:

`framesPorDiapositiva = totalDurationInFrames / totalDeDiapositivas`

El B-roll se consulta por indice de diapositiva. Si `brollClips[index]` existe, se muestra junto con la diapositiva. Si no existe, se omite sin modificar el tiempo de las diapositivas.

## Metadatos editables

El manifest declara `editableLayers` para que el editor de posiciones pueda iniciar desde las mismas cajas que usa la composicion:

- `avatar`: x 0, y 0, width 806, height 1080.
- `primaryVisual`: x 806, y 0, width 1114, height 1080.
- `slides`: x 842, y 36, width 1042, height 626.
- `broll`: x 1364, y 752, width 520, height 292.

Estas cajas estan expresadas en pixeles sobre canvas 1920x1080 y se aplican como posicion y tamano iniciales antes de cualquier `layoutOverrides`.

## Archivos

- `courseforge-remotion-template.json`: manifiesto requerido por Courseforge.
- `src/index.tsx`: root Remotion compilable con `registerRoot` y la composicion visual.
- `package.json`: dependencias permitidas.
