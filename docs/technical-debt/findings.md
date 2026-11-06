# Registro priorizado de hallazgos

Corte B2026-11-04. Véanse [cobertura](coverage.md), [plan](remediation-plan.md) y
[verificaciones](verification.md). Se conservan IDs históricos TD-01–25;
TD-26–31 son nuevos en este corte. Todos los responsables están **por asignar**.

## Escala y estados

Severidad S: 4 = autoridad/datos críticos, 3 = correctitud o entrega seriamente
afectada, 2 = degradación operativa/mantenimiento, 1 = mejora acotada.
Exposición E: 3 = entrada externa, 2 = usuario autenticado/operación normal,
1 = herramienta local/condición excepcional. Alcance A: 3 = transversal,
2 = dominio, 1 = función. Frecuencia F: 3 = cada ejecución, 2 = concurrencia/volumen,
1 = condición excepcional. Criticidad C: 3 = identidad/publicación/integridad,
2 = autoría/operación, 1 = auxiliar. La tabla registra el vector S/E/A/F/C.

P0: autoridad o integridad crítica con exposición inmediata demostrada que exige
contención. P1: frontera de confianza insegura condicionada o fallo grave de flujo
crítico/compuerta; validar/atender antes de cambios dependientes. P2: defecto
acotado o deuda estructural confirmada, ejecución después de controles críticos.
P3: oportunidad opcional sin incumplimiento significativo. No hay P0 demostrado
en este corte; **no equivale a ausencia de riesgos críticos en áreas pendientes**.
La prioridad combina el vector y dependencias, sin sumar esfuerzo ni fingir una
probabilidad estadística. Incertidumbre productiva se conserva, no rebaja severidad.

Estados: **identificado** (evidencia inicial), **validado** (criterio reproducido o
confirmado estáticamente), **planificado** (corrección definida), **en curso**,
**bloqueado** (dependencia concreta), **resuelto pendiente de verificación** y
**cerrado** (aceptación acreditada). No usar «implementado» como equivalente a cierre.
Al corte B2026-11-04 los 12 hallazgos estaban planificados, sin implementación.
Los seguimientos fechados posteriores registran ejecución y aceptación por unidad;
evidencia y exposición se califican aparte. Estimaciones en días de ingeniería
de una persona familiarizada con el dominio, sin tiempos de aprobación/despliegue.

| ID | Tipo | Prioridad | S/E/A/F/C | Evidencia | Esfuerzo / confianza |
|---|---|---|---|---|---|
| TD-26 | Vulnerabilidad potencial condicionada | P1 | 4/2/3/1/3 | Rama insegura reproducida con dependencias simuladas; explotación no demostrada | 2–5 d / media |
| TD-28 | Defecto de concurrencia | P1 | 3/2/2/2/3 | Interleaving estático; SQL real pendiente | 2–4 d / media |
| TD-08 | Deuda de QA / fallo local de compuerta | P1 | 3/1/3/3/2 | verify falla en ESLint local; CI limpio por verificar | 1–3 d / media |
| TD-06 | Deuda de datos/despliegue | P1 | 3/1/3/2/3 | Cuatro grupos de versiones duplicadas y tres SQL sin versión admitidos | 3–8 d / baja |
| TD-27 | Deuda de límites / disponibilidad | P2 | 3/3/3/2/2 | Dos parsers consumen 64 KiB para rechazar 1 KiB | 2–4 d / media |
| TD-29 | Defecto condicionado por volumen | P2 | 2/2/2/2/2 | Agregaciones sin paginar; límite REST efectivo desconocido | 2–4 d / media |
| TD-30 | Defecto de manejo de errores | P2 | 2/2/2/2/2 | Errores de consultas convertidos a cero/vacío | 1–3 d / alta |
| TD-31 | Deuda de pruebas | P2 | 3/1/3/3/3 | Compuertas no invocan suites críticas completas; SQL aislado parcial | 3–6 d / media |
| TD-12 | Deuda de acoplamiento / compuerta | P2 | 2/1/2/3/2 | Madge informa 11 ciclos; incluye imports de tipos | 2–5 d / media |
| TD-10 | Deuda estructural | P2 | 2/2/2/3/2 | Orquestador UI de 4.195 líneas reúne guardado/preview/edición/render | 5–12 d / baja |
| TD-15 | Deuda operativa | P2 | 2/1/2/3/2 | Log y error crudos en job BASE, logger seguro de adopción parcial | 2–5 d / media |
| TD-20 | Deuda documental | P2 | 2/1/3/3/2 | Contexto contradice rutas reales; métricas históricas divergentes | 1–3 d / alta |

