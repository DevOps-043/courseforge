# Validación local — 2026-11-23

## Alcance comprobado

- `npm run test:session-decks`: código de salida 0; 78 pruebas del dominio, API con fronteras de identidad/repositorio simuladas, seis estados de la vista y cinco de la revisión integrada. Cubre producción concurrente idempotente, recuperación, preview, descarga, revisión obsoleta, sesión ajena, acceso denegado, HTML manipulado, materiales sin aprobación y QA bloqueante. El repositorio simulado no acredita RLS ni escritura remota real.
- `npm run test:remotion -w apps/web` y `npm run test:hyperframes -w apps/web`: código de salida 0.
- `npm run typecheck`: código de salida 0. ESLint dirigido sin errores ni warnings nuevos; la compuerta completa reportó 0 errores, 558 warnings existentes y 0 diferencias frente al baseline.
- Revisión visual nativa en Chrome del HTML local generado desde el componente real y una fixture: deck visible dentro de la tarjeta, indicador QA, contador y descarga. Verificada ventana estrecha; no es una prueba de autenticación ni de persistencia en staging. La página indica expresamente que usa datos ficticios.
- `git diff --check`: sin errores de whitespace. Los avisos de normalización LF/CRLF no son conflictos de merge.

## Revisión adversarial

Realizada por el mismo agente; no es una revisión independiente.

- La sesión se valida contra la agenda del curso autorizado; los assets se consultan por UUID derivado, curso, tenant y tipo.
- Una edición no reutiliza la presentación anterior: se verifica aprobación/entradas en cada acceso y otra vez antes de persistir. Una edición posterior puede dejar un asset histórico guardado, pero futuras consultas no lo sirven como vigente.
- La tabla de assets no se trata como HTML confiable: se recompila contenido aprobado y se compara antes de responder. El iframe permite scripts del renderer, sin `allow-same-origin`; la ruta añade CSP y caché privada desactivada.
- No se omiten validaciones de contenido o QA, no se autoaprueba el asset, no se serializan notas/soluciones. Las páginas conservan palabras y referencias; el contenido fuera de contrato sigue bloqueando con diagnóstico.
- Se pospone la consulta de cada deck hasta abrir su sesión para evitar solicitudes de todas las sesiones al cargar el curso.
- No se modificaron secretos, esquemas remotos, componentes Academy, contenido del curso de staging, HeyGen ni permisos. No se creó commit, push o despliegue.

## Límite operativo

Pendiente piloto después de despliegue autorizado: abrir una sesión aprobada en Producción, producir, navegar, recargar, descargar y comprobar la fila real de `production_assets`; verificar rechazo tras desaprobación. Esta prueba local no certifica el comportamiento desplegado. Los cambios futuros del renderer usados para sesiones deben incrementar `SESSION_DECK_VERSION` para no reutilizar HTML de un compilador anterior.

`npm run verify:pr`: código de salida 0, «Compuerta completada». Ejecutada con TEMP/TMP del proceso bajo `.tmp/session-deck-process-temp`, sin modificar configuración del equipo. Incluye tipos, lint, arquitectura, migraciones locales, seguridad y regresiones de producto; no se aplicó SQL ni se ejecutó build/despliegue. `npm run docs:check` también terminó con código 0.
