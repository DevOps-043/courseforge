# Continuidad F1.3.c.3.c.7.b.1 — 2026-11-05

Base 740544a0, staging. Unidad cerrada localmente.
GET/POST api/production/hyperframes/renders.
El objetivo global y los lotes .7/.7.b permanecen abiertos.

## Diagnóstico y cambio

La frontera de recuperación y envío convertía caídas conocidas de autoridad en
500. Revisaba rol antes de resolver tenant y no pasaba ese contexto a revisión.
Se añade el mapper compartido antes de errores genéricos/de dominio y se resuelve
tenant antes de canReviewContent(userId, tenant). Sin tenant: TENANT_FORBIDDEN
403; rol insuficiente: ROLE_FORBIDDEN 403. Nada privilegiado se inicia después
de fallar identidad, tenant o revisión.

El catch interno de despacho no cambia: intenta failDispatch y después produce
HyperframesRenderSubmissionError 503. Si el dispatcher lanza una clase conocida,
también se compensa antes de responder. Si la compensación arroja una clase
conocida, el catch externo devuelve 503 seguro sin afirmar reparación durable.

Se conservan schema estricto, límites, validación de compositionId, datos durables
inválidos 422, DTO, attemptId, deferProcessing y actor/organización del servidor.
Reutilizados devuelven 200, nuevos 202; reused o providerRenderId evitan despacho.
No hay cambios en servicios, SQL, documento, motion, formatos, presets, perfiles
de render, firma, worker o parámetros del proveedor.

El payload al cliente background sigue conteniendo solo renderRequestId. El
cliente existente firma automáticamente y la función Netlify verifica el body;
este lote no cambia ni acredita una ejecución real de ese protocolo.

## Evidencia local

Salidas en .tmp/module-graph/f1-3c3c7b1-*.log:

- compiler: código 0.
- before: código 1; ocho de trece aprobadas y cinco fallos esperados. Dos de
  clasificación de autoridad, dos de contexto de revisión y uno al fallar la
  compensación con clase conocida. Compatibilidad y orden del dispatcher
  pasaban antes de modificar producción.
- auth: código 0; contrato 15/15 y grupo de autoridad 392/392, trece nuevas.
- hyperframes: código 0, script completo existente. No equivale a ejecutar todos
  los tests compilados; el seguimiento de TD-31 permanece abierto.
- node22: código 0, 13/13 con runtime local en caché y sin red.
- gate: código 0, verify:pr completo. 39 pruebas de harness, 48 cambios OpenSpec,
  lint cero errores/570 warnings sin diferencias, tipos, migraciones y producto.
  Grafo: 2.306 módulos, 9.030 aristas, cero ciclos/desconocidos y dos referencias
  justificadas del bundler. Las suites Auth Bridge/HyperFrames se ejecutaron
  aparte; no se acredita su invocación completa en CI por este gate.
- docs-final y openspec-final: código 0 tras actualizar tablero/continuidad;
  330 documentos y 48 cambios válidos. git diff --check sin errores.

Handlers, parser/schema de request, validación de query, clases de autoridad,
clase de error de envío, API response y NextResponse reales. La clase de envío
se carga con imports aislados. Identidad/tenant/revisión, admin, recuperación,
submit, dispatcher y failDispatch son dobles registrados; el worker no se ejecuta.
No hay generación, render pagado, credenciales o SQL reales.

Trece pruebas con dieciséis combinaciones de caída conocida en identidad, tenant,
revisión y frontera de servicio. Exigen 503 seguro/retryable/correlación/no-store,
canario ausente y cero efectos posteriores a esa frontera. Preservan 400/401/403,
404/409/413/422/503 de dominio y 500 de un impostor por name/code. Los éxitos
acreditan atribución de parámetros/DTO, no idempotencia de DB/proveedor.

Se comprueban despacho nuevo, ausencia de despacho para reutilización/proveedor
existente, metadata de recuperación inválida sin valor rechazado, vacío real
null, rechazo de autoridad/HTML/ZIP en payload y recuperación de fallo. El caso
de dispatcher cubre Error ordinario y ambas clases de autoridad; dos casos de
compensación fallida comprueban que se responde fallo, sin declarar éxito durable.

## Revisión y riesgos

Revisión adversarial por el mismo agente, no independiente. Diff productivo
acotado a una ruta: un import, dos guards y revisión anclada al tenant. Se revisó
failDispatch: consulta por requestId y organización antes de marcar fallo. No se
modificó la implementación. No se relajaron baselines ni se agregaron dependencias.

No afirmar atomicidad entre creación, despacho y compensación. Un fallo al
compensar puede dejar solicitud pendiente; la conciliación durable requiere sus
pruebas de dominio/DB y observación autorizada. Un resultado reused del doble
no prueba ausencia de duplicación real. No hay build, compliance, QA visual,
carga o CI nuevos; RLS/Storage/membresías efectivas siguen pendientes.

Reversión por commit local. Se preservan los cinco documentos heredados y los
directorios de auditoría; no hubo publicación, despliegue o SQL remoto.

## Continuidad

Siguiente .7.b.2: rutas independientes restantes (composiciones/revisiones,
previews/recursos y borradores), más el inventario de emisores posteriores a
resolver contexto en los consumidores compartidos. Las búsquedas encontraron
adaptadores HTTP de html-editing y extracción narrativa en el dominio: revisar
también esos puertos antes de cerrar .7 o F1.3.
Inventario léxico preliminar guardado en
.tmp/module-graph/f1-3c3c7b1-remaining-inventory.json: 47 rutas candidatas tras
excluir imports del mapper y llamadas directas a los tres soportes compartidos.
Registra métodos y presencia textual de helpers de autoridad; no acredita que
todas fallen ni que un import por sí mismo cubra todos sus catches. Clasificar
fronteras/puertos y pruebas existentes antes de elegir los lotes siguientes.
TD-26 y las demás fases del plan siguen abiertos, incluidas integridad de
configuración, recuperación durable standalone y aceptación real.