## TD-26 — Cookies de presentación como autoridad de fallback

- **Seguimiento posterior al corte:** en curso. F1.1 definió el contrato y F1.2
  corrigió el resolver con aceptación local; los helpers privilegiados (F1.3),
  permisos SQL y aceptación de ambiente permanecen pendientes. El tablero vigente
  está en [el OpenSpec de autoridad](../../openspec/changes/tenant-authorization-authority/tasks.md).
  Los hechos y reproducciones siguientes conservan la base histórica, sin acreditar cierre.
- **Estándar:** engineering-practices §§5/7 y security-and-tenancy: identidad, rol y
  organización en servidor; el payload no concede autoridad.
- **Hecho:** `apps/web/src/lib/server/tenant-context.ts:159–170` conserva todas las
  organizaciones de `cf_user_orgs` cuando `organization_ids` del JWT está vacío.
  En `:194–209`, una consulta exitosa sin fila de rol hace fallback al rol de esa
  cookie. `mapOrganizationRoleToPlatformRole('owner')` devuelve ADMIN.
  `apps/web/src/app/login/auth-bridge-helpers.ts:184–191` escribe la cookie con
  `httpOnly:false`. HttpOnly tampoco sustituiría firma/verificación de autoridad.
- **Reproducción:** [reproduce.mjs](../../openspec/changes/audit-technical-debt-2026-11/reports/reproduce.mjs)
  ejecuta el resolver real transpiliado con un usuario firmado simulado CONSTRUCTOR,
  fila de rol ausente y cookie owner: devuelve ADMIN. Con lista firmada vacía
  admite org-ajena de cookie. No usa credenciales ni Next/BD reales.
- **Precondiciones:** falta de fila de rol y/o sesión con membresías vacías.
  El login actual intenta sincronizar roles; no se probó que estas condiciones
  existan en producción. Si la consulta falla, el resolver lanza error, no usa ese
  fallback. Una lista firmada no vacía sí filtra IDs: no afirmar bypass general.
- **Tercera rama confirmada localmente:** `artifact-action-auth.ts:114–143`
  agrega `activeOrgId` al filtro service-role sin cruzarlo con membresías firmadas
  cuando no hay TenantContext. `getAuthorizedArtifactAdmin` pasa la cookie
  `cf_active_org` como fallback; vaciar la cookie de navegación `cf_user_orgs`
  hace que el resolver no obtenga contexto aunque el JWT tenga org-propia.
  La reproducción ejecuta ese helper real con contexto null, cookie org-ajena y
  JWT simulado con solo org-propia: la consulta incluye ambas organizaciones.
  No necesita lista firmada vacía ni fila de rol ausente en esta rama. El retorno
  de BD es simulado: no acredita acceso real ni explotación HTTP.
- **Impacto:** elevar permisos en organización propia si falta fila; en la rama de
  membresías vacías, contexto de organización arbitraria. Rutas que confían en
  TenantContext y los helpers de artefacto pueden operar con service-role. Causa raíz: mezclar metadatos UI
  editables con fuente de autorización. Dependencias: C01 y escritores de roles.
- **Corrección:** negar por defecto sin membresía y rol verificables; resolver
  membresías/roles en autoridad server-side, separar el DTO de navegación y
  diseñar compatibilidad/migración de sesiones antiguas sin conceder autoridad.
