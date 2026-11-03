# Creación manual de subtítulos — 2026-11-03

## Causa y solución

La creación manual estaba bajo Texto con la etiqueta «Captions transparentes»,
junto a «Generar desde la voz». El inspector usaba términos caption/cue y la
frase inicial ocupaba toda la capa: Agregar caption fallaba hasta ajustar el fin
de esa frase. No se encontró un requisito de voz en la creación manual existente.

Ahora la biblioteca tiene una pestaña **Subtítulos** con la acción principal
**Crear subtítulos manuales**. Texto conserva las capas de texto; generar desde
voz queda dentro de una opción desplegable explícita. Crear manualmente no
invoca generación ni reemplaza capas existentes.

La factory crea `NATIVE_CAPTIONS` con `origin: MANUAL`, fondo transparente y primera
frase de hasta dos segundos dentro de la capa. Se centraliza este intervalo para
la creación y las frases siguientes. Las capas nuevas tienen hasta cinco segundos
según el espacio disponible; las cortas pueden requerir ampliar su duración para
seguir añadiendo frases. El error explica esa alternativa.

Tras confirmar el patch, la integración nativa selecciona la capa, abre Propiedades
y sitúa el cursor en su inicio. Para CAPTION, la edición de frases aparece antes
de la geometría. Los campos y acciones usan «subtítulo» en español. La pestaña
conserva su texto en bibliotecas estrechas ocultando su icono cuando hace falta.

No cambia esquema, API, SQL, proveedor, permisos ni el canal de guardado. No se
reescriben documentos históricos ni se deshabilita la automatización de producción
que otra configuración haya habilitado explícitamente.

## Verificación ejecutada

| Comando / alcance | Resultado |
| --- | --- |
| `npx tsc -p apps/web/tsconfig.hyperframes-test.json --pretty false` | Exit 0. |
| `npm run typecheck` | Exit 0 en la implementación final. |
| ESLint dirigido a los ocho archivos TS/TSX modificados, desde `apps/web` | Exit 0, sin relajar reglas. |
| `node --test` sobre composition-native-overlay, composition-caption-import.service y composition-interaction-autosave compilados | 27/27 aprobadas. |
| `node --test` sobre composition-transcript-caption.service y composition-automatic-captions compilados | 23/23 aprobadas; conserva protección de capas manuales y generación optativa. |
| `node apps/web/tools/qa/composition-manual-captions.smoke.cjs` desde raíz | Exit 0 en Chromium headless con CSS real. |
| `npm run docs:check` | Exit 0; 239 documentos verificados antes de añadir este reporte. |
| `openspec validate manual-caption-creation --strict --no-interactive` | Exit 0. |
| `git diff --check` del alcance | Exit 0. |
| `npm run verify:pr` | Exit 1 por diagnose-font-catalog sin deltas, ajeno al cambio. Adaptadores, arnés y enlaces pasan; este cambio OpenSpec valida. No alcanzó la cadena de producto posterior. |

La QA monta biblioteca, panel de creación, inspector, factory, esquemas y reducer
reales. Comprueba la pestaña sin solapes en anchos de biblioteca de 232, 264 y
336 px, con Guion presente; creación sin voz; escritura de dos frases; tiempos
0–2 y 2–4 s; guardado; recarga del JSON persistido en memoria; rechazo de tiempos
solapados; pista bloqueada; escape de texto en HTML de preview y render; contador
de generación en cero. No requiere redes externas: la consulta de fuentes recibe
una respuesta sintética vacía. Los logs acompañan el reporte.

La primera revisión automática de permisos no pudo autorizar el navegador por
límite de uso y no ejecutó la acción. Tras reanudar, la ejecución autorizada pudo
completarse. Los primeros fixtures fallaron porque el canvas sintético no fijaba
la duración de 12 s y un evento usaba el setter de input sobre textarea; se
corrigieron los datos/eventos del fixture, sin relajar aserciones del producto.

## Revisión y límites

Revisión del mismo agente, no independiente. Se preservan autorización del patch,
identidad/organización, ETag, cola y validaciones existentes. El código nuevo no
otorga autoridad ni acceso a recursos. No se exponen secretos ni se instala una
dependencia. La creación adicional conserva la primera capa, probado en dominio.

La QA tiene persistencia en memoria y no monta toda NativeCompositionPreview;
selección/apertura/seek tras crear se revisaron por integración de código. No se
acredita una sesión autenticada, round-trip a Supabase, deshacer/rehacer en la
aplicación completa ni un video final renderizado. Los HTML se compilan en ambos
targets, sin render pagado. No se desplegó ni se aplicó SQL remoto.

Se conservaron los cambios ajenos del área de usuarios encontrados al iniciar.
Rollback: revertir presentación y defaults, conservando el lector de documentos
MANUAL; no hay migración. Para QA en destino: abrir Subtítulos, crear sin voz,
escribir dos frases, guardar, recargar el borrador, verificar tiempos y deshacer.
