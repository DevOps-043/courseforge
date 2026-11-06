# Continuidad F1.3.c.3.c.5.b — 2026-11-05

Base 157f366f, staging. Unidad y lote padre F1.3.c.3.c.5 cerrados localmente.
Ocho handlers de slides/open-design; la aceptación global
de TD-26 y las demás fases del plan permanecen pendientes.

## Diagnóstico y solución

Las ocho rutas transformaban AuthIdentityLookupError y TenantContextLookupError
en 500. Se añade el mapper compartido únicamente en sus catches de frontera:

- slides/templates/[runId]/preview GET y slides/html-preview GET.
- slides/jobs GET, slides/appearance PATCH y slides/generate POST.
- slides/animated-deck/prepare POST.
- open-design/export POST y open-design/html-to-png POST.

503 incluye código seguro, correlación, retryable, private/no-store y Vary Cookie.
No se sustituyen catches de normalización, consulta específica de componente,
despacho o preparación interna. Fallos posteriores al inicio de esos procesos
conservan compensación/FAILED antes de responder y su clasificación propia.

Se comprobó además un acceso cruzado a HTML: html-to-png y prepare admitían un
path independiente del componente autorizado; el rasterizador descarga y puede
eliminar el archivo con service-role. Appearance también podía usar una referencia
guardada de otro componente para descargar y sobrescribirlo. Las tres rutas
ahora exigen namespace slides/{id-del-componente-autorizado}- después del
normalizador existente. Predicado puro compartido en slide-html-source-access.ts.
El identificador procede del componente resuelto en servidor. Prefijos parecidos,
otros componentes y referencias guardadas ajenas se deniegan con 404 antes de
Storage/rasterización; traversal conserva la denegación del normalizador.

No se exige que el path esté guardado previamente: useProductionAssetState llama
a prepare inmediatamente tras onAssetChange, sin confirmación de persistencia.
Un HTML recién subido al componente autorizado continúa siendo válido. Este
control de namespace presupone controles efectivos de escritura de Storage;
su aceptación real sigue pendiente y no se acredita con estas pruebas.

No hay cambios en schemas, firmas reales, proveedor, CSP, render, formatos,
motion, SQL o algoritmos de generación. El loader de tests incorpora Buffer
nativo para el exportador SVG; sharp y Storage se simulan, no se generan medios
reales ni se envían trabajos.

## Evidencia local

Salidas conservadas en .tmp/module-graph/f1-3c3c5b-*.log:

- before: código 1; contrato 15/15, grupo 232/245; trece fallos esperados:
  ocho clasificaciones HTTP y cinco casos de HTML ajeno. Los casos válidos,
  normalización y recuperación existentes pasaron antes de tocar producción.
- auth: código 0, grupo 245/245 tras el cambio inicial.
- auth-final: código 0; contrato 15/15 y grupo 256/256, incluidas 59 pruebas nuevas.
- node22: código 0, 59/59 con runtime Node 22 en caché y sin red.
- http-final: código 0, 59/59 tras sustituir require de la fixture por import.
- remotion: código 0, suite del dominio existente completa.
- lint: código 1 por un require de la fixture; cero warnings nuevos respecto
  de los 570 existentes. Se corrigió el import sin relajar reglas ni baseline.
- gate: código 1 antes de producto: faltaba texto normativo en dos requisitos
  nuevos de OpenSpec. Se añadió sin alterar escenarios ni verificadores.
- node22-final: código 0, 59/59 compiladas desde la fixture final con import.
- gate-final: código 0, verify:pr completo. Adaptadores/arnés, 39 pruebas de
  harness, 48 cambios OpenSpec, lint cero errores/570 warnings sin diferencias,
  tipos, migraciones y producto. Grafo: 2.295 módulos, 8.983 aristas, cero ciclos
  o referencias sin resolver, dos referencias justificadas del bundler.
  No incluye build, compliance ni QA visual adicionales de CI.
- docs-final y openspec-final: código 0 tras cerrar el tablero local; 326
  documentos y 48 cambios válidos. git diff --check sin errores.

Handlers, parser, schemas de requests/assets, clases de error, normalizador,
contrato API y NextResponse reales. También se carga el resolver de contexto
bundle-agent real con identidad/tenant/admin simulados. DB, Storage, preview,
compilación de deck, rasterización, firma/verificación y despacho son dobles
registrados; sus resultados no acreditan servicios ni ejecución end-to-end.

Las 59 pruebas incluyen 38 combinaciones de ambas clases en identidad, tenant,
revisión, componente y contexto editorial/generación según corresponda. Exigen
503 seguro, sin detalle sensible, y cero efectos posteriores a la frontera
fallida. Conservan 400/401/403/404/409/413/422/500; DTO/HTML/CSP y 202; filtros
de organización en preview, selección jobId/fecha y ausencia de despacho para
QUEUED/RUNNING/SUCCEEDED. Clases falsificadas por name/code no conceden 503.
Se comprueban actor/org derivados de servidor, payload sin autoridad, fallback
de header inválido y contraste de organización del artefacto para contexto
firmado simulado. Esto no sustituye pruebas criptográficas de la firma real.

Los fallos de despacho compensan, incluso una clase conocida después de comenzar
efectos; los de preparación persisten FAILED, con 400 corregible o 500 genérico.
No se afirma ausencia de artefactos parciales ante fallos de persistencia: esos
escenarios conservan 500 y no declaran éxito. Requieren operación de recuperación
si un upload terminó antes de fallar el parche; no se inventa atomicidad.

## Revisión y continuidad

Revisión adversarial por el mismo agente; no independiente. Se contrastaron diff,
escenarios y scripts; se preservan cinco documentos heredados y directorios de
auditoría ajenos. No se amplió el baseline ni se modificaron librerías.
Los resultados con dobles no acreditan permisos/RLS/Storage o carga operativa.
Sin despliegue, publicación, lectura de secretos o SQL remoto.

Reversión mediante el commit local de esta unidad. Revertir reabre el acceso a
HTML ajeno; se prefiere corrección posterior conservando el control de ownership.
Una referencia histórica a HTML fuera del namespace se deniega: debe reasignarse
o copiarse con autorización, nunca añadir un fallback global.

Próxima unidad F1.3.c.3.c.6: automatización/standalone, seguida de soportes HTTP
HyperFrames y resto del inventario. Revalidar consumidores actuales antes de
cerrar F1.3 o TD-26. El plan principal conserva datos, publicación, transporte,
operación, suites/CI, editor y aceptación final. La consulta secundaria de assets
en slides/jobs aún omite su error y usa assets vacíos; registrar y corregir en
TD-30 con su matriz de indisponibilidad, sin confundirlo con cierre de ese hallazgo.

Inventario de entrada del lote 6: cinco rutas de automation/runs (raíz,
[runId], configuration, dispatch, items/[componentId]/clips), ocho métodos;
standalone/media POST y heygen/standalone/videos POST + [videoId] GET. Ocho
rutas/once métodos identificados, todavía sin caracterizar ni normalizar.