- **Aceptación:** cookie alterada no cambia permisos; listas ausentes/vacías y fila
  ausente no autorizan; usuario válido conserva acceso; caída de autoridad produce
  error seguro; prueba HTTP con service-role simulado y SQL aislado acredita cero
  escrituras ajenas. Riesgo: bloqueo de sesiones legacy; reversión de UI posible,
  nunca restaurar el fallback inseguro como rollback. Estimación excluye backfill remoto.

## TD-28 — Guardado de borrador separado de la reserva de publicación

- **Estándar:** engineering-practices §§5/6/9: atomicidad, concurrencia, estados parciales.
- **Hecho:** `apps/web/src/app/api/save-draft/route.ts:52–79` lee `publish_step/status`
  y luego hace upsert incondicional por artifact_id. `publish/route.ts:119–140`
  reserva con predicado sobre READY/publish_step. Un guardado ya iniciado puede
  pasar la lectura, otra solicitud encolar, y el upsert escribir DRAFT después.
  El claim outbox exige READY en
  `supabase/migrations/20260910130000_durable_publication_outbox.sql:62–73`.
- **Consecuencia deducida:** puede quedar QUEUED/DRAFT sin claim o una entrega en
  curso basada en un snapshot distinto al borrador visible. No se ejecutó carrera
  de PostgreSQL ni se constató pérdida real. El trigger de temario
  `20261009010000_provided_syllabus_imports.sql:256–309` comprueba versiones;
  no es un cerrojo general de borradores cuando el modo no es PROVIDED_SYLLABUS.
- **Causa:** validación de estado fuera de la escritura atómica. Dependencias:
  outbox, guard de syllabus, idempotencia de inbox y semántica de republish.
- **Corrección/aceptación:** RPC transaccional o actualización condicionada con
  control de versión para guardar/reservar; conflicto 409 si cambió el estado.
  Dos conexiones con barreras prueban ambos órdenes save/publish, worker activo,
  timeout y reintento; ningún DRAFT/QUEUED inoperable ni cambio silencioso del payload
  reservado. Preservar hash/idempotency key y test de republish. Rollback: desactivar
  edición durante entrega y conservar outbox; no borrar filas ni enviar de nuevo
  sin reconciliar. Esfuerzo supone migración aditiva y fixtures existentes.

## TD-08 — La compuerta local se detiene en configuración ESLint

- **Seguimiento F3.5.e (2026-11-05):** tras eliminar ciclos y resolver alias,
  verify:pr completo aprueba localmente. La aceptación de CI Linux sigue
  pendiente; [evidencia](../../openspec/changes/resolve-module-graph-aliases/reports/context-F3.5e.md).
- **Seguimiento posterior al corte:** F0.2 restauró lint local y su baseline por
  huellas, con canarios y contraste limpio Node 22. Tipos fríos requieren heap
  explícito de 4 GiB; el gate alcanza ahora los ciclos pendientes de TD-12.
  TD-08 permanece resuelto pendiente de aceptación en CI Linux con lifecycle
  scripts. Evidencia en [restauración de lint](../../openspec/changes/restore-lint-gate/reports/context-F0.2.md).

- **Estándar:** testing.md y engineering-practices §§9/14: gates verificables sin
  ocultar fallos ni relajar reglas.
- **Evidencia nueva:** `npm run verify` devuelve 2 por regla
  `react-hooks/immutability` sin plugin disponible para ese objeto de configuración;
  [verify-product.log](../../openspec/changes/audit-technical-debt-2026-11/reports/verify-product.log).
  `apps/web/eslint.config.mjs:8–25` además degrada varias reglas a warning y lint
  usa `--quiet`: no acredita ausencia de warnings ni bloquea nuevos casos de esas reglas.
