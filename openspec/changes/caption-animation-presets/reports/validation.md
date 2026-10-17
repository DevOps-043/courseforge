# Evidencia — presets de captions

## Resultado

Tres presets de animación en el inspector: Educativo (fundido de frase), Lectura
guiada (color activo) y Social (fondo activo con texto oscuro). Todos mantienen la
frase visible, sin pulso ni desplazamiento de palabra. Se conservan presets
visuales, tipografías, texto, tiempos, IDs, énfasis y personalizaciones por frase.
El selector explica que los overrides por frase prevalecen. Los cambios se guardan
mediante el flujo existente «Guardar texto» / contenido y estilo.

La selección manual de «Fondo resaltado» actualiza en un solo patch el modo y una
paleta inicial contrastada. Ambos colores se pueden editar después. No se
reescriben frases manuales/importadas; la generación desde voz ya agrupa hasta
cinco palabras. Sin timestamps alineados no se inventa resaltado por palabra.

## Validación ejecutada

- Compilación HyperFrames con TypeScript: código 0.
- Suite focalizada de presets, efectos, overlay y transcripciones: 35 pruebas,
  código 0. Incluye colores/propiedades inválidos, compatibilidad de forma V1,
  copias independientes del catálogo, aplicación por patch, restauración de
  énfasis estático, fallback, ausencia de alineación y seek inverso.
- QA Chromium del renderer: código 0. Se verificaron ORIGINAL, EFFECTS histórico
  y los tres presets, cada uno en preview y HTML de render (10 variantes).
  Coordenadas/opacidades/colores/fondos coinciden entre targets; wrapping a 360 px,
  expansión a 1000 px y seek inverso pasan. Social resalta únicamente la palabra
  activa. [Coordenadas](layout.json), [captura Social](social.png).
- La primera ejecución de esta QA detectó una expectativa incorrecta en el test:
  el fixture histórico EFFECTS usa SLIDE_UP y por diseño mueve la frase durante
  la entrada. La invariancia espacial se exige a ORIGINAL y a los presets nuevos;
  el fixture histórico sigue verificando wrapping, resize y seek reproducible.
- Fixture React local con el componente real y bundle esbuild: código 0. Se
  seleccionaron los tres presets, se contrastó el estado resultante con el
  contrato y se verificó preservación de texto/overrides y bloqueo disabled.
  [Resultado de UI](ui.json). Fixture temporal en `.tmp/caption-presets-ui`;
  no modifica el curso ni representa una prueba de persistencia remota.
- Comprobación completa de tipos web: código 0.
- ESLint focalizado de todos los archivos TypeScript/TSX afectados: código 0;
  se repitió sobre UI/QA después del ajuste final, también código 0.
- `npm run test:remotion --workspace=apps/web`: código 0.
- `npm run verify:pr`: código 1, se detiene en `openspec:validate` por ausencia del
  ejecutable local `openspec`. Adaptadores, arnés estructural y docs pasan.
- `npm run test:hyperframes --workspace=apps/web`: código 1 por
  `Cannot find module '@/lib/server/outbound-http'` en
  `composition-agent-model-output.test.js`. No se cambió ese módulo ni se ocultó
  el fallo; no se afirma aprobación de la suite completa.
- `git diff --check`: código 0.

## Compatibilidad, operación y revisión propia

Contrato aditivo: `BACKGROUND` y `activeBackgroundColor` opcional en efectos V1.
Parsear documentos anteriores no incorpora el nuevo campo ni cambia su hash por
esa adición. La proyección GSAP, runtime serializado, preview y render usan los
mismos settings y pasos; no se añade un segundo motor ni cálculo de layout por
frame. Los colores son hexadecimales estrictos; no se aceptan CSS ni callbacks.
Se mantienen límites de targets, permisos, tracks bloqueados y feature flag.

Desplegar servidor/lector/compilador/UI juntos. Un lector anterior no reconoce el
nuevo enum: después de guardar BACKGROUND no degradar a ese lector. El rollback
seguro de UX es retirar el selector manteniendo el lector nuevo, o convertir
explícitamente las capas afectadas mediante patches autorizados, sin reescribir
historial. No hubo migraciones ni aplicación de SQL. Los snapshots históricos
son inmutables y requieren una nueva revisión para cambiar de apariencia.

La revisión fue realizada por el mismo agente, no es independiente. No se
publicó ni desplegó, no se ejecutó render cloud y no se editó el curso del usuario.
Los resultados visuales corresponden a fixtures locales con fuentes incluidas;
no certifican un beneficio de retención/aprendizaje. El preset no impone límites
de líneas ni recalcula tamaño de letra sobre texto manual excesivamente largo.

Se trabajó en la rama/carpeta actuales (`staging`), sin crear ramas ni worktrees,
respetando la compatibilidad solicitada con Antigravity.
