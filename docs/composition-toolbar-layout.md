# Barra y menús del preview

La barra responde al ancho del preview mediante container queries. Por debajo de
50rem, identidad y utilidades ocupan la primera fila y las herramientas la segunda.
Los grupos pueden pasar a otra línea sin comprimir ni superponer botones cuando
se abre el inspector. El preview conserva su recorte para contener el video.

Herramientas e Historial usan `popover="manual"` y la capa superior nativa del
navegador. Permanecen en el árbol DOM del editor para conservar estilos heredados,
el cierre por clic exterior y el manejo existente de teclado. El hook
`useCompositionAnchoredPopover` solo controla presentación y posición: limita
el menú al viewport, elige espacio arriba o abajo y actualiza el anclaje ante
resize, scroll y cambios del tamaño del contenedor. Requiere un navegador moderno
con Popover API y ResizeObserver. Los nuevos menús del monitor deben reutilizar
este hook y `useCompositionPanelFocus`.

## Validación

Desde `apps/web`, ejecutar `npm run qa:composition-toolbar-layout` con Chrome
instalado (o `CHROME_PATH` configurado). La fixture monta la barra real y su CSS,
sin servicios externos ni datos de cursos. Comprueba 1365, 1280, 1100, 1024, 768 y
390px con inspector abierto/cerrado: límites y solapamientos de botones, menú
visible mediante hit testing, autofocus, Escape, restauración de foco, navegación
con flechas, cierre por clic exterior y apertura del historial en la capa superior.

Completar manualmente en un artefacto real: abrir/cerrar inspector y biblioteca,
abrir herramientas sobre un video en reproducción, cambiar orientación del lienzo
y comprobar los menús en fullscreen. La fixture no valida reproducción, guardado,
ni integración con datos reales; estos flujos no se modifican con este cambio.