- **Límite/causa:** el fallo existe en dependencias instaladas del checkout; la
  resolución/config efectiva requiere reproducción tras npm ci en ambiente limpio.
  No atribuirlo a CI ni inventar corrupción de node_modules. Manifests y árbol de
  dependencias son evidencia en lint-dependencies.log.
- **Corrección/aceptación:** reproducir con lockfile en CI aislado; corregir carga
  de plugin compatible. Conservar baseline explícito de warnings y bloquear nuevas
  infracciones por archivos/diff sin ignorar reglas globalmente. npm ci, lint y
  typecheck deben pasar y un canario de regla debe fallar. Reversión de configuración
  compatible, nunca desactivar el gate. No confundir EPERM del sandbox con este fallo.

## TD-06 — Reproducibilidad del historial SQL aún condicionada

- **Estándar:** engineering-practices §5; no renombrar colisiones sin reconciliar.
- **Hecho revalidado:** `scripts/check-migration-versions.mjs:8–36` admite cuatro
  grupos duplicados (20240117: siete archivos; 20260721120000, 20260825120000 y
  20260826120000: dos cada uno) y tres dumps sin versión. Guard aprobado con 214 SQL.
  Pasar el guard congela deuda, no prueba reset ni equivalencia del esquema aplicado.
- **Impacto/causa:** ambigüedad del historial para recrear/actualizar ambientes.
  Duplicados heredados; deriva remota no demostrada. Auditoría DB de octubre ya
  advertía que BD.sql no contiene funciones/RLS/índices completos.
- **Corrección/aceptación:** inventariar schema_migrations por ambiente con aprobación,
  contrastar checksums y esquema efectivo; acordar baseline o reparación explícita.
  Reconstrucción descartable, upgrade desde snapshot y pruebas RLS/FK/RPC deben
  producir el contrato esperado. Cero colisiones sin conciliación documentada;
  no exigir renombres a ciegas. Rollback por restauración del entorno descartable
  y plan de forward-fix/backup aprobado para cada ambiente. Esfuerzo de baja confianza
  hasta conocer ambientes y divergencias; ninguna operación remota en esta fase.

## TD-27 — Límites JSON comprobados después de materializar el cuerpo

- **Estándar:** engineering-practices §§6/8: tamaños y memoria acotados.
- **Hecho reproducido:** `api-contract.ts:69–74,102–107` usa request.text() antes del
  límite efectivo. Sin Content-Length ambos parsers leen 65.536 bytes para rechazar
  un máximo de 1.024; ver reproduce.log. El encabezado puede faltar, no es prueba
  del tamaño real. SCORM `upload/route.ts:57–64` usa formData antes de validar el File;
  webhook `supabase/functions/heygen-hyperframes-webhook/index.ts:29–32` hace arrayBuffer.
  Estas dos variantes solo se inspeccionaron estáticamente.
- **Impacto:** el contrato limita aceptación, pero no memoria consumida al rechazar.
  Exposición/techo efectivo dependen del proxy/plataforma; no se midió DoS ni RSS.
  Causa: reutilizar parsers materializantes para imponer límites de transporte.
- **Corrección/aceptación:** lector incremental con cancelación y presupuesto;
  upload directo firmado para SCORM o parser multipart con límite real. Pruebas
  con body fragmentado, sin longitud, UTF-8, abort y límite exacto; medir bytes leídos,
  cancelación y RSS con concurrencia representativa antes de fijar un SLO de memoria.
  No romper HMAC de webhook ni clientes multipart. Rollback con límite efectivo
  en gateway y compatibilidad del contrato; migración de upload requiere flag.

## TD-29 — Dashboard agrega un universo potencialmente truncado

- **Estándar:** engineering-practices §§5/8: paginación real y agregaciones correctas.
- **Hecho:** `admin-dashboard/dashboard-data.ts:213–249,289–310` obtiene IDs de artefactos
  en generación, renders y created_at de ocho semanas sin paginar y agrega en JS.
  El contador exacto usa consultas distintas. No hay garantía de recuperar todas
  las filas frente a un máximo de respuesta PostgREST.
