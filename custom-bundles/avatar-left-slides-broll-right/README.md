# Avatar fijo izquierda con diapositiva y B-roll derecha

Plantilla externa Remotion para SofLIA - Engine.

## Layout

- Avatar fijo en todo el lado izquierdo, centrado vertical y horizontalmente.
- Diapositiva en el lado derecho.
- Cuando existe B-roll para la diapositiva activa, la diapositiva queda arriba y el B-roll abajo a la derecha.
- Cuando no existe B-roll para la diapositiva activa, su caja se omite sin cambiar la geometria de las demas capas.
- No se renderiza texto, subtitulos, titulos, etiquetas ni barra de progreso.

## Timeline

La duracion total se toma de `totalDurationInFrames`. Las diapositivas se reparten en segmentos iguales:

`framesPorDiapositiva = totalDurationInFrames / totalDeDiapositivas`

El B-roll se consulta por indice de diapositiva. Si `brollClips[index]` existe, se muestra junto con la diapositiva. Si no existe, se omite sin modificar el tiempo de las diapositivas.

## Contrato de layout v2

El manifest declara `layoutContractVersion: 2`, `layoutCoordinateSpace: "canvas"` y `editableLayers`. Todas las cajas y todos los `layoutOverrides` usan pixeles globales del canvas, nunca coordenadas relativas a un contenedor interno:

- `avatar`: x 0, y 0, width 806, height 1080.
- `primaryVisual`: x 806, y 0, width 1114, height 1080.
- `slides`: x 842, y 36, width 1042, height 626.
- `broll`: x 1364, y 752, width 520, height 292.

El source renderiza cada capa como hija directa de `AbsoluteFill`. El orden base es `primaryVisual` (0), `avatar` (10), `slides` (20) y `broll` (30). Las capas multimedia aceptan `stack` y usan fondos transparentes para no ocultar contenido inferior.

Las capas `slides` y `broll` declaran los patrones `slide:{index}` y `broll:{order}`. El editor los expande segun los assets recibidos y el source aplica primero el ajuste grupal y despues el ajuste del elemento activo.

No se deben envolver estas capas en grids o paneles posicionados. Hacerlo cambiaria el origen de `x/y` y romperia la correspondencia entre el editor, el preview y el render final.

## Archivos

- `courseforge-remotion-template.json`: manifiesto requerido por Courseforge.
- `src/index.tsx`: root Remotion compilable con `registerRoot` y la composicion visual.
- `package.json`: dependencias permitidas.
