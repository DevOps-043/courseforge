# Continuidad F1.3.c.3.c.6.b — 2026-11-05

Base 4e585e14, staging. Unidad y lote padre .6 cerrados localmente.
Tres operaciones standalone y vínculo vídeo/organización.
El objetivo global conserva el plan completo; TD-26 no se cierra por esta unidad.

## Diagnóstico y decisión

POST heygen/standalone/videos generaba un vídeo sin vincularlo localmente al
tenant; GET [videoId] aceptaba cualquier ID usando la credencial de la organización.
Credenciales distintas por tenant no garantizan cuentas distintas de HeyGen.
Las tablas de producción exigen artifact_id en la migración inicial; las
migraciones posteriores inspeccionadas no acreditan su eliminación. No se crean
artefactos ficticios, tablas supuestas ni modificaciones SQL para este flujo.

Se implementa un comprobante HMAC SHA-256 versionado y de propósito exclusivo,
ligado a organización/ID/fecha de emisión, válido siete días sin renovación por
polling. Reutiliza el getter de clave existente, validado por su contrato de al
menos 32 caracteres; prefijo exclusivo separa este protocolo de background.
No contiene claves de HeyGen o de firma, ni concede identidad, membresía o rol.

La factory exige contexto UUID y clave disponibles antes de cliente privilegiado,
catálogo o generación. POST solo emite para el ID devuelto por el proveedor.
GET verifica comprobante después de identidad/tenant/revisión y antes de cliente
privilegiado/credenciales/proveedor. Revisión recibe el mismo tenant que firma y
credenciales. Ausencia, alteración, expiración o desajuste producen 404 uniforme.
Un ID distinto devuelto por el proveedor produce 502 sin asset o URL.
Al resolver tenant primero, su ausencia se clasifica como TENANT_FORBIDDEN 403;
un rol insuficiente se clasifica ROLE_FORBIDDEN 403. Ambos conservan denegación.

El verificador limita tamaño/formato, valida schema estricto tras HMAC y compara
en tiempo constante. Solo admite 30 segundos de desfase futuro. Rotación de
clave invalida comprobantes previos. El header x-heygen-video-token y el campo
standaloneAccessToken son redactados por el logger existente. Los fallos de
infraestructura registran evento/código seguros con correlación, sin causa cruda.

POST/GET de vídeo aplican private/no-store y Vary Cookie a todas sus respuestas.
El formatter genérico de errores HeyGen admite headers opcionales, sin cambiar
sus defaults. Media POST y las dos rutas de vídeo usan el mapper de autoridad
existente. Se conservan errores de proveedor, Retry-After, presets y registro de
medios; media conserva su 400 existente para un request que excede el límite.

HeygenStudioClient transporta el comprobante por header y lo mantiene al reemplazar
CurrentJob con cada respuesta. GET devuelve el mismo comprobante validado.
No cambia layout, formato multimedia, parámetros SDK, generación o callback_id.

## Evidencia local

Salidas conservadas en .tmp/module-graph/f1-3c3c6b-*.log:

- before: código 2 por un import de tipo no usado en el test nuevo; corregido.
- before-verified: código 1 antes de modificar los handlers; 16/24 aprobadas,
  ocho fallos esperados: tres de autoridad, acceso sin comprobante, creación sin
  comprobante, dos de preflight de firma y respuesta de ID inconsistente. Las
  seis pruebas criptográficas iniciales ya pasaban.
- auth: código 0, contrato 15/15 y grupo 329/329 después del primer cambio.
- auth-final: código 0, contrato 15/15 y grupo 332/332; 27 pruebas nuevas
  (siete de criptografía/redacción, veinte de handlers).
- remotion: código 0, suite del dominio existente completa.
- node22 y node22-final: código 0, 27/27 con runtime Node 22 local en caché.
  La última ejecución compila las fuentes finales tras corregir nombres de tests.
- gate: código 1 por tres warnings nuevos al usar module como nombre de variable
  en tests. Se renombró; no se amplió el baseline ni se relajó el verificador.
