# Continuidad F1.3.c.3.c.7.b.2.a — 2026-11-05

Base 155a9b83, staging. Clasificación de 47 candidatas y normalización de las
17 rutas directas (24 métodos). El lote .7 y TD-26 permanecen abiertos.

## Inventario y enfoque

hyperframes-direct-inventory.json conserva base, SHA-256, categoría, métodos,
catches y presencia de respuesta legacy. Son 17 rutas directas/24 métodos y
30 delegadas/38 métodos. La categoría no demuestra seguridad. Su generador
hyperframes-direct-inventory.mjs no sobrescribe el corte sin --replace o un
destino nuevo explícito. Los adaptadores delegados quedan en .7.b.2.b.

El lote directo abarca assets/listado/sync, composiciones, aprobación, snapshots,
revisiones, draft/final-video; document, branding, files, previews/recursos,
preview-metrics, detach-audio y planificación de extracción narrativa.

normalize-hyperframes-direct.mjs aplica una transformación AST sobre hashes
inventariados: 25 guards HTTP, incluidas 24 entradas y initializeDraftResponse;
nueve revisiones de rol pasan después de resolver tenant y reciben ese contexto.
No quedan llamadas de rol con un argumento en esas fuentes. Los errores
conocidos usan el mapper compartido; los demás conservan su clasificador.
El refresh opcional de assets permanece intacto como fallo parcial.

El mapper admite detalles opcionales suministrados por servidor. Conserva los
cinco contratos de methods con details.reason de tenant, además de mensaje
neutral, retryable, correlación y private/no-store/Vary Cookie. No confía en
name/code ni en datos del payload. Se retiraron ramas/formatter de tenant que
quedaban redundantes e import sin uso, sin perder sus razones de diagnóstico.

El preview nativo conserva JSON cuando no hay sync v2 válido. Para hash/generación
válidos devuelve HTML de failure bridge con DEPENDENCY_FAILED, CSP/nonce y
metadatos de sincronización originales; agrega Vary Cookie. Nunca inserta el
mensaje interno de autoridad. Usa el body API propio tipado, no datos externos.

## Reproducibilidad y límites del diff

El modo --verify reconstruye las 17 fuentes desde el blob Git base y los hashes
del inventario, reproduce el cambio y lo compara con el checkout, normalizando
solo finales de línea. Código 0: 17 archivos, 25 guards, nueve revisiones y cero
llamadas de rol restantes sin tenant. No escribe código en ese modo; guarda
hyperframes-direct-transformation.json. Destinos fuera de hyperframes/*/route.ts
se rechazan. --apply es una herramienta local de edición; no ejecuta migraciones,
SDK, requests o despliegues y no sustituye revisión/pruebas.

La comparación acredita el alcance de transformación, no correctitud del negocio
preexistente. No cambia schemas, formato/motion, hash/ETag, payloads de proveedor,
Storage, política de versiones, firma o algoritmos de dominio.

## Evidencia local

Salidas en .tmp/module-graph/f1-3c3c7b2a-*.log:

- before: primer intento con dos fixtures incompletas (body de generación y
  constante de timeout narrativa); sin cambios de producto.
- before-verified: código 1; 11/50 aprobadas, 39 fallos esperados por clasificación,
  contexto de revisión o bridge. Mismos handlers/parser reales, antes del cambio.
- direct: 48/50 tras el cambio; faltaban payloads completos para interceptar admin
  en final-video y detach-audio. direct-final: 49/50, faltaba durationSeconds.
  Se corrigieron las fixtures según schema; no se relajaron expectativas.
- auth y auth-final: código 0; contrato 15/15 y grupo de autoridad 442/442,
  incluidas 50 nuevas. La última usa casos propios sin dependencia del directorio
  OpenSpec para que archivarlo no rompa tests.
- hyperframes: código 0, script existente completo; no equivale a todos los
  tests compilados. TD-31 conserva el seguimiento de scripts y CI.
- Node 22: código 0, 50/50 pruebas nuevas; ejecución offline sobre compilación local.
- verify:pr: completado correctamente. Lint: cero errores y 570 advertencias,
  sin diferencias con baseline. Grafo: 2309 módulos, 9056 aristas, cero ciclos,
  dos referencias de bundler justificadas y ninguna sin resolver. Enlaces:
  331 documentos. El log termina con «Compuerta completada.»; se perdió el
  identificador de sesión durante compactación, por lo que no se repitió la ejecución.
- Después de cerrar este registro: docs:check, 331 documentos; OpenSpec estricto,
  48/48 elementos; diff --check correcto. No se modificó producto tras el gate.

Las 50 pruebas cubren 144 combinaciones de ambas clases por identidad/tenant/rol
en los 24 métodos; respuesta segura sin canario, no-store, Vary Cookie y cero
efectos posteriores. Los casos legacy conservan reason. Se ejecutan 72
denegaciones 401/403 y se intercepta el primer cliente privilegiado de cada
camino autorizado para verificar actor/tenant de revisión sin ejecutar dominio.
Esa interceptación no acredita respuesta de éxito o DTO de negocio.

Handlers, parser JSON, schemas locales de request, API responses, clases de
autoridad, contratos puros de preview y bridge son reales. Módulos de dominio y
SDK se bloquean con funciones/clases sintéticas. Los tests no acreditan schemas
externos posteriores a autorización, almacenamiento, conciliación, apply/undo,
media o render efectivos. El loader admite globals adicionales explícitos para
performance y AbortSignal nativos de este fixture; sus defaults permanecen iguales.

La prueba sync v2 usa el bridge real, exige HTML/503, código, hash, CSP, nosniff y
Vary Cookie sin mensaje sensible. Los casos de prueba viven en tests con sus
contratos originales y verifican paridad de exports actuales; el inventario de
OpenSpec sirve como evidencia, no como dependencia del runtime de producto/tests.

## Revisión y continuidad

Revisión adversarial por el mismo agente; no independiente. Se revisaron catches
internos, contratos legacy, iframe, declaración de rol y áreas fuera del diff.
No se afirma atomicidad o recuperación de efectos anteriores a una excepción
posterior a autorización. No hay nueva aceptación de DB/RLS/Storage, UI interactiva,
build/compliance, carga o CI. No se leyó .env ni se usó credencial real.

Reversión por commit local. Se preservan los cinco documentos heredados y las
auditorías fuera del commit. No hubo publicación, despliegue o SQL remoto.

Siguiente .7.b.2.b: inspeccionar los adaptadores de las 30 rutas delegadas y sus
38 métodos. No asumir que ausencia de import del mapper implica fallo: verificar
catch, shape de autoridad y protocolo HTTP en la factory real. Después completar
inventario de emisores posteriores al contexto y consumidores restantes antes
de cerrar .7/F1.3/TD-26. El objetivo global conserva todas las fases del plan,
integridad de configuración, recuperación durable standalone y aceptación real.
