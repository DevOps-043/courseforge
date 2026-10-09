# CAP029 — integración transaccional del piloto legado

Estado: **reserva autorizada por el usuario el 2026-10-08**, implementación
transaccional backend y migración preparados, pendientes de integración cliente y
verificación en ambiente. La autorización cubre repositorio,
handlers/rutas HTML propios y preparación/numeración de migración, sin aplicarla.
No incluye append/gateway compartido ni áreas reservadas al compañero.
No se ejecutan SQL, instalación, flags, envío a otra conversación o deploy.

## Evidencia y causa

`registerInstalled/registerInitial` registra revisiones de source ya presente en
native. `bindHtmlEditingRevisionToComposition` rechaza diferencias de source.
El instrumentador añade IDs/markers y puede cambiar serialización; el candidato
no puede adoptarse mediante registro antiguo sin una actualización nativa.
No resolverlo con append native seguido de registerInitial por dos llamadas:
dejaría una versión publicada incompleta ante error/ACK perdido.

`prepareHtmlEditingLegacyAdoption` ahora prepara sin escribir:

- Base autorizada/CAS exacto; clip DECK_SLIDE sin reference HTML existente.
- Regeneración del paquete con source obtenido de native, anchor/grants actuales.
- Catálogo operator-owned tenant-scoped independiente: source/template/version y
  declaraciones completos deben coincidir, no basta compartir source SHA.
- Nueva revisión HTML inicial y nuevo documento nativo con source candidato y
  referencia exacta. Preserva layout/timing/canvas, clips ajenos y source original
  en el documento previo; no destruye ni sobrescribe el argumento original.
- Resultado PREPARED_LEGACY_ADOPTION_NOT_COMMITTED; mantiene revisiones humanas
  obligatorias. No ejecuta preview, registerInitial ni persistencia.

## Contrato que requiere acuerdo

1. Reservar repositorio de adopción HTML propio, handlers/rutas nuevos de CAP029
   y numeración de migración; no modificar catálogo UX/CAP022/025/027. Cualquier
   cambio al append/gateway compartido debe reservarse explícitamente aparte.
2. Caller HTTP aporta solamente identidad de candidato revisado/comando y CAS.
   No aceptar document/source/manifest/grants del cliente como autoridad.
   Backend obtiene aprobación, catálogo, original y recursos independientemente.
3. Un RPC service-only bloquea raíz draft y revalida actor/tenant/CAS/source SHA,
   candidato aprobado y grants antes de publicar. Persiste nueva versión nativa,
   template/revisión inicial, provenance/auditoría y recibo de comando en **una
   transacción**. Fallo en cualquier paso revierte todo. No aplicar registro viejo
   a source distinto ni sobreescribir la versión anterior.
4. `binding.documentSha256` del plan es la base original autorizada, no el hash
   final con source/reference. Verificar ambos explícitamente; no confundir sus
   roles ni cambiar el hash del documento para hacerlos coincidir.
5. Identidad/digest de comando liga base, clip y candidato/provenance aprobados.
   Replay exacto retorna recibo original; ID reutilizado con otra intención falla.
   ACK perdido conserva journal y solo consulta receipt. Sin retry automático,
   append compensatorio, nueva identidad ni reconstrucción desde source cliente.
6. UI propone diff y confirmación, persiste seguimiento antes del POST, recupera
   resultado sin segundo commit y recarga native/inspector autorizado. No instalar
   desde selector del catálogo reservado ni permitir apply directo de este plan.

## Evidencia necesaria para retirar I01

Tests de contratos, errores/ACK/replay y rollback; SQL en entorno autorizado con
concurrencia y fallo a mitad de transacción; recorrido de piloto revisado hasta
native pointer, original histórico preservado y exact undo. QA visual/accesibilidad
queda al tester, pero no sustituye código de commit o aprobación faltantes.

El plan puro no cierra I01. Preparar la migración queda dentro de la reserva
aceptada; aplicarla, registrar templates y activar rutas/flags siguen pendientes
de autorización de ambiente. No interpretar esta reserva como aprobación del piloto.

## Implementación backend preparada (2026-10-08)

- `composition-html-editing-legacy-adoption.contract.ts`: request estricto con
  candidateId/provenanceSha256/expectedDocumentHash; candidato operator-owned con
  anchor/source/template y tres revisiones humanas explícitas ligadas a reviewer y
  evidenceSha256; receipt histórico sin source ni claims de estado actual/render.
- Digest v1 liga tenant, draft, clip, actor, operación, candidato, provenance y CAS.
- `SupabaseHtmlLegacyAdoptionRepository`: staging solo para host de revisión
  humana, lectura independiente de candidato/contexto/catalogue/grants, regeneración
  íntegra mediante preparación existente y un único RPC de commit. Lectura/replay
  de recibo no recompila, no exige catálogo actual ni repite commit. Un NOT_FOUND
  no autoriza reintentar un POST perdido; el cliente debe conservar su journal.