- **Impacto condicionado:** tendencia y «en progreso» pueden subcontar para tenants
  grandes; no se conoce el límite remoto ni cardinalidad actual. Causa: agregación
  cliente/servidor web sobre resultados REST acotados, no un N+1 demostrado.
- **Corrección/aceptación:** agregado SQL tenant-aware (distinct/unión y buckets)
  con índices justificados por EXPLAIN, o paginación consistente si volumen lo permite.
  Fixture superior al máximo REST configurado debe coincidir con SQL de referencia;
  cero discrepancias en matriz de estados/tenant. Medir latencia y filas antes de
  elegir meta de p95. Rollback al lector anterior con estado de datos incompletos,
  sin presentarlo como resultado exacto.

## TD-30 — Errores de consultas se presentan como cero o lista vacía

- **Seguimiento 2026-11-05:** en slides/jobs GET, la consulta secundaria de
  material_components toma solo data y proyecta assets vacíos si falla.
  Inspeccionado durante F1.3.c.3.c.5.b; pendiente de canario y corrección de
  indisponibilidad en esta unidad de deuda. No cambia el corte B2026-11-04.
- **Estándar:** engineering-practices §§3/10: errores explícitos y operación observable.
- **Hecho:** en `dashboard-data.ts:123,129,142` solo se toma count y se retorna cero;
  `:175,187,204,216,227,238,248` toma data sin error y devuelve lista vacía.
  Un error PostgREST resuelto como `{error,count:null,data:null}` queda indistinguible
  de no tener cursos. No se requiere que Promise.all rechace: esos errores son valores.
- **Impacto/causa:** decisiones operativas basadas en indicadores falsamente vacíos;
  pérdida de señal de incidentes por normalización silenciosa.
- **Corrección/aceptación:** contrato de disponibilidad por sección, logger seguro
  correlacionado y UI degradada. Inyectar fallos por consulta: ningún fallo aparece
  como cero válido; éxito vacío sí muestra cero; no filtrar detalles internos.
  Dependencia C02 y TD-29; reutilizar lector sin mezclar UI con SQL. Rollback de UI
  conserva señal de indisponibilidad. Estimación incluye tests de errores y UI.

## TD-31 — Compuertas funcionales y de datos incompletas

- **Estándar:** testing.md; QA proporcional de permisos, fallos, concurrencia y regresiones.
- **Hecho:** root `package.json:88`, `scripts/quality/gate-plan.mjs` y
  `.github/workflows/quality.yml` no invocan las suites completas test:auth-bridge,
  test:curation, test:publication o test:materials-generation declaradas en web.
  Hay pruebas relacionadas dentro de seguridad/coverage-gaps; no son ausencia total
  de tests. CI agrega QA visual y SQL PGlite de grupos anidados, pero no reconstruye
  todo Supabase con roles/RLS de aplicación.
- **Impacto/causa:** una regresión fuera de esa selección puede llegar al merge con
  compuertas verdes. Selección manual de suites sin matriz explícita de riesgo.
  No se afirma que un test concreto esté huérfano sin rastrear sus imports.
- **Corrección/aceptación:** matriz flujo→suites→CI, suites de contratos críticas en
  gate y tests SQL tenant/rol/concurrencia en ambiente descartable. Sembrar regresiones
  representativas y acreditar fallo del gate; la lista de omisiones debe quedar en
  cero o tener exclusión explícita por evidencia de equivalencia. Medir duración
  antes de fijar presupuesto de CI. Depende de TD-08/06; no bloquear el test local
  de una función por falta de DB. Rollback de scheduling mantiene suites críticas.

## TD-12 — Once ciclos reportados por el grafo de dependencias

