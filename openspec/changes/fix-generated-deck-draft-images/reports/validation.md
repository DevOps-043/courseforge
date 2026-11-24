# Validación

Fecha: 2026-11-23 (America/Mexico_City).

## Evidencia

- Consulta remota de solo lectura: borrador activo sin documento, cinco imágenes registradas y hashes del spec/artefacto coincidentes. No hubo escrituras remotas.
- Reproducción local con los datos actuales: antes fallaba la proyección narrativa por URLs remotas no permitidas; después construyó el documento inicial con veinte clips. No se ejecutaron proveedores ni renders.
- `npm run test:generated-deck-draft`: 22 pruebas, 22 exitosas. Incluye lector con imágenes, integración narrativa/editor y clasificación HTTP 422/503 sin filtrar detalles internos.
- `npm run test:remotion -w apps/web`: 236 pruebas exitosas, cero fallos.
- `npm run test:hyperframes -w apps/web`: 707 pruebas exitosas, cero fallos.
- `npm run verify:pr`: código 0; compuerta completa de arnés, documentación, especificaciones, lint, tipos, límites de seguridad y pruebas establecidas. Lint conserva 558 advertencias de línea base, cero errores y cero incrementos.
- `npm run docs:check`: 487 documentos verificados en la comprobación final.
- `npx openspec validate fix-generated-deck-draft-images --strict --no-interactive`: válido.
- `git diff --check`: sin errores.
- `npm run docs:audit`: se inició y se interrumpió sin completar; su recorrido recursivo incluye dependencias instaladas. No se considera validación aprobada. Se contrastaron manualmente el alcance del cambio con README, contexto operativo y fuente canónica; README no requiere cambios, y se actualizaron los otros dos documentos.

La primera ejecución manual del test HTTP desde la raíz falló al resolver una ruta relativa. El comando nuevo delega al workspace web y ejecuta los tres archivos compilados; su ejecución completa pasó. No se debilitó ninguna aserción.

## Revisión adversarial

Realizada por el mismo agente, sin revisión independiente. Se comprobaron aislamiento por organización/componente, conservación de hashes y registro de imágenes, rechazo de URLs manipuladas, ausencia de allowlist por dominio, ausencia de nuevas descargas y permisos separados del borrador. La nueva clasificación HTTP preserva correlación y no devuelve URLs ni mensajes internos. No se identificaron regresiones adicionales en el diff revisado.

## Límites y siguiente paso

No se dispone del log de la petición original: se confirmó un fallo determinista de su camino con los datos actuales, sin afirmar que sea la única causa posible. Pendiente desplegar mediante el flujo autorizado y reintentar preparar el editor del borrador existente; después comprobar apertura real en staging. No se generó contenido, no se usó HeyGen ni se creó un curso nuevo.

Evidencia operativa local ignorada por Git: `.tmp/draft-image-*.log` y scripts/datos de reproducción bajo `.tmp/`. No incluye credenciales; los datos del curso permanecen locales.