- gate-final: código 0, verify:pr completo. 39 pruebas de harness, 48 cambios
  OpenSpec, lint cero errores/570 warnings sin diferencias, tipos, migraciones
  y producto. Grafo: 2.302 módulos, 9.015 aristas, cero ciclos/desconocidos y
  dos referencias justificadas del bundler. Auth Bridge se ejecuta aparte;
  esto no acredita invocación de estas pruebas en CI (TD-31 sigue pendiente).
- docs-final y openspec-final: código 0 tras cerrar el tablero local; 328
  documentos y 48 cambios válidos. git diff --check sin errores.

Los handlers, schemas/parser, NextResponse, mapper, errores de proveedor y
criptografía son reales. La firma usa clave sintética inyectada y clock de
prueba. Se ejecutan además sign/verify background reales para demostrar rechazo
en ambos sentidos entre protocolos. El logger real acredita redacción de header
y campo de DTO. No se lee .env ni se consulta una clave real.

DB, resolución de identidad/tenant/rol, catálogo, proveedor y registro de media
son dobles. Los tests incluyen un proveedor simulado compartido por dos tenants,
POST seguido de dos GET, ID ajeno, caducidad, formato/tamaño, MAC/payload alterados,
propósito/versión, desfase de reloj, rotación y revocación de identidad/rol/tenant.
Verifican 18 combinaciones de caídas conocidas en las fronteras de las tres rutas,
503 seguro/no-store y cero efectos posteriores, sin canario sensible en respuesta
o logs. Conservan 400/401/403/404/409/413/422/429/500, Retry-After y DTO/estados.

La integración del studio se revisó en fuente y queda cubierta por tipos; los
tests de polling ejecutan HTTP encadenado, no el componente React ni un navegador.
No se acredita UI interactiva real, generación pagada, aislamiento del proveedor,
RLS, Storage, carga, build, compliance o ejecución nueva en CI.

## Compatibilidad, operación y riesgos

IDs históricos sin comprobante se deniegan; no se ofrece un fallback que consulte
por cuenta o ID. El frontend actualizado y ambos endpoints se deben entregar
juntos. Un comprobante perdido, expirado o invalidado por rotación no puede
renovarse solo presentando el ID: eso reabriría la vulnerabilidad. El estudio
mantiene el comprobante en memoria del job, sin nueva persistencia o cookies.

Esta decisión no añade una bitácora durable de jobs standalone. Si el proveedor
acepta generación pero se pierde la respuesta HTTP, puede quedar un resultado
sin comprobante recibido por el cliente. Ya existía incertidumbre de envío; no
se inventa idempotencia del proveedor ni recuperación automática. No reintentar
generación pagada como recuperación de autorización. Evaluar ledger y conciliación
como unidad posterior si se requiere recuperación durable o conservación mayor
a siete días, con esquema, retención y estados inciertos explícitos.

La política protege la consulta de metadatos en esta app; no asegura revocación
de una URL pública ya emitida por HeyGen. Es un límite del proveedor/entrega que
requiere aceptación del entorno. No hay migraciones ni cambios de credenciales.
Cambiar formato o vigencia exige versionar el protocolo; no prolongar tokens
existentes cambiando únicamente la constante de expiración.

Revisión adversarial por el mismo agente; no independiente. Se revisaron límites,
orden de efectos, contratos del consumidor y propósito de firma. Los cinco
documentos heredados y directorios de auditoría se preservan fuera del commit.
Reversión por commit local; revertir reabre consultas por ID sin ownership.
Preferir corrección posterior. No hubo publicación, despliegue o SQL remoto.

## Continuidad

Después de aceptación local, F1.3.c.3.c.7: soportes HTTP HyperFrames y restantes
consumidores del inventario. Antes de cerrar F1.3/TD-26, revalidar todas las
fronteras actuales y acreditar permisos/membresías/RLS/Storage en entorno autorizado.
La integridad de configuración detectada en .6.a y la recuperación durable de
standalone quedan registradas; el objetivo global conserva datos, publicación,
transporte, operación, suites/CI, editor, documentación y aceptación final.

Entradas encontradas para el lote .7: api/production/hyperframes/
_composition-preset-route-support.ts, renders/_render-route-support.ts y
drafts/[draftId]/agent-proposals/_route-support.ts. Revalidar todos los demás
supports y lectores; settings/connection ya tuvieron un lote previo y no deben
contarse otra vez como cobertura nueva. No se ejecutó todavía caracterización .7.
