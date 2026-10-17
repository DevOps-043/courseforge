# Validación del layout de captions

## Causa y corrección

`renderTextStyle` configura un flex en columna para alinear verticalmente el texto.
Los captions sin efectos colocaban cada span de palabra como hijo directo de ese
flex. Cada palabra se convertía en un elemento de columna; aumentar el ancho no
podía cambiar su disposición.

La corrección agrega un bloque de párrafo dentro del flex, dejando las palabras
en flujo inline. Conserva alineación, padding, fondo, saltos de línea, Unicode,
escapes, IDs, timestamps y resaltado por palabra. La rama con efectos ya disponía
de un bloque interior equivalente y no se modifica. No se cambia el documento ni
se requiere SQL.

## Evidencia primaria

- Antes del cambio, con 1000 px de ancho: las palabras `Este`, `diálogo`, `debe`,
  `leerse`, `horizontalmente` tenían X=36 y valores de Y=45.03125, 80.21875,
  115.40625, 150.59375 y 185.78125. Cinco palabras en cinco filas.
- La regresión visual falló en la línea base: «El diálogo ancho debe quedar en
  una sola línea», resultado `5 !== 1`.
- Después del cambio, las cinco palabras comparten Y=217.40625 y sus posiciones X
  avanzan horizontalmente. Se comprobó wrapping con 360 px, expansión a 1000 px,
  resaltado al retroceder/avanzar y paridad exacta de posiciones y opacidades entre
  preview y HTML de render, tanto sin efectos como con efectos de entrada/karaoke.
- [Coordenadas observadas](geometry.json) y [captura corregida](caption-paragraph.png).

## Pruebas ejecutadas

- Compilación `tsc -p apps/web/tsconfig.hyperframes-test.json`: código 0.
- Pruebas de native-overlay, caption-effects, text-presentation y transcript-caption:
  33 pruebas aprobadas, código 0.
- `run-composition-caption-layout-smoke.js` en Chromium aislado: código 0.
  Se corrigió un error del propio test: la enumeración comenzaba por render y
  comparaba contra un preview todavía no capturado; ahora el orden es explícito.
- `npm run test:remotion --workspace=apps/web`: código 0.
- Comprobación completa de tipos web (`tsc -p apps/web/tsconfig.json --noEmit --pretty false`): código 0.
- ESLint focalizado del renderer y la prueba visual: código 0.
- `npm run docs:check` y `git diff --check`: código 0.
- `npm run verify:pr`: código 1. Adaptadores, estructura del arnés y documentación
  pasan; la compuerta se detiene porque no está disponible el ejecutable local
  `openspec`. No se debilitó la compuerta.
- Suite HyperFrames: el comando inicial se interrumpió durante la compilación
  restringida. Tras compilar correctamente se ejecutaron, en el mismo orden, los
  módulos del script `test:hyperframes`. La suite se detuvo con código 1 en
  `composition-agent-model-output.test.js`: no resuelve
  `@/lib/server/outbound-http` (MODULE_NOT_FOUND). No se cambió ese módulo ni
  se declara aprobada la suite completa. La regresión de captions se ejecutó por
  separado y pasó.

## Revisión propia y límites

Diff de producto limitado al renderer compartido; la prueba visual verifica la
posición de cada palabra, no solamente la presencia de un fragmento HTML. Los
tests existentes cubren CJK, RTL, puntuación, escapes y timing. No se tocaron
autorización, APIs, fuentes, assets ni contratos del proveedor.

La ejecución inicial de QA se interrumpió por timeout; su repetición final pasó.
Algunas comprobaciones restringidas quedaron pendientes y se interrumpieron para
repetirlas sin esas restricciones; no se contabilizan como aprobadas.

QA realizada con fuentes incluidas y fixtures locales, sin modificar el curso
reportado, publicar cambios o invocar un render cloud. No se afirma certificación
del proveedor remoto. La corrección se aplica al recompilar desde el documento;
no reescribe snapshots HTML históricos, que conservan su contenido inmutable.
Para esos casos debe generarse una revisión nueva después del despliegue.
Un párrafo excesivamente largo todavía puede exceder la
altura disponible: se conserva el tamaño de letra y clipping configurados por el
usuario, sin introducir ajuste automático de fuente.

Trabajo desarrollado en un worktree local aislado desde `8abbe565` y trasladado
al checkout de entrega en `codex/fix-caption-paragraph-layout`; se preservó el
informe pendiente de fuentes. Rollback: revertir este diff, sin cambios de datos.
