# Evidencia: motion en el canvas del video

Fecha: 2026-10-31. Entorno local Windows, checkout principal. Al inicio el árbol
estaba limpio. No se crearon worktrees ni se ejecutaron servicios pagados.

## Cambio y causa

El sujeto GSAP ya se mueve/escalaba dentro del documento del video, pero su padre
de layout `.clip-content` recortaba el contenido a la caja original del asset.
Se cambió su overflow a visible en el compilador compartido. El recorte final
permanece en `#composition-root`; crop y máscaras permanecen sobre el contenido
que se anima. No cambian el JSON persistido, recorridos, keyframes, tiempos,
origen de transformación, profundidad ni selección. Sin SQL ni dependencias.

La ampliación no convierte un recorrido corto guardado en una entrada desde
fuera del video ni cambia ejes locales de un clip rotado. Corrige el límite de
visibilidad, conservando la animación que el usuario ya configuró.

## QA ejecutada

- `qa:composition-video-canvas-motion` del workspace web: código 0, incluyendo
  TypeScript y Chromium headless con perfil temporal aislado. Se necesitaron
  permisos de ejecución fuera del entorno restringido para lanzar/cerrar el
  navegador; no se usaron perfiles ni sesiones personales.
- 19 presets × 2 targets: 38 variantes con comparación exacta de píxeles entre
  preview y HTML de render y comprobación de seek inverso. Los presets de
  posición, pop, pulso y balanceo pintan fuera de la caja estática original.
- Control negativo en ambos targets: restaurar `overflow: hidden` elimina los
  píxeles fuera del asset y reproduce el defecto original.
- Crop y máscara circular viajan con la imagen en ambos targets, sin perder su
  recorte. Con viewport mayor al video, el contenido que cruza el borde del
  canvas se recorta y la fracción interior sigue visible.
- [Resultados de píxeles](pixels.json), [preview](preview.png),
  [HTML de render](render.png). Las capturas usan una imagen roja de prueba;
  el asset original ocupa x=180..260, mientras la imagen animada aparece en
  x=335..415: la caja del asset ya no impide verla.
- `npm run test:remotion --workspace=apps/web`: código 0.
- ESLint focalizado de compilador y QA: código 0, sin salida de errores/warnings.
- OpenSpec focalizado: código 0.
- `npm run verify:pr`: código 1; adaptadores, arnés y docs pasan. Este cambio es
  válido, pero el cambio existente `diagnose-font-catalog` carece de deltas.
- `npm run test:hyperframes --workspace=apps/web`: código 1 por el alias existente
  `@/lib/server/outbound-http` en `composition-agent-model-output.test.js`.
- Regresión focalizada de compilador, motion y máscaras: 53 pruebas aprobadas y
  una fallida. El test de variables remotas espera el nombre histórico
  `SofLIA - Engine remote asset`, pero el compilador usa `APP_CONFIG.name` y
  produce `SofLIA Architect remote asset`. Esa lógica no fue modificada. No se
  cambió el test ni el branding para ocultar la discrepancia.
- Control de línea base de esa prueba: al restaurar únicamente el CSS anterior
  en memoria, el mismo test sigue fallando por el nombre de marca (código 1).
  La copia de control está en `.tmp/video-canvas-motion-baseline.cjs`; no se
  revirtió ni modificó el trabajo del checkout para ejecutarla.
- Documentación final: código 0, 212 documentos comprobados.
- `git diff --cached --check`: código 0, incluidos los archivos nuevos.

## Revisión propia, límites y reversión

La región animada conserva el mismo stacking context/z-index y no introduce
selectores ni scripts nuevos en el documento. La selección sigue en el layout
estático. El recorte explícito de medios y el viewport interno de slides/texto
permanecen; no se amplía su contenido ni se levanta su máscara. En crop mode,
los controles y la sombra pueden salir de la caja del asset, pero el canvas los
limita y no se exportan controles editoriales.

La QA visual usa una imagen local; las regresiones de compilador/máscara cubren
otros medios a nivel de HTML. No es una observación de un render cloud/MP4 ni de
un curso real. Tampoco certifica todas las combinaciones de transiciones,
HTML controlado, múltiples animaciones y clips rotados. Revisión del mismo
agente que implementó el cambio, sin afirmar independencia.

Reversión: restaurar el overflow previo del contenedor. No hay datos ni
migraciones que revertir; mantener el recorte del canvas en cualquier versión.