- **Estado actualizado (2026-11-05): resuelto pendiente de verificación en CI.**
  F3.5.e conserva 8.923 aristas, cero ciclos/desconocidos y dos casos de bundler
  comprobados. Trece canarios y grafos iguales en Node 24/22; verify:pr aprobado.
  [Continuidad y límites](../../openspec/changes/resolve-module-graph-aliases/reports/context-F3.5e.md).
  El cierre global conserva aceptación de CI/integración en F5.
- **Seguimiento F3.5.d1 (2026-11-05):** descriptor neutral de QA;
  [continuidad](../../openspec/changes/decouple-controlled-render-descriptor/reports/context-F3.5d1.md).
  Cero ciclos/componentes, verify:pr completo aprobado. TD-12 sigue abierto:
  F3.5.e debe corregir la resolución de alias y clasificar los 582 avisos.
- **Seguimiento F3.5.c (2026-11-05):** autoridad HTTP narrativa desacoplada;
  [continuidad](../../openspec/changes/decouple-narrative-http-authority/reports/context-F3.5c.md).
  Gate actual: siete ciclos/582 avisos, una componente QA. Cuatro emisiones
  CommonJS idénticas, HyperFrames y 59 pruebas dirigidas aprobadas; TD-12 abierto.
- **Seguimiento F3.5.b (2026-11-05):** contratos de documento/clip/fuentes
  separados; [continuidad](../../openspec/changes/decouple-composition-document-contracts/reports/context-F3.5b.md).
  Gate actual: ocho ciclos/582 avisos, dos componentes. Equivalencia exacta de
  capturas y HyperFrames completo aprobados; TD-12 permanece abierto.
- **Seguimiento F3.5.a (2026-11-05):** extracción neutral de validación de
  captions aprobada; [continuidad](../../openspec/changes/decouple-caption-text-validation/reports/context-F3.5a.md).
  Gate actual: diez ciclos/582 avisos, tres componentes y ninguna de captions.
  Presets/captions 57/57 y HyperFrames completo aprobados; TD-12 sigue abierto.
- **Seguimiento F0.3 (2026-11-05):** clasificación local completa en
  [continuidad](../../openspec/changes/classify-module-graph/reports/context-F0.3.md):
  cuatro componentes con 26 módulos/46 aristas (12 borradas y 34 conservadas en
  emisión aislada). Gate: once ciclos/582 avisos; 579 referencias resueltas por
  TS y tres referencias de CSS/bundler clasificadas. Sin cierre de TD-12.
- **Estándar:** engineering-practices §4, bajo acoplamiento y capas claras.
- **Evidencia:** architecture:cycles termina 1; Madge procesa 2.262 archivos y reporta
  11 ciclos y 577 warnings; [salida completa](../../openspec/changes/audit-technical-debt-2026-11/reports/cycles.log).
  Ejemplo: composition-document.types ↔ composition-caption-effects-plan.
- **Límite:** hay aristas import type (por ejemplo CaptionCue en effects.service);
  no se equiparan los 11 ciclos a errores de inicialización runtime. Warnings
  impiden presentar el grafo como exhaustivo. La compuerta sí rechaza este resultado.
- **Causa/solución:** contratos que dependen de planes/servicios y referencias
  bidireccionales en QA/handlers. Clasificar cada ciclo y warning; extraer contratos
  neutrales y funciones puras donde eliminen dependencia real. Aceptación: comando
  aprobado, clasificación reproducible de warnings y casos afectados con suites
  de captions/documento/QA; no ampliar ignores para ocultar ciclos. Reversión por
  extracción pequeña, sin cambiar formato ni hashes.

## TD-10 — Orquestador UI concentra ciclos de vida de varias capacidades

- **Estándar:** engineering-practices §§3/4: responsabilidades separadas.
- **Hecho:** `materials/components/composition-editor/NativeCompositionPreview.tsx`
  tiene 4.195 líneas en inventory.json; estados desde :303/:423, savePatch :1971,
  executeSavePatch :2047, acciones de captions/assets :2348–2602 y edición/undo después.
  Las extracciones previas existen; el problema no se deduce solo del tamaño.
