# Continuidad F1.3.c.3.c.6.a — 2026-11-05

Base b9ad854e, staging. Unidad cerrada localmente. Automatización, ocho operaciones HTTP; el lote padre
F1.3.c.3.c.6 y TD-26 siguen abiertos por standalone y aceptación de entorno.
El objetivo global conserva todas las fases del plan principal.

## Alcance y solución

Cinco rutas bajo api/production/automation/runs:

- raíz GET/POST; [runId] GET/POST.
- [runId]/configuration PUT y [runId]/dispatch POST.
- [runId]/items/[componentId]/clips POST/PUT.

Producción añade cinco imports y siete guards (19 líneas). [runId] usa su
formatter compartido respond para ambos métodos. Las clases conocidas de
identidad/tenant se proyectan mediante authorizationUnavailableResponse antes
del error genérico o de dominio. Dispatch ya tenía 503 genérico; ahora el fallo
de autoridad usa mensaje seguro, correlación y private/no-store/Vary Cookie.
El fallo ordinario de worker conserva la respuesta genérica existente.

No se modifican filtros, permisos, orden de validaciones, actor/organización,
aprobación, schemas, firma, callback local, servicios de dominio o SQL. No se
inician proveedores ni generación real. Los tres handlers standalone no quedan
normalizados ni asegurados por esta unidad.

## Caracterización y evidencia

Salidas conservadas en .tmp/module-graph/f1-3c3c6a-*.log:

- before: código 2 por un import de tipo no usado en el test nuevo; corregido.
- before-verified: código 1; 41/49 aprobadas, ocho fallos esperados. Dispatch
  falló por semántica/headers; los demás por clasificación 500 en vez de 503.
  Los casos válidos y errores de dominio pasaron antes de modificar producción.
- auth: código 0; contrato 15/15 y grupo de autoridad 305/305, incluidas 49 nuevas.
- remotion: código 0, suite del dominio existente completa.
- node22: código 0, 49/49 con runtime Node 22 en caché y sin red.
- gate: código 0; verify:pr completo, 39 pruebas de harness, 48 cambios OpenSpec,
  lint cero errores/570 warnings sin diferencias, tipos, migraciones y producto
  (incluida readiness de automatización). Grafo: 2.297 módulos, 8.994 aristas,
  cero ciclos/desconocidos y dos referencias justificadas de bundler.
  El script Auth Bridge se ejecutó aparte; este resultado no acredita que CI
  invoque sus nuevas pruebas. TD-31 conserva la revisión de scripts/workflows.
- docs-final y openspec-final: código 0 tras actualizar el tablero; 327 documentos
  y 48 cambios válidos. git diff --check sin errores.

Se ejecutan handlers, parser JSON, schemas y clases de error reales. El error
de dominio se carga aislando imports del servicio; no se ejecuta su constructor
de servicio real. DB, identidad/tenant, revisión, acceso al artefacto, servicios,
firma y dispatcher son dobles registrados. El callback real del handler se
invoca contra un worker simulado. Ningún test acredita firma criptográfica,
permisos efectivos de DB, proveedor o ejecución end-to-end.

Las 49 pruebas cubren 50 combinaciones de ambas clases en identidad, tenant,
revisión y artefacto donde aplica; 503 seguro/retryable/correlación/no-store,
canario sensible ausente y cero efectos posteriores a la frontera fallida.
Conservan 400/401/403/404/409/413/500, 202 de creación/despacho y DTO de lectura.
Una excepción impostora con name/code no se trata como clase de autoridad.

Se comprueban filtros por organización en cada consulta/escritura de runs/items,
contraste del artefacto y pertenencia del componente al run; actor/configured_by,
captions/overwrite, defaults existentes, aprobación completa/incompleta y edición
de presets de clips. El despacho y callback reciben organización del servidor;
el body no concede autoridad. Error de consulta/escritura conserva fallo, no éxito
vacío. No se alteró ningún baseline o verificador para aprobar.

## Revisión y límites

Revisión adversarial por el mismo agente; no independiente. Diff acotado a
fronteras y evidencia. Se preservan los cinco documentos heredados fuera del
commit y los directorios de auditoría existentes.

Configuration hace escrituras sucesivas y puede dejar cambios parciales antes
de fallar o rechazar la aprobación. Tampoco invalida una aprobación previa antes
de actualizar items. No se afirma atomicidad; este lote conserva
su semántica y el error explícito. Debe caracterizarse y corregirse como unidad
de integridad/concurrencia, con contrato transaccional real y pruebas de fallo.
Tampoco hay prueba nueva de carga, compliance, build o QA visual.

## Continuidad de F1.3.c.3.c.6.b

Pendientes: standalone/media POST, heygen/standalone/videos POST y
heygen/standalone/videos/[videoId] GET. Añadir errores seguros y resolver
ownership de la consulta del vídeo antes de declarar el lote cerrado.

Hecho observado: POST genera con credencial del tenant pero no guarda vínculo
local vídeo/organización; GET acepta un ID arbitrario y lo consulta con esa
credencial. El resolver exige allowGlobalFallback false, pero el almacenamiento
de API keys por organización no garantiza cuentas distintas del proveedor.
Por tanto, compartir una cuenta deja sin contrato local el aislamiento de IDs.
No se probó con cuentas reales ni se afirma una filtración observada en producción.

Consumidor encontrado: app/admin/heygen/HeygenStudioClient.tsx, handleCreateVideo
y handleCheckStatus. Cada respuesta reemplaza CurrentJob completo; si se añade
un comprobante de acceso, conservarlo también después del primer polling.
Las tablas production_jobs y production_assets exigen
artifact_id en la migración canónica inicial; no añadir registros ficticios ni
asumir que permiten este caso. Contrastar migraciones posteriores antes de
elegir persistencia o comprobante verificable ligado a organización/video.
La firma background actual dura cinco minutos: no es un contrato de acceso a
vídeos ni debe reutilizarse sin separación de propósito, vigencia y pruebas.

Después: soportes HTTP HyperFrames y resto del inventario de autoridad; luego
continuar datos, publicación, transporte, operación, CI/editor y aceptación del
plan. No cerrar TD-26 por estas pruebas locales. Reversión por commit local de
esta unidad; no hubo despliegue, publicación, SQL remoto ni lectura de secretos.
