# CAP-025 — primera entrega de operaciones IA seguras

Fecha: 2026-10-06. Estado: implementación parcial; integración y QA formal pendientes.
No se asigna porcentaje: no existe una rúbrica comparable aprobada para CAP-025.

Responsable de integración final: **equipo principal, que continúa CAP-027**, según
instrucción posterior del usuario. CAP-025 continúa únicamente en módulos exclusivos.
La propuesta de abajo **no constituye reserva** de archivos store/API/DB ni de capas
completas. Ningún cambio de esas capas se ha realizado en esta entrega.

## Base y reserva previa

Checkout `stagin-2`, HEAD `96a191b9` (padre `7e16e8c3`). Inspección inicial:
`git status --short` vacío. El commit incorpora el handoff, trackers, avances CAP-027,
HTML/narrativa y los contratos/planificador de thumbnails CAP-022 que el handoff
describía como locales. No hay cambios locales pendientes que copiar en este checkout.
La rama difiere del nombre histórico `staging`; se conserva la base recibida, sin
reset, stash, limpieza, merge ni rebase. Esto verifica presencia en Git, no la
aceptación de cada avance por sus responsables.

Reserva declarada antes de editar (solo para esta entrega):

- Existentes: `composition-agent-read-tools.service.ts` y
  `__tests__/composition-agent-read-tools.service.test.ts`.
- Nuevos: `composition-agent-read-session.service.ts`,
  `composition-agent-plan.service.ts`,
  `__tests__/composition-agent-read-session.service.test.ts`,
  `__tests__/composition-agent-plan.service.test.ts`,
  `__tests__/composition-agent-store-contract.test.ts`, fixture auxiliar
  `__tests__/composition-agent-test-fixture.ts` y esta nota exclusiva.

Prefijo de código: `apps/web/src/domains/production/composition-editor/`.
No editar allow-list, apply/store/gateway, documento, persistencia, preview,
snapshots, render, `qa/**`, componentes compartidos, package/config ni trackers.
CAP-022 y CAP-027 conservan sus áreas. Durante el trabajo aparecieron archivos
nuevos de CAP-022 y su nota de entrega en el mismo checkout; se preservaron sin
edición. No hay otra reserva CAP-025 encontrada en
los documentos leídos; una reserva externa posterior requiere dirección.

## Inventario requisito → implementación → brecha → prueba

| Requisito | Implementación existente auditada | Brecha | Evidencia/prueba prevista en este paquete |
| --- | --- | --- | --- |
| R23 catálogo | `composition-agent-policy.service.ts`: ocho tipos permitidos, máximo 12; schema de patches y modelo estricto | Catálogo normativo completo y clasificación de operaciones humanas no expuestos como contrato; no ampliar permisos | Catálogo local reutiliza exactamente allow-list y presets; rechazos de herramientas/tipos desconocidos |
| R23 lectura | `read-tools` y `prompt`: composición, selección, conflictos, presets sin fuentes | La base carecía de presupuestos, permisos explícitos y paginación; snapshot mantenía aliases | Implementado snapshot desacoplado/frozen y sesión host-scoped con selección fija, permisos y límites; 16 tests lectura (12 sesión + 4 snapshot) pasan |
| R24 planificación | `simulation`: operaciones secuenciales e inversas desde estados intermedios | La base carecía de contrato de pasos/dependencias/presupuesto agregado y reporte por paso; wiring aún pendiente | Implementado plan máximo 6 pasos/12 operaciones, dependencias anteriores, reportes por paso y propuesta agregada; 12 tests de plan pasan |
| R24 diff/validación | `proposal`, `diff`, `risk`, `validation`: campos seguros, rangos, no-op/overlap/canvas, confirmación | No hay evidencia multi-step reproducible; la propuesta acepta un hash base externo sin cotejarlo | Reutilización íntegra; plan coteja hash real y revisión host, valida cada paso y efecto neto, ninguna mutación externa |
| R25 TTL | Store TTL 15 min, pending/expiry; RPC preparada coteja `now()` | Fecha inválida en lector TS produce NaN y no expira; integración DB sin validar | Contratos simulados de expiración/borde y resultado RPC; registrar caso inválido como brecha, no cerrar |
| R25 revisión/hash | Preview/apply contrastan hash stored/current/expected; OCC en SQL preparado | Sin revisión base monotónica: riesgo ABA (restaurar mismo hash en revisión posterior) | Plan rechaza hash/revisión obsoletos en contrato host; falta persistir y revalidar revisión en apply transaccional |
| R25 policy/model | Modelo final y recovery metadata persistidos, allow-list ejecutable independiente del prompt | Sin policy version/hash ni modelo/proveedor ligados a consentimiento; envelope no vinculado por digest | Propuesta de integración: binding durable versionado; no sustituir con ledger local |
| R25 ownership | API auth + tenant + `canReviewContent`; consultas scoped draft/org; `created_by` insertado | Store no selecciona/compara `created_by`; SQL apply/undo no verifica owner. Política acordada: creador y revisores con delegación explícita; falta integrar | Sesión rechaza scope usuario/tenant/documento distinto; test fake demuestra ausencia del filtro owner actual, pendiente integración |
| R25 anti-replay | Estados y lock de fila SQL; APPLIED/UNDONE devuelve idempotentReplay sin RPC de escritura TS | Replay devuelve documento actual en vez de recibo histórico; no prueba carreras SQL ni reuso de consentimiento | Contratos fake de replay y estado terminal; propuesta de CAS/recibo original en transacción existente |
| R25 confirmación | Risk exige confirmación; endpoint apply POST explícito; high risk exige reinforcedConfirmation | Confirmación ordinaria implícita en POST; falta decisión de consentimiento ligado a proposal/digest/version/scope | Tests high risk sin refuerzo, contrato de propuesta siempre confirmable; integrar consentimiento explícito sin auto-apply |

