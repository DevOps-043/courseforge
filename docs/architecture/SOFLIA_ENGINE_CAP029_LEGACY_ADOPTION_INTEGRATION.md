# CAP029 — integración transaccional del piloto legado

Estado: **reserva autorizada por el usuario el 2026-10-08**, implementación
transaccional backend y migración preparados, cliente de revisión/confirmación y
recuperación conectado; operador privado y auditoría I01 de implementación completos;
verificación en ambiente y QA pendientes. La autorización cubre repositorio,
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

## Evidencia y separación de implementación/ambiente

I01 de implementación: contratos, errores/ACK/replay y recorrido conectado de
piloto registrado hasta native pointer/recibo con original preservado. Cubierto
por la auditoría y pruebas locales actuales. A01 requiere SQL en ambiente autorizado
con concurrencia y fallo a mitad de transacción; A02, instalación/piloto/ACL reales;
Q01, visual/accesibilidad/undo observados por el tester. No confundir esos resultados
reales pendientes con código faltante, ni afirmar que fixtures certifican rollback.

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

Host y recovery center conectados: journal de adopción pendiente/corrupto bloquea
edición, inicialización y recovery editorial; guardas revalidan durante reserva.
Los bypass nativos y publicación observan el isBlocked existente. Recovery actual
instala payload autorizado antes del cierre; histórico no instala ni restaura.
Owner/payload cambiados conservan recibo y journal sin adoptar datos.

El gate público de SEND requiere inspector, receipts de adopción, adopción y
mutations explícitamente true; no se activó ninguno. Deshabilitar SEND no oculta
seguimiento ni prohíbe intentar GET autorizado; el servidor sigue controlando
permisos/gates de lectura. Panel con abort al desmontar, estado anunciado y
acciones explícitas de verificación actual o histórica; no formulario de POST.

## Revisión y confirmación visible

GET `/drafts/{draftId}/html-editing/{clipId}/adopt/candidates/{candidateId}` con
un único query `expectedDocumentHash`. Sesión deriva actor/tenant, rol reviewer,
same-origin/fetch metadata, doble cuota y límites; respuesta privada no-store.
Reutiliza RPC read candidate y bootstrap: aprobación previamente registrada,
owner/base/anchor actuales, catálogo/grants y regeneración independiente. No
staging, append ni registro por GET. Commit vuelve a reautorizar todos los datos.

Vista acotada (4 MiB JSON; cada source 250 KiB UTF-8) expone sources antes/después,
SHA/provenance, hash propuesto, template/version, evidencia/revisiones registradas
y etiquetas/identidad/tipo de campos. No entrega encodedPilot, grants ni package.
Cliente correlaciona owner/base/candidate y verifica SHA de ambos sources.
Delta textual lineal completo con prefix/suffix y pares Unicode preservados;
no comparación visual ni prueba de paridad por strings.

Inspector permite consultar UUID aprobado y confirmar manualmente ese candidato.
Texto React escapado en pre, sin iframe/srcDoc/innerHTML ni ejecución del source.
No selector de catálogo paralelo. Releer/cambiar ID reinicia confirmación; cambio
de base oculta revisión obsoleta y bloquea SEND. Key owner/clip aborta al cambiar
contexto sin desmontar solo por el payload que adopta el propio host.

Pendiente: consumers I04 restantes y coordinación con narrativa
sin editar el frente reservado unilateralmente. No activar cliente solo por existir
estas funciones ni duplicar catálogo reservado. QA browser/accesibilidad, DB/RLS y
transacción reales siguen pendientes; piloto requiere instalación autorizada.

## Operador concreto y cierre de implementación I01 — 2026-10-10

`legacy-operator.mjs`→factory/workflow→preparador existente→handoff HMAC/readback→
revisión humana explícita/catálogo independiente→intención durable→repositorio
stageReviewedCandidate. READ_PREPARATION permite recuperar por UUID una preparación
sellada contra contexto vigente. READ_REGISTRATION consulta SQL28 y coteja el
candidato completo sin catálogo/source/compilación/adopción; conserva intención
incluso con registro revocado/NOT_FOUND/error. No borrar/repetir ni generar UUID
nuevo para eludir una incertidumbre. La revisión/adopción desde inspector conserva
su confirmación/journal/commit separados y nunca importa approval del browser.

Mecanismo de JWT/profile/tenant compartido con operadores histórico/reconstrucción,
sin cambiar autorización RPC ni instalar flags/catálogo/SQL. Contrato de lectura
de registro vive en adopción, no hace depender repositorio del workflow del CLI.

39/39 pruebas dirigidas, regresión1002/1002 y9/9 de las tres entradas privadas
aprobadas; tipado web/lint dirigidos aprobados. El recorrido cruzado usa el candidato
recién registrado en la revisión/adopción reales y coteja pointer/source/revision
SHA/recibo/original. RPC simulado; atomicidad DB, ACL y comparación humana/visual
reales pendientes. I01 implementado; I02/I03/I04/I05 no se cierran con este resultado.
[Auditoría](SOFLIA_ENGINE_CAP029_LEGACY_LINEAGE_AUDIT.md) y
[operación privada](SOFLIA_ENGINE_CAP029_LEGACY_OPERATOR_HANDOFF.md).
