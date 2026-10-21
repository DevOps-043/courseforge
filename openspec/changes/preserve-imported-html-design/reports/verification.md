# Verificación: fidelidad de plantillas HTML

Fecha: 2026-10-21. Rama: `codex/fix-imported-slide-visual-preview`.
Prioridad confirmada: conservar el diseño original y sus campos de texto.

## Causa y solución

El perfil anterior eliminaba imágenes/fuentes y la declaración completa de un
fondo con URL, perdiendo también su color. Además, el editor geométrico no
representa todos los estilos del archivo. El nuevo modo `html-text` conserva
HTML/CSS estático y recursos embebidos validados; asigna campos de texto sin
anunciar una conversión al editor nativo. Materializa condiciones de posición
CSS antes de envolver texto mixto para conservar reglas como `strong:last-child`.

El worker deduplica recursos. El servidor comprueba MIME, contenedor, límites,
longitud y SHA-256. SVG no admite código ni referencias externas. Los recursos
se guardan una vez en el ZIP privado; BD/listados contienen manifiestos. La
recarga autoriza organización/run, valida path/hash y limita descompresión real.
La generación sustituye texto escapado y recupera los recursos bajo autorización.
El preview de biblioteca se carga de forma lazy mediante una ruta autenticada
con filtros de organización en run/spec, CSP y `private, no-store`.

## Matriz y evidencia ejecutable

- Recursos válidos, MIME falso, SVG activo, hashes alterados, referencias
  ausentes/cruzadas, dimensiones negativas, presupuesto de píxeles/fuentes:
  `npm run test:slide-template-import -w apps/web`.
- Guardado, reintentos, manifiestos sin base64, ZIP con una copia por recurso,
  recuperación, tenant ajeno, paths, integridad y descompresión acotada:
  misma suite, BD/storage simulados.
- Sustitución de texto, preservación de selectores y rechazo de conversión
  geométrica: misma suite. El perfil anterior conserva sus casos de preflight.
- Modal: `apps/web/tools/qa/import-slide-template.smoke.mjs` con Chrome real,
  worker/componentes/estilos reales y endpoints simulados. Pasan cuatro escenarios
  claro/oscuro, 1440/390 px, originales sintéticos de 21,7/50/100 MB,
  cancelación, archivo excesivo, presupuesto JSON, contraste, foco, revisión,
  preview aislado, guardado y acciones visibles.
- Archivo del usuario: `apps/web/tools/qa/import-slide-template-fidelity.smoke.mjs`,
  Chrome real, scripts originales deshabilitados, red bloqueada, fuentes listas,
  capturas de los 16 diseños a 960×540 tras guardado/recarga reales del ZIP con
  BD/storage simulados. Artefactos locales en
  `apps/web/.tmp/html-template-fidelity-qa/`; resultados del modal en
  `apps/web/.tmp/html-template-import-theme-qa/`.

El original tiene 22 850 884 bytes; la preparación conserva 8 recursos únicos,
2 580 009 bytes binarios. La estructura preparada ocupa 58 486 bytes antes del
saneamiento final. La respuesta final completa ocupa **4 010 101 bytes**, por
debajo de 5 MB.

Comparación final: **16/16 diseños con 0 % de píxeles cambiados por encima de
12 niveles por canal RGB**, en las capturas de 960×540. El umbral permitido es
0,1 % y se comprobó también sobre el JSON final; no hubo errores de página.
Se inspeccionaron visualmente portada y diapositiva 15. Es una comparación
estática en el mismo Chrome y tamaño, no una garantía universal de identidad
en cualquier navegador, escala o contenido generado.

## Resultados y límites

- Importador: **39/39**, salida/código 0. Incluye posiciones originales y
  conservación de espacios al sustituir texto mixto.
- TypeScript: comprobación completa sin errores, salida/código 0.
- ESLint dirigido: sin errores; 10 avisos en el archivo de biblioteca existente.
- `npm run test:remotion --workspace=apps/web`: pasa la secuencia completa.
- `npm run test:security-boundaries`: **30/30**, salida/código 0.
- `npm run test:harness`: **20/20**, salida/código 0.
- OpenSpec: cambio válido con `--strict` usando el CLI temporal existente en
  `.tmp/openspec-cli`, salida/código 0.
- `npm run test:hyperframes --workspace=apps/web`: avanza por las pruebas de
  HyperFrames y varias de composición, pero falla en
  `composition-agent-model-output.test.js` porque Node no resuelve
  `@/lib/server/outbound-http`. No se modificó ese módulo ni se relajó la suite.
- `verify:pr`: pasan adaptadores (27), arnés y enlaces de documentación (122
  documentos). Se detiene con código 1 porque `openspec` no está instalado en
  el PATH del proyecto. La validación directa del cambio sí pasa con el CLI
  temporal. No se declara verde la puerta global ni se altera su configuración.
- `git diff --check`: pasa. El cambio concurrente en
  `supabase/migrations/BD.sql` es ajeno a esta implementación y se conserva.

No se probaron Supabase remoto, despliegue, build completo/CI, generación pagada,
ni una sesión HTTP real del endpoint de miniaturas. Sus controles de tenant se
revisaron en código y el lector compartido se probó con tenants distintos. La
revisión adversarial fue del mismo agente, no una revisión independiente.

El original no contiene animaciones de diapositivas: sus tres scripts controlan
navegación/UI y existe una transición de fondo en botones. Este perfil es
estático y no importa scripts, keyframes ni recursos externos. No modifica
`document.motion`. Los límites de contenedores no sustituyen un decodificador
completo de medios ni un antivirus.

El máximo local sigue siendo 100 MB, pero recursos únicos mayores de 3 MB o
estructura/transporte excesivos se rechazan explícitamente; no hay garantía
universal para todos los originales de 100 MB. Una futura ampliación requiere
subida directa privada de recursos con validación asíncrona y cuotas, en lugar
de aumentar el body síncrono. Las importaciones antiguas que perdieron medios
requieren reimportar el original.

## Reversión

Ocultar la nueva importación impide altas sin borrar paquetes. Mantener el
lector/renderizador `html-text` mientras existan plantillas o decks que lo
declaren. No convertirlos silenciosamente al editor geométrico ni borrar ZIPs.
No hay migración ni publicación en esta entrega.