Además se auditaron `composition-agent.service`, provider/model-output, prompt y
recovery, y sus seis tests originales: recuperación máximo 3 intentos/45 s,
normalización de salida y no retry de prohibiciones. No se llama ningún proveedor.
La documentación oficial de [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
se consultó para la revisión de grants/tenant; no se verifica la configuración DB
real. La lectura del changelog Markdown por web no fue soportada; no se introduce
ninguna feature ni cambio Supabase.

## Interfaces del paquete

1. `buildCompositionAgentReadSnapshot(document, selectedClipId)`: firma/forma
   original compatibles; copia profunda/freeze y límites duros. Es un helper
   interno para un documento ya autorizado por la API, no una autoridad por sí mismo.
2. `createCompositionAgentReadSession({ document, scope, authorization,
   selectedClipIds, budget })`: host entrega scope de documento/org/usuario,
   revisión/hash, grant vigente y herramientas; `read(request: unknown)` valida
   schema cerrado. El modelo solo suministra herramienta/argumentos; jamás grants,
   selección autorizada o presupuestos. `usage()` informa consumo local.
3. `simulateCompositionAgentPlan({ document, scope, authorization, input })`:
   input cerrado con baseRevision/baseDocumentHash/summary/steps; produce pasos
   simulados, proposal V2 agregado y hash candidato, sin persistir/aplicar/IA.
   Usa allow-list, proposals, simulación, diff, riesgo y evaluator existentes.

Los grants son datos internos del host **ya autorizado**, no tokens firmados ni
prueba de autenticación. No aceptar estos parámetros de un body/modelo/browser.
La integración deberá obtenerlos por auth/ownership/gateway y revalidarlos; los
módulos locales no reemplazan esa garantía.

Presupuestos locales iniciales, conservadores, reducibles por el host:

| Ámbito | Límite | Comportamiento |
| --- | --- | --- |
| Documento admitido por sesión/plan | 2 MiB, 500 clips, 32 tracks, 200 animaciones | Rechazo antes de simular; no modificar documento para reducirlo |
| Request de lectura | 4 KiB; schema cerrado | Cuenta intento incluso si está malformado/prohibido |
| Sesión | 12 calls, 50 000 unidades de trabajo, 256 KiB de respuesta acumulada | No reset durante repair/fallback; nueva sesión requiere host y cuota externa |
| Respuesta | 64 KiB UTF-8, página de hasta 50 elementos | Error sin resultado parcial; conteo total y nextOffset explícitos |
| Conflictos | 20 000 comparaciones, 500 resultados | Rechaza exceso; cobra scans de tracks/clips y comparaciones a sesión |
| Contexto legacy | 256 KiB UTF-8 | Conserva forma original; ahora puede rechazar composiciones muy complejas |
| Plan | 16 KiB, 6 pasos, 12 operaciones **en total** | Valida todo el batch antes del primer paso; valida cada estado y efecto neto |

Las unidades de trabajo son un contador lógico de entidades/scans/comparaciones,
no una medición CPU ni cuota OS. La API de integración debe limitar bytes del body
antes de materializar JSON, compartir cuota entre sesiones/recovery y revalidar
grants/revisión actuales. Una sesión local congela una revisión: no consulta cambios
ni revocación externa entre llamadas. La referencia candidata del plan es solo
para el host; no entregar su HTML/assets completos al modelo.

## Integración requerida — propuesta, sin implementar áreas compartidas

Orden propuesto para el responsable del núcleo:

1. **Decisión del usuario en esta conversación (2026-10-06): creador y revisores
   con delegación explícita.** El rol de reviewer en el tenant no demuestra
   ownership del proposal. La delegación debe estar vigente y scoped al
   proposal/documento/tenant, no ser un booleano enviado por el cliente.
2. API existente obtiene documento autorizado y revisión, construye scope/grant
   y budgets operator-owned, y usa sesión/plan. Mantener el formato proposal V2
   en consumidores hasta acordar versión de binding persistido.
3. Extender en **store/RPC existentes**, no otro ledger: baseRevision, policy
   version/hash, model/provider, digest del envelope/plan, owner/delegación,
   issuedAt/expiresAt y consentimiento para ese binding. Authority del modelo
   es solo informativa; nunca concede permiso.
4. Apply transaccional revalida auth/grants actuales, binding/digest, TTL válido,
   revisión + hash exactos y consentimiento ordinario/reforzado; consume propuesta
   junto al append OCC. Replay sin append retorna recibo histórico autorizado.
   Preview/undo/dismiss también deben respetar ownership y estados.
5. Acordar catálogo completo de operaciones como lectura/clasificación, conservando
   las ocho permitidas; no habilitar otras sin revisión explícita del núcleo.
6. Integración real posterior: grants/RLS SQL, actor service-role/Auth Bridge,
   concurrencia/replay/ABA, UI de confirmación, lectura autorizada, recovery y
   wiring en gateway. Reservar archivos compartidos antes de realizar cambios.

Contrato concreto propuesto (todavía no implementado en store/API/DB):

```ts
type ProposalBindingV1 = {
  proposalId: string;
  documentId: string;
  organizationId: string;
  ownerUserId: string;
  baseRevision: number;
  baseDocumentHash: string;
  policy: { id: string; version: number; sha256: string };
  model: { provider: string; id: string }; // informativo, nunca autorización
  envelopeSha256: string;
  planSha256: string | null;
  issuedAt: string;
  expiresAt: string;
};
type ProposalConsentV1 = {
  bindingSha256: string;
  confirmed: true;
  reinforced: boolean;
  // actor, fecha y delegación se resuelven/revalidan en servidor, no del body.
};
type ProposalApplyReceiptV1 = {
  proposalId: string;
  bindingSha256: string;
  outcome: "APPLIED" | "ALREADY_APPLIED" | "ALREADY_UNDONE";
  appliedRevision: number;
  appliedDocumentHash: string;
};
```

Propuesta de archivos compartidos necesarios, **sin reserva ni edición todavía**:

- `composition-agent-proposal-store.service.ts`: leer binding/owner, fecha válida,
  digest/consent/delegación, revisión exacta y recibo histórico; conservar recuperación
  e idempotencia existentes. Sus tests existentes y contratos de esta entrega.
- Nuevo `composition-agent-proposal-binding.types.ts` tras acordar schema/versionado;
  `composition-agent-proposal.types.ts` solo si se aprueba extender envelope V2.
- `composition-agent.service.ts` y rutas actuales `agent-proposals/**`: construir
  grant desde auth/gateway y ownership vigente; cuotas compartidas, plan/sesión,
  confirmación explícita ligada al binding. No añadir un endpoint de apply alternativo.
- Tabla `video_composition_agent_proposals` y RPCs apply/undo existentes: CAS
  revisión/hash + consumo atómico + delegación actual + recibo. Cualquier migración
  necesita reserva/numeración y revisión separadas; ninguna se creó/aplicó aquí.
  Auditar grants reales: las policies insert/update actuales solo filtran tenant;
  si los clientes tienen grants de escritura podrían alterar envelope/status.
  Proponer binding inmutable y transiciones solo por backend/RPC autorizadas.

La elección de ownership no reserva archivos compartidos ni autoriza la integración
unilateral. Responsable confirmado: equipo principal. La siguiente sección delimita
archivos/funciones/tablas para que el equipo acuerde una reserva específica.

## Segunda entrega — contrato delimitado para el equipo principal

Trabajo exclusivo realizado en este corte: nuevos
`apps/web/src/domains/production/composition-editor/composition-agent-integration.contract.ts`
y `apps/web/src/domains/production/composition-editor/__tests__/composition-agent-integration.contract.test.ts`,
más esta nota. Los módulos de la primera entrega conservan sus interfaces. No se
modificaron store/API/DB, allow-list, componentes compartidos ni errores Buffer de
CAP-027. El esquema no está conectado al tráfico actual ni habilita apply.

### Contrato V1 propuesto, ejecutable solo como validación local de DTOs

El módulo nuevo es la definición exacta de los tipos; la ficha TypeScript anterior
es el borrador histórico. Diferencias concretas de V1: discriminator/version,
`candidateDocumentHash`, formato de digest explícito, plan nullable y referencias
históricas separadas de apply/undo. El envelope editorial V2 queda intacto.

| Entrada/salida | Campos/condiciones | Autoridad y obligación pendiente |
| --- | --- | --- |
| `CompositionAgentProposalBinding` | proposalId, documentId (= draft_id actual), organizationId, ownerUserId, baseRevision/hash, candidateDocumentHash, policy id/version/SHA, model provider/id, envelopeSHA, planSHA nullable, issuedAt/expiresAt UTC milisegundos, kind/version/digestFormat | Todos derivados del host autorizado; el cliente/modelo no los declara. SHA y owner de forma válida no prueban autenticidad |
| `CompositionAgentBoundProposal` | binding + bindingSHA externo + envelope V2 + plan nullable; proposal/base coincidentes, allow-list original, validation.passed sin ERROR; operaciones del plan coinciden en orden con envelope | Host debe re-simular desde revisión histórica autorizada y verificar diffs/inversa/riesgo, target y todos los digests. DTO no hace esos rechecks |
| `CompositionAgentProposalConsent` | schemaVersion=1, bindingSHA, confirmed=true, reinforcedConfirmation boolean explícito | Body de confirmación únicamente; actor de sesión, fecha, delegación y policy jamás del body. Riesgo reforzado se deriva del host |
| `CompositionAgentProposalReceipt` | IDs + bindingSHA + outcome APPLIED/ALREADY_APPLIED/ALREADY_UNDONE + applied(revision/hash) + undone nullable | applied siempre baseRevision+1 y candidate hash exacto. En UNDONE conservar applied y añadir undo posterior con hash base. No devolver latest como sustituto histórico |

`parseCompositionAgentBoundProposal` valida estructura/correlaciones y presupuesto;
`parseCompositionAgentProposalConsent` contrasta digest/riesgo esperado del host;
`parseCompositionAgentProposalReceipt` coteja IDs/hash/revisiones contra binding
esperado. Ninguno autentica usuario, obtiene grants, verifica SHA criptográfico,
consulta reloj/estado DB, consume propuesta ni escribe. No tienen cliente DB,
ledger, gateway ni dependencia de proveedor.

El contrato conserva TTL máximo de **15 min**, contrastado en tests con la constante
del store actual. Rechaza fechas imposibles/NaN/intervalos vacíos/invertidos/largos.
Esto valida el intervalo declarado: **no prueba expiración durable**. Payload DTO
máximo 128 KiB y JSON finito; las rutas deben imponer límites antes de parsear.

Formato de digest propuesto para acuerdo, sin implementación/hash local activado:

- `SORTED_JSON_UTF8_V1`: tras parseo y normalización, objetos con claves ordenadas
  por comparación UTF-16 de JavaScript, arrays conservan orden, strings sin
  normalización Unicode, números finitos serializados con JSON.stringify (-0 → 0).
  Omitir propiedades opcionales ausentes; rechazar undefined explícito, funciones,
  bigint, ciclos, NaN/Infinity y valores no JSON.
- SHA-256 de UTF-8 de `{kind:"COMPOSITION_AGENT_ENVELOPE",schemaVersion:1,envelope}`,
  `{kind:"COMPOSITION_AGENT_PLAN",schemaVersion:1,plan}` y
  `{kind:"COMPOSITION_AGENT_BINDING",schemaVersion:1,binding}` respectivamente;
  serializar con la regla anterior. Sin ciclo: bindingSHA se guarda **fuera** del binding.
- El hash del documento conserva `hashCompositionDocument` existente; no cambiar
  su algoritmo ni documento. No usar `jsonb::text` como si fuera interoperable con
  este formato sin demostrarlo. Implementación e interoperabilidad host/SQL pendientes
  de aceptación por equipo principal; desconocer digestFormat/policy debe rechazar.

### Propuesta de reserva específica: lotes independientes, ninguno autorizado aún

Raíces de rutas usadas en las tablas siguientes (expandir literalmente):

- `D = apps/web/src/domains/production/composition-editor/`
- `A = apps/web/src/app/api/production/hyperframes/drafts/[draftId]/agent-proposals/`
- `U = apps/web/src/domains/materials/components/composition-editor/`

| Lote | Archivo exacto propuesto | Cambio acotado pedido al equipo principal |
| --- | --- | --- |
| A1 store | `D/composition-agent-proposal-store.service.ts` | Solo persistCompositionAgentProposal, getStoredProposal, assertPendingProposalAvailable, preview/apply/undo/dismiss y sus helpers de resultado/auditoría: binding, revisión, actor/owner/delegación, digest, consentimiento y recibo histórico. No reemplazar store ni recuperación |
| A1 tests | `D/__tests__/composition-agent-proposal-store.service.test.ts` | Añadir casos de binding/owner/fecha/CAS/recibo y compatibilidad; reutilizar tests nuevos específicos. No editar tests globales/QA |
| A2 SQL nuevo | **Un nuevo archivo de migración a numerar por el equipo principal**, nombre descriptivo `bind_composition_agent_proposals` | Solo tabla proposals, nueva tabla delegations, policies/grants y RPCs de agentes enumeradas abajo. Sin editar migraciones históricas ni aplicar la nueva. No reservar supabase/migrations completo |
| B HTTP auth | `A/_route-support.ts` | Extensión de authorizeCompositionAgentRequest + mapping de errores de agentes; actor autenticado y scope/owner/delegación vigentes. Conservar auth común y negar incertidumbre |
| B creación | `A/route.ts` | Persistir binding host y devolver bindingSHA/revisión; limitar body y correlacionar sesión/plan. No admitir envelope/grants desde cliente |
| B apply | `A/[proposalId]/apply/route.ts` | Body explícito Consent V1, revalidación y recibo; continuar la RPC actual, sin endpoint alternativo ni auto-apply |
| B preview | `A/[proposalId]/preview/route.ts` | Pasar actor/scope a lectura de proposal; solo gate de ownership/binding/revisión antes del compilador actual. No editar CSP/compiler/assets/fonts/preview |
| B undo | `A/[proposalId]/undo/route.ts` | Actor/delegación y referencia aplicada exacta; conservar precondición documental y ruta existente |
| B dismiss | `A/[proposalId]/route.ts` | Actor/delegación + resultado terminal verificable; no update privilegiado sin ownership |
| B delegación (nuevo, propuesto) | `A/[proposalId]/delegations/route.ts` | POST/DELETE exclusivos para otorgar/revocar delegación scoped; solo creador autenticado con acceso vigente. Nunca modelo. No crear antes del acuerdo |
| C cliente, equipo principal | `U/useCompositionAgentProposalController.ts` | Enviar consentimiento ligado al binding observado/revisión; distinguir recibo histórico de estado latest. Manejar ACK perdido por lectura autorizada, sin segunda aplicación |
| C tipo cliente | `U/composition-studio.types.ts` | Añadir bindingSHA/baseRevision al DTO de propuesta; conservar envelope V2. No modificar documento ni tipos generales |

No se pide `composition-agent-proposal.types.ts`, editor-patch, documento, gateway,
preview compiler/protocol, snapshots ni contratos de render para este lote R25.
Si integración descubre que alguno es imprescindible, el equipo principal amplía
la propuesta mediante **otra reserva específica**; no se considera autorizado aquí.

R23/R24 tienen un lote posterior independiente: solo `D/composition-agent.service.ts`
(proposeCompositionEdits/contexto y callback de recuperación),
`D/composition-agent-prompt.service.ts`, `D/composition-agent-model-output.types.ts`
y `D/composition-agent-provider.service.ts` para el contrato de planning/tool calls.
Requiere acordar antes el flujo del modelo y cuota compartida entre recovery/sesiones;
no supone que agrupar una lista plana cierre planning multi-step. No editar ni llamar
proveedores reales en esta entrega. No ampliar los ocho tipos permitidos.

### Tablas exactas y tipo de intervención propuestos

| Tabla | Cambio de schema pedido | Uso en transacción autorizada |
| --- | --- | --- |
| `public.video_composition_agent_proposals` | Binding/version/digest, base_revision, candidate hash, provider/policy refs, plan_json nullable y metadatos de consentimiento aplicado; propuestas nuevas inmutables | Reutilizar id/status/created_by/expiry y applied/undone actuales. Comparar binding sin reconstruirlo bajo otro owner/policy. Impedir escritura cliente de envelope/status/binding |
| `public.video_composition_agent_delegations` **nueva, propuesta** | id, proposal_id, draft_id, organization_id, binding_sha256, owner_user_id, reviewer_user_id, granted_by, permissions, issued_at, expires_at, revoked_at | Solo concesión explícita del creador; identidad compuesta org/draft/proposal/binding; permisos PREVIEW/APPLY/UNDO/DISMISS explícitos. Revocación/expiry/rol vigente revalidados bajo lock; sin delegación transitiva ni grants del modelo |
| `public.video_composition_drafts` | **Ninguno** | Reusar lock de draft ACTIVE y actualización current_version/last_changed_by que ya hace apply/undo; ningún schema/estado de CAP-027 añadido |
| `public.video_composition_draft_documents` | **Ninguno** | Leer version/hash base exactos y reusar append de nueva versión existente; sin tocar hash/formato/historial |
| `public.video_composition_draft_changes` | **Ninguno** | Auditoría AGENT por append actual: proposal/binding/actor/delegación/policy/model y consentimiento; sin prompt, HTML ni URLs |
| `public.organization_user_roles` y `public.profiles` | **Ninguno**, solo dependencia de lectura | Comprobar rol/membresía vigente del actor/grantor/reviewer con la autoridad que acuerde el equipo; profile global por sí solo no demuestra permiso tenant |

RPCs concretas propuestas dentro de ese único archivo SQL futuro:

- Extender `public.apply_video_composition_agent_proposal` y
  `public.undo_video_composition_agent_proposal` existentes: binding/consent,
  actor/owner/grant vigentes, revisión/hash y recibo histórico. No nueva ruta de mutación documental.
- Preparar `public.read_video_composition_agent_proposal` (lectura autorizada de
  binding/estado/recibo por IDs exactos), `public.dismiss_video_composition_agent_proposal`
  y `public.set_video_composition_agent_delegation` (otorgar/revocar).
  No implementadas ni publicadas aquí; firmar parámetros/results tras acuerdo.
- Consultar/escribir metadatos de consent/receipt en la tabla proposals existente;
  no introducir otro ledger/outbox de aplicación. Grants de estas RPCs solo backend.

### Garantías durables pendientes y prueba real requerida

| Garantía | Condición exigida en integración principal | Prueba pendiente, separada de unitarios |
| --- | --- | --- |
| Ownership/delegación | Actor de sesión autenticada; creador válido o reviewer con grant explícito del binding, rol/tenant/expiry/revocación actuales; misma autoridad en preview/apply/undo/dismiss/read/replay | Usuario distinto sin grant, grant de otro tenant/draft/proposal/binding, grant revocado/caducado y pérdida de rol/membresía; carrera revoke vs apply |
| Base sin ABA | Bajo lock comparar **version y hash**, tanto stored binding como latest; append baseRevision+1 únicamente | Restaurar hash idéntico en otra revisión, edición simultánea humana y dos applies concurrentes |
| TTL fail-closed | Fecha tipada/válida, issuedAt/expiresAt server-owned, ≤15 min; recheck con reloj DB **después de adquirir locks** antes del append. Rechazar binding legacy/fecha inválida | Expiración durante espera de lock, borde exacto y desfase de reloj host/DB; fuente de reloj/minting de binding por acordar |
| Policy/model/hash | Resolver policy id/version/SHA actual independiente del modelo; comprobar SHA real del binding/envelope/plan y target simulado; model/provider informativos pero ligados al consentimiento | Policy revocada/inexistente/cambiada, payload/model/owner/plan/diff/inversa alterados, canonicalización host↔DB y candidate hash diferente |
| Confirmación | confirmed=true para binding exacto; refuerzo según riesgo recalculado, actor/tiempo/delegación de servidor | Consent ausente/falso, digest sustituido, refuerzo omitido y uso de consent de otro proposal/actor |
| Anti-replay/atomicidad | Lock proposal + draft + grant/autoridad pertinente en orden común; verificar primero auth vigente. Consumo de consentimiento/proposal + append + audit + recibo en una transacción; no writes parciales | Dos consumidores, ACK perdido, fallo entre append y status/audit, intentos reutilizados tras UNDO/DISMISS/EXPIRED |
| Replay histórico | Terminal APPLIED/UNDONE solo devuelve recibo original ligado a binding y actor autorizado; cero nuevo append. latest se obtiene por lectura aparte | Replay tras edición posterior, TTL transcurrido y revocación del delegado; distinguir receipt histórico de documento actual |
| Sin bypass bajo service role | Definir quién puede escribir proposals/delegations y verificar grants/RLS/constraints compuestos; RPC service-role recibe actor exclusivamente del host verificado | REST/SQL anon/authenticated/service-role, referencias cross-tenant y mutación directa de owner/envelope/status |
| Recovery durable | Leer estado/recibo por mismo proposal/binding tras incertidumbre; no reconstruir una propuesta ni asumir rollback por un error HTTP | Desconexión antes/después del commit y repetición de consulta con sesión/grants actuales |

La autorización Auth Bridge y `organization_user_roles` deben tener una fuente de
vigencia acordada por el equipo principal: si son un espejo sin garantía de
revocación, validar un JSON local o solo un JWT anterior no acredita autorización
vigente. No ampliar unilateralmente auth/membership del proyecto para resolverlo.

Compatibilidad propuesta para revisión: no inventar binding/consent de propuestas
legacy PENDING; rechazar nuevas mutaciones legacy y pedir regeneración. Conservar
historia APPLIED/UNDONE como historia legacy explícita, sin presentarla como recibo
V1 autenticado. `created_by` nulo no transfiere ownership a otro reviewer. No cambiar
flags ni rollout para forzar esta transición; el equipo decide preparación/migración.

Decisiones por aceptar antes de reservar: lotes A/B/C concretos, formato/minting de
digest y timestamps, fuente vigente de auth/delegación y comportamiento de historia
legacy. El único criterio de ownership ya acordado es creador + delegación explícita.

Validación local de esta segunda entrega: **73/73 tests** en diez archivos,
compilación dirigida exit 0. Son los 63 previos + 10 del contrato; no nueva evidencia
DB/HTTP/browser/renderer. Un test del contrato acepta deliberadamente SHA/owner
de forma válida sin autenticarlos, para evitar atribuirle una garantía durable.
TypeScript global no se reejecutó: siguen registrados los cuatro fallos Buffer
previos de CAP-027, sin editar sus archivos. Comandos reproducibles en §Comandos.
R23/R24 permanecen parciales; R25 añade contrato local revisable y sigue pendiente
de integración durable. **CAP-025 no completada**; no es «implementación completada,
QA pendiente» mientras falten esos requisitos.

## Tercera entrega: presupuesto previo de entradas JSON

Continuación del 2026-10-06, limitada al paquete exclusivo. Se conserva checkout
`stagin-2` / `96a191b9` y los cambios paralelos CAP-022. Reserva de continuación:
los tres archivos creados por CAP-025 `composition-agent-read-session.service.ts`,
`composition-agent-plan.service.ts` y `composition-agent-integration.contract.ts`,
más esta nota. No se reserva ni modifica ningún archivo store/API/DB. Archivos
nuevos: `composition-agent-input-budget.service.ts` y
`__tests__/composition-agent-input-budget.service.test.ts`.

Brecha corregida: las solicitudes de lectura y planes medían bytes mediante
`JSON.stringify`; el decoder de integración recorría primero `z.json()`. Una
entrada cíclica/profunda podía fallar fuera del contrato de límites, y un objeto
JavaScript con getter/`toJSON` podía ejecutar código durante la medición. El nuevo
preflight recorre JSON plano antes de esos schemas, mide exactamente bytes UTF-8
escapados sin crear el payload serializado ni invocar getters/serializadores.
Mantiene 4 KiB para requests, 16 KiB para planes y 128 KiB para DTO; añade techos
estructurales de **32 niveles** (raíz profundidad 0) y **100 000 nodos** (valores y
claves de objetos; cada aparición de una referencia se contabiliza). Ningún techo
puede ampliarse desde entrada modelo/cliente.

Contrato auxiliar: `assertCompositionAgentJsonInputBudget(input, maxBytes)` devuelve
bytes si admite la entrada. Solo acepta objetos planos/arrays densos y valores JSON
finitos; rechaza ciclos, campos undefined, sparse arrays, propiedades extra de arrays,
símbolos, accessors, objetos de clases, propiedades no enumerables y serializers.
`CompositionAgentInputBudgetError` distingue límite BYTES/DEPTH/NODES de JSON
inválido. Cada consumidor conserva su código previo de límite; los errores de
JSON inválido no se convierten en éxito ni se reparan mediante coerción.

Las solicitudes rechazadas siguen consumiendo intentos en la sesión, sin emitir
bytes ni iniciar trabajo del dominio. Simular una entrada rechazada conserva el
documento/hash y no retorna candidato parcial. No cambia allow-list, consentimiento,
policy/model ni ownership. Estos decoders siguen sin verificar digests/autenticar
actores ni constituir prueba de una transacción durable.

Pruebas añadidas: diez casos cubren equivalencia con codificación JSON UTF-8 real
(escapes, caracteres multibyte, surrogates y números), bordes exactos de límites,
profundidad extrema, nodos/aliases, ciclos/no-JSON, cero callbacks, budgets host
inválidos y la conexión a lectura/plan/tres decoders. Primera ejecución: 82/83;
la expectativa nueva para un presupuesto de cero era incorrecta (debe ser
RangeError de configuración host). Corregida la prueba, compilación dirigida exit 0
y **83/83 tests en once archivos**. Los nueve tests fake de store y dos brechas
caracterizadas permanecen iguales. No hay nueva evidencia DB/HTTP/browser ni QA
formal; TypeScript global no se reejecuta y los errores Buffer CAP-027 no se editan.

Límites de esta evidencia: el helper protege entradas JSON ya decodificadas de
estos módulos, no el tamaño del cuerpo HTTP antes de parsearlo, la cuota de una
organización ni ejecución arbitraria de proxies JavaScript. El documento y grants
del host mantienen el contrato previo de confianza/validación. El equipo principal
debe integrar límites de transporte y cuota/auth/revisión vigente en los archivos
exactos de la propuesta anterior; no se agregan rutas ni persistencia aislada.

Avance por requisito: **R23 parcial**, lectura local con presupuesto previo robusto,
pendiente integración host/catálogo integral; **R24 parcial**, simulación multi-step
local protegida y validada, pendiente wiring del agente/revisiones durables;
**R25 parcial**, DTO acotados, pendiente binding verificable, delegación vigente,
consentimiento y consumo/recibo atómicos. La integración final continúa a cargo del
equipo principal. **CAP-025 no completada**, tampoco «solo QA pendiente».

## Comandos y resultados

Baseline inicial:

- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.hyperframes-test.json --outDir .tmp/cap025-tests --incremental false`:
  exit 1, cuatro TS2345 previos de Buffer<ArrayBufferLike>/Buffer<ArrayBuffer> en
  `composition-text-contract.test.ts` y `composition-text-paint-mask-capture.test.ts`.
  No editar tests/QA de CAP-027 para resolverlos.
- Ejecución inicial de los seis tests existentes sobre ese output: 14 casos pasan;
  dos archivos (model-output/recovery) no cargan por alias `@/lib/server/outbound-http`.
  Se corrige únicamente el runner temporal de esta entrega.

Compilación dirigida y runner temporal bajo `apps/web/.tmp/cap025/` (ignorados por
Git, sin editar configuración compartida). Config exacta para reproducir:

```json
{
  "extends": "../../tsconfig.hyperframes-test.json",
  "compilerOptions": { "outDir": "build", "incremental": false },
  "include": ["../../src/domains/production/composition-editor/__tests__/composition-agent-*.test.ts"],
  "exclude": ["../../node_modules"]
}
```

`resolve-alias.cjs` (runner Node v26.7.0; solo resolución a módulos compilados,
sin mocks que sustituyan lógica de dominio):

```js
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return {
    url: pathToFileURL(path.join(__dirname, 'build', specifier.slice(2) + '.js')).href,
    format: 'commonjs', shortCircuit: true
  };
  return nextResolve(specifier, context);
} });
```

Comandos ejecutados desde raíz:

```powershell
node node_modules/typescript/bin/tsc -p apps/web/.tmp/cap025/tsconfig.json
$cap025Tests = Get-ChildItem -LiteralPath 'apps/web/.tmp/cap025/build/domains/production/composition-editor/__tests__' -Filter 'composition-agent-*.test.js' | ForEach-Object { $_.FullName }
node --require ./apps/web/.tmp/cap025/resolve-alias.cjs --test $cap025Tests
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json --incremental false
git diff --check
```

Resultado dirigido de la primera entrega: compilación exit 0, **63/63 tests pasan** en nueve
archivos: 27 originales + 36 nuevos. Desglose nuevos: 3 snapshot, 12 sesión,
12 plan, 9 store-contract. Dos casos de store-contract son **caracterización de
brechas**, no garantías aprobadas. El fake RPC modela outcomes y conteo de llamadas,
no locks/atomicidad/grants ni DB durable. Recovery/proveedor solo usan callbacks
simulados/config builders. Simulación prueba documento congelado, hash inmutable,
reversión exacta y cero fetch en éxito/fallo. No hay red ni proveedor real en tests.

TypeScript web: **exit 1**, los mismos cuatro TS2345 previos de Buffer en los dos
tests de CAP-027 identificados en baseline; no aparecen diagnósticos CAP-025.
No se declara build global verde. `git diff --check` pasa para archivos tracked;
warnings normales LF/CRLF de Git, sin errores de whitespace. Los archivos nuevos
de esta entrega se verifican también con `git diff --no-index --check` frente a
un archivo vacío temporal, sin añadirlos al index ni tocar cambios paralelos.

## Riesgos y estado por requisito

- R23 parcial: paquete local implementado/validado; faltan catálogo integral e integración
  host de grants/budgets. Los límites locales no son cuotas de organización.
- R24 parcial: paquete de simulación implementado/validado; falta wiring de planificación del
  agente y reproducibilidad end-to-end sobre revisiones durables.
- R25 parcial: garantías existentes auditadas; cambios compartidos requieren
  acuerdo, no se cierran con una implementación aislada.
- Sin QA formal, migraciones, flags, despliegue, credenciales ni proveedores reales.
  No declarar CAP-025 completa ni «solo QA pendiente».
