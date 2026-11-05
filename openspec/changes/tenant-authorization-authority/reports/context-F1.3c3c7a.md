# Continuidad F1.3.c.3.c.7.a — 2026-11-05

Base 00f74465, staging. Unidad cerrada localmente.
Tres soportes compartidos de autorización HyperFrames.
El lote padre .7, F1.3, TD-26 y el objetivo global permanecen abiertos.

## Alcance y diagnóstico

Inventario actual por llamada a los resolvers compartidos: dieciséis rutas,
dieciocho métodos. No incluye renders/route.ts ni otros consumidores independientes.

- Presets: composition-presets GET, drafts/[draftId]/composition-presets POST;
  preset-applications GET/POST, [applicationId] DELETE, apply/undo POST y preview GET.
- Propuestas: agent-proposals POST, [proposalId] DELETE, apply/undo POST y preview GET.
- Render: [requestId]/poll GET/POST, diagnostics GET, evidence GET y cancel POST.

Los soportes propagaban errores conocidos de autoridad hasta catches genéricos
de sus consumidores, que devolvían 500. Render además revisaba rol antes de
resolver tenant y sin pasarle ese contexto, a diferencia de los otros dos.

Se conservan las funciones exportadas y se separa resolución de su traducción
HTTP: el wrapper captura solo las dos clases internas, devuelve la respuesta
del mapper existente y relanza cualquier otro error sin modificarlo. No crea
admin después de una frontera fallida. Render conserva campos admin y
organizationId de su forma de error; su revisión ahora recibe el tenant resuelto.
Ausencia de tenant produce TENANT_FORBIDDEN 403 y rol insuficiente ROLE_FORBIDDEN.

No se modifica ningún handler consumidor ni negocio de catálogo, propuestas,
aplicación/undo, polling, evidencia o cancelación. Tampoco documento, motion,
hash, ETag, firma, CSP, concurrencia, DB, worker o contrato del proveedor.

## Caracterización y evidencia

Salidas en .tmp/module-graph/f1-3c3c7a-*.log:

- Primer intento de compilación de fixture: tipos de bindings dinámicos y unión
  de headers incompatibles. Se tiparon con Record<string, unknown> y HeadersInit;
  no se modificaron expectativas ni verificadores.
- compiler: código 0, fuentes de tests compiladas.
- before: código 1, 28/47 aprobadas y diecinueve fallos esperados: dieciocho
  clasificaciones HTTP y contexto de revisión de render. Las denegaciones,
  errores desconocidos, representantes válidos y precondiciones ya pasaban.
- auth: código 0; contrato 15/15 y grupo de autoridad 379/379, 47 nuevas.
- hyperframes: código 0; script existente completo. Solo acredita los archivos
  que invoca realmente, no todos los tests compilados (TD-31 sigue pendiente).
- node22: código 0; 47/47 con runtime local en caché, sin red.
- gate: código 0; verify:pr completo. 39 pruebas de harness, 48 cambios OpenSpec,
  lint cero errores/570 warnings sin diferencias, tipos, migraciones y producto.
  Grafo: 2.304 módulos, 9.023 aristas, cero ciclos/desconocidos, dos referencias
  justificadas del bundler. Auth Bridge/HyperFrames se ejecutaron aparte; no
  acreditar invocación en CI de tests nuevos ni suites solo compiladas.
- docs-final y openspec-final: código 0 tras actualizar el tablero y punto de
  reanudación; 329 documentos y 48 cambios válidos. git diff --check sin errores.

Los tests descubren consumidores recorriendo rutas y buscando sus llamadas
directas actuales; verifican inventario de 16/18 y cargan cada handler real con
el soporte real. No se elige una muestra favorable para fallos de autorización.
Cubren 108 combinaciones de dos clases por identidad/tenant/revisión × 18 métodos,
503 seguro/retryable/correlación/no-store/Vary Cookie, canario ausente y cero
efectos posteriores a la frontera fallida. Los 54 casos de denegación conservan
401/403 sin admin ni dominios. Cada resolver conserva contexto positivo y relanza
la misma excepción desconocida, incluso si falsifica name/code de autoridad.

Contratos positivos HTTP representativos: catálogo de presets, descarte de
propuesta y lectura durable de render propagan tenant/DTO. El módulo real de
versiones acredita 428 para precondición ausente/inválida/incoherente, hash válido
y headers CSP/no-store/nosniff del soporte de presets.

Identidad/tenant/rol y admin son dobles. Imports de dominios/SDK se sustituyen por
funciones bloqueadas y clases sintéticas; los tres representantes usan resultados
simulados. No se acredita semántica de schemas externos, errores de dominio,
aplicación efectiva/undo, persistencia, acceso al proveedor o seguridad del render
mediante esos dobles. Parser, API response y clases de autoridad son reales.
No se leyó .env, no se usaron credenciales ni se inició render/generación.

## Revisión y continuidad

Revisión adversarial por el mismo agente, no independiente: contrato de response
en los consumidores, ausencia de efectos tras denegación, tenant de revisión y
relanzamiento de desconocidos. Se preservan los cinco documentos heredados y
directorios de auditoría fuera del commit. Sin dependencia o baseline nuevo.

La aceptación de rol/membresías/RLS/Storage en entorno real, build/compliance/QA
visual y CI no se acreditan localmente. Reversión por commit de esta unidad.
No hubo publicación, despliegue, SQL remoto o modificación de proveedores.

Siguiente .7.b: renders/route.ts (recuperación/creación) y rutas HyperFrames que
no usan los tres soportes; revalidar inventario completo. Investigar también
emisores de autoridad después del contexto en los consumidores: este wrapper
solo cubre la resolución compartida y no absorbe errores posteriores de dominio.
No cerrar .7 ni TD-26 por .7.a. Después continúan consumidores restantes y todas
las fases del plan principal, incluidas integridad de configuración y recuperación
durable de standalone registradas previamente.