- **Impacto:** modificar guardado, reproducción, assets y render comparte estado y
  efectos, aumentando radio de regresión y costo de caracterización. Causa probable:
  crecimiento de capacidades en un coordinador; historia no investigada exhaustivamente.
- **Corrección/aceptación:** caracterizar flujos y extraer un controlador cohesivo
  a la vez (persistencia/recuperación; inserciones; preview/render). El coordinador
  no implementa HTTP/política de rebase ni ciclos propios de render; pruebas de
  cambios locales durante ACK, conflicto, cancelación y replay permanecen verdes.
  Medir responsabilidades y escenarios aislables, no líneas eliminadas. Depende
  de TD-12/31; rollback por extracción sin alterar contrato versionado.

## TD-15 — Logger seguro no cubre todo el pipeline

- **Estándar:** engineering-practices §§7/10: logs seguros correlacionados.
- **Hecho revalidado:** `generate-artifact-background.ts:150` registra folderUrl;
  :534 registra error crudo y :546 devuelve getErrorMessage(error).
  `operational-logger.ts` dispone de redacción, límites y correlationId, pero el
  flujo BASE muestreado no lo adopta como frontera uniforme.
- **Límite:** no se inspeccionaron logs reales ni se demuestra secreto filtrado.
  folderUrl es metadato potencialmente sensible, no necesariamente URL firmada.
- **Corrección/aceptación:** eventos de inicio/fallo/fin con runId/correlación,
  código seguro hacia consumidor y diagnóstico redactado. Canarios sintéticos
  de email/token/URL firmada y errores de SDK no aparecen en salida; incidentes
  se pueden correlacionar sin prompts/PII. Métricas/alertas/retención requieren
  inventario de backend antes de metas. Rollback conserva redacción. No migrar
  todas las llamadas console por estética; priorizar datos y fronteras sensibles.

## TD-20 — Fuentes históricas no describen el checkout actual

- **Estándar:** documentation.md y protocolo de sincronización: código como evidencia.
- **Hecho:** contexto inicial decía que Express exponía render/build y enumeraba
  rutas worker, mientras `apps/api/src/server.ts:35–39` solo monta health y el
  inventario no contiene esas rutas. README ya advertía su retiro. La ruta debug
  soflia también estaba documentada sin archivo. Marzo afirmaba deuda 3–5%,
  cero any y ausencia de god files; septiembre publica 64% de progreso/36% residual;
  esas bases y métodos no son una métrica actual comparable.
- **Impacto/causa:** onboarding y decisiones basados en fuentes de fechas distintas;
  estados históricos usados fuera de su corte.
- **Acción documental de esta fase:** enlazar el corte vigente, preservar historial
  y corregir las rutas comprobadas en contexto. No cierra todo TD-20: otras guías,
  datos históricos, enlaces semánticos y retención permanecen sin evaluar.
- **Aceptación futura:** catálogo con vigencia/propietario por fuente; inventario
  de rutas coincide en README/contexto y consumidores; ninguna cifra histórica
  se presenta como avance actual sin criterio verificable. docs:check no acredita
  semántica. Rollback documental por Git sin restaurar afirmaciones invalidadas.

## Resto del backlog histórico

| IDs | Disposición en este corte |
|---|---|
| TD-01/02/03/05/07/11/17/19/22/24 | Defensas locales observadas en muestras/suite seguridad; sin cierre nuevo. Despliegue/RLS/efectividad completa pendientes. |
| TD-04/09/13/14/16/18/21/23/25 | Solo antecedentes o revisión parcial por inventario/contratos; no revalidación exhaustiva ni reapertura automática. |

Los 25 originales conservan su historia en el informe raíz. No se suman sus
estados viejos como «cerrados» en la línea base de noviembre. Preferencias de
estilo, actualización rutinaria de paquetes y arquitectura alternativa sin beneficio
demostrado quedan fuera del registro de defectos.