- Migración propia reservada `20261008100000_html_editing_legacy_adoption.sql`:
  candidato/revisión humana inmutables y revocables monotónicamente, receipts
  tenant/actor-scoped, RLS sin acceso directo incluso para service_role y funciones
  service-only. Root lock/NOWAIT, actor y reviewer actuales, candidato no revocado,
  CAS/source originales, template vacío, grants, referencia/documento exactos antes
  de append-v2 existente. Native/audit/template/revisión/receipt en una transacción.
  No modifica append-v2 ni gateway compartidos. Número único en inventario local;
  no prueba historial de migraciones remoto ni orden autorizado de despliegue.
- Ruta nueva `drafts/[draftId]/html-editing/[clipId]/adopt/operations/[operationId]`:
  POST con los tres campos del request; GET con esos campos y requestSha256 del
  journal. Actor/tenant derivan de sesión. Same-origin, reviewer, cuotas separadas
  por método/org/actor, payload/URL/timeouts y verificación de receipt antes de
  respuesta. Errores seguros no retryables. No acepta aprobación/source/grants y
  no ofrece una ruta pública para staging operator-owned.

Gates privados, todos literal `true`, sin activación:

- GET: inspector + `COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_RECEIPTS_ENABLED`.
- POST: gates de GET + mutations + `COMPOSITION_HTML_EDITING_LEGACY_ADOPTION_ENABLED`.

Registro humano y activación no se automatizan. `stageReviewedCandidate` exige que
el host responsable haya obtenido las tres revisiones y evidencia verificable; un
hash válido o un piloto REVIEW_REQUIRED no constituye aprobación. Actualmente no
hay flujo UI de revisión/staging/confirmación conectado: pendiente I01. Journal,
transporte y coordinador recovery/lecturas autorizadas están preparados, aún sin
host/controles visibles conectados. Casos undo/redo reales siguen pendientes.

RPC timeout/abort cliente no demuestra cancelación del servidor ni rollback de un
commit incierto. SQL estructural y fakes de Supabase no prueban ejecución PostgreSQL,
RLS, locks, revocación/concurrencia ni rollback real. Preparar prueba en tenant
autorizado al resolver A01; no aplicar SQL para obtener evidencia sin autorización.

Rollback operativo: deshabilitar nuevas adopciones manteniendo lectura de receipts
y datos históricos según autorización del operador. No borrar candidates/templates,
source original ni receipts, ni ejecutar append compensatorio tras ACK perdido.

## Coordinación cliente preparada

Preimagen compartida entre Node y WebCrypto conserva digest v1; no duplicar el
algoritmo ni usar owner cliente como autoridad HTTP. Transporte bounded envía un
POST explícito o GET con intención original/digest y verifica owner, clip, operación,
request/correlación/receipt. No retry, redirects ni fallback. Error POST permanece
OUTCOME_UNKNOWN incluso si la respuesta HTTP fue rechazada después del dispatch.

Journal separado por actor/tenant/draft, máximo8192 bytes, solo intención y receipt;
sin source, package, aprobación ni grants. Verifica digest antes de persistir,
relectura exacta antes de registrar receipt y antes de cierre. Corrupto/ocupado no
es vacío; no overwrite ni expiración automática. localStorage no constituye CAS.

Coordinador usa lock de publicación y reserva nativa existentes. SEND bloquea ante
journals pendientes/corruptos de edición/inicialización/snapshot; valida base, clip,
hash y guarda ID/digest antes del POST. RECOVER siempre consulta servidor, incluso
con receipt local, y NOT_FOUND mantiene seguimiento. Luego verifica native/hash/
versión y, para modo actual, inspector/pointer/manifest/source/grants iniciales.
El host acepta el estado verificado bajo reserva antes de cerrar journal; fallo
o cambio de owner conserva seguimiento. Callback recibe AbortSignal y debe comprobar
owner/estado actual inmediatamente antes de aplicar datos o afectar UI.

RECOVER historicalOnly requiere acción explícita: consulta receipt y native actual
idéntico al cargado; no consulta inspector, instala HTML ni reactiva el candidato.
Su resultado view=null no certifica campos editables ni paridad preview/render.

Pendiente antes de ofrecer adopción: controles de revisión/confirmación, lectura
autorizada de candidato/diff, host/global blocking y recovery center. Los otros
workflows deben observar ocupación de adopción de forma simétrica al integrarla;
no activar cliente solo por existir estas funciones. No duplicar catálogo reservado.
