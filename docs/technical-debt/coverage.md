# Cobertura e inventario de auditoría

Corte: 2026-11-04 (America/Mexico_City). HEAD inicial
`37dcf7dcfb89d6289369b4c962423a02097b5293`; checkout principal inicialmente limpio.
Alcance autorizado: diagnóstico y documentación. Sin correcciones de producto.

## Método y profundidad

I = inventario de rutas/archivos; E = revisión estática de muestra indicada;
R = reproducción local del comportamiento concreto; T = suite local ejecutada,
con resultado en [verificaciones](verification.md); A = ambiente real, no ejecutado.
E no significa lectura completa del módulo. T no acredita toda la funcionalidad.
No hay módulos certificados exhaustivamente. **La auditoría integral sigue abierta.**

El [inventario reproducible](../../openspec/changes/audit-technical-debt-2026-11/reports/inventory.json)
contiene nombres de todas las rutas, entradas Netlify/Edge, migraciones y candidatos
a pruebas de los prefijos explícitos del [script](../../openspec/changes/audit-technical-debt-2026-11/reports/inventory.py).
Se generó antes del registro de hallazgos nuevos: 2.586 archivos, 158 `route.ts`,
550 archivos que coinciden con `.test.` o `__tests__/`, 214 SQL. No incluye todo el
repositorio ni todos los formatos de prueba (por ejemplo `_test.ts` de Deno).
Son conteos de superficie, no métricas de deuda, cobertura ejecutada o capacidad.

## Módulos y flujos críticos

Rutas siguientes relativas a la raíz; los nombres identifican las muestras leídas.

| ID | Módulo / flujo y fronteras | Profundidad y evidencia inspeccionada | Resultado / pendiente obligatorio |
|---|---|---|---|
| C01 | Login → JWT → organización → service-role | I/E/R/T: `src/app/login/auth-bridge.ts`, `auth-bridge-helpers.ts`, `src/utils/auth/session.ts`, `platform-role.ts`, `session-expiration.ts`, `src/lib/server/tenant-context.ts`, `artifact-action-auth.ts`, `platform-authorization.ts`, ruta `auth/switch-organization` (todos bajo apps/web) | TD-26; Auth Bridge aprobado tras superar EPERM. Falta E2E con cookie alterada, roles ausentes, revocación y organizaciones vacías en entorno aislado. |
| C02 | Dashboard → indicadores y colas | I/E: `apps/web/src/domains/admin-dashboard/dashboard-data.ts` (consultas, conteos y agregación) | TD-29/30; falta dataset mayor al límite REST, planes SQL, estados degradados y UI real. |
| C03 | BASE → job firmado → artefacto | I/E: `artifacts/actions/artifact.actions.ts` (snapshot y entrada), `generate-artifact-background.ts` (firma, alcance, runId, commits y errores) | Hay fencing de runId; TD-15. Falta caracterizar carrera completa de reintentos, recursos cloud y fallos parciales. |
| C04 | Syllabus generado/importado → aprobación | I/E: `syllabus/services/syllabus-workflow-read.ts`, schemas inventariados y migración `20261009010000_provided_syllabus_imports.sql` (guard de dependencia/fidelidad) | Fallback de columnas explícito; no prueba de despliegue. Falta upload/parser, RPC, invalidación y permisos de todas las acciones. |
| C05 | Plan → iteración → dependencias | I/E: `plan/actions/plan.actions.ts` (entrada, permisos, schema/política de duración) | No nuevo defecto probado en muestra. Falta revisar todas las transiciones, rollback y QA. |
| C06 | Curación → fetch → validación → persistencia | I/E/T: `curation/actions/curation.actions.ts` (dependencias y fuente manual), `netlify/functions/shared/curation-v2/validation.ts` mediante suite y `public-url-policy.ts` | Existen política HTTPS y presupuestos; no afirmar ausencia global de SSRF. Falta fijación DNS/egress, PDF adversarial, redirecciones y prueba integrada. |
| C07 | Materiales → generación/reintento → assets | I/E: `materials-generation-background.ts` (orquestación), `materials/services/materials-generation-recovery.ts`, prueba estática de updates de assets en suite seguridad | Recuperación compara iteración/fecha. Falta todos los tipos de componentes, append concurrente de arrays, costo IA y carga. |
| C08 | Duración → contrato y plan | I/E: `video-duration/video-duration-policy.ts`, uso desde plan y production jobs | Rangos y refinamientos presentes. Falta duración observada frente al resultado audiovisual, corpus y regresiones dirigidas. |
| C09 | Settings/prompts → autorización → persistencia | I/E: `app/admin/settings/actions.ts` (getSettingsEditor y contratos), `prompts/components/SystemPromptsManager.tsx` (entrada) | Dependencia de C01; UI depende de app/actions. Falta todas las mutaciones, prompts por organización y versionado de resets. |
| C10 | SCORM upload → parser → jobs con lease | I/E/T: ruta `admin/scorm/upload`, `scorm-parser.service.ts` (presupuesto ZIP), `scorm-job.repository.ts`, tests parser/job-contracts en suite seguridad | Presupuesto ZIP y claim/heartbeat presentes; TD-27 incluye multipart. Falta ZIP malicioso completo, reanudación con PostgreSQL y paquetes reales. |
| C11 | Borrador → reserva outbox → inbox → confirmación | I/E/T: rutas `save-draft` y `publish`, `publication-outbox.service.ts`, schemas, migraciones outbox y trigger temario, tests de outbox en seguridad | TD-28; firma/claim/hash son defensas presentes. Falta dos conexiones reales y contrato inbox autorizado. |
| C12 | Modalidad síncrona/híbrida → entrega/publicación | I/E: `course-delivery/services/delivery-publication.ts`, flags y specs existentes por referencia | Gate NEXUS/híbrido/síncrono explícito. Falta revisión del resto de 29 fuentes y piloto de ocho etapas. |
| C13 | Editor → cola de guardado → append versionado | I/E: `NativeCompositionPreview.tsx` (imports, estados, saves, inserción y render), `composition-save-queue.ts`, `composition-document.service.ts` (validación/persistencia inicial), tipos y efectos para ciclos | TD-10/12; cola acotada y conflictos presentes. Falta revisión de todas las operaciones y todos los escritores RPC/SQL. |
| C14 | Snapshot/ZIP → proveedor → webhook → importación | I/E/T: fuente canónica multimedia, `heygen-hyperframes-webhook/index.ts`, `_shared/http.ts`, `production-jobs.service.ts` (contratos), cliente HyperFrames desde suite seguridad | HMAC/timestamp y correlación presentes; TD-27 incluye body de webhook. Falta render, navegador, ZIP final, paridad y receipts/CAP con ambiente. |
| C15 | Drive/OneDrive/Artlist/OAuth → importación | I/E/T: `external-media-import-policy.ts`, `public-url-policy.ts`, `outbound-http.ts`, `external-import-concurrency.ts`, entrada de `microsoft-graph.service.ts`; contratos/provider tests en seguridad | Presupuestos, límites por instancia y breaker presentes. Falta cuotas globales tenant, token refresh concurrente y proveedor real. |
| C16 | Audio → worker FFmpeg → cola compartida | I/E: `apps/api/src/features/audio-processing/audio-worker.ts` (schema/lease/políticas), workflow `process-audio-queue.yml`; manifests y entradas inventariadas | Lease token y máximo de intentos presentes. Falta FFmpeg/corpus, SQL real, CI ejecutado y perfiles neurales. |
| C17 | API Express/worker escritorio legado | I/E: `apps/api/src/server.ts`, `config/cors.ts`, inventario de rutas y README | TD-20. Express solo monta health; código residual del control plane no prueba exposición. Falta inventario de consumidores y tráfico autorizado. |
| C18 | Datos → migraciones → RLS/Storage | I/E/T: guard de versiones, outbox, guard temario y auditoría DB de octubre; listado de 214 SQL | TD-06/31. No se leyó cada migración ni se reconstruyó el esquema. Falta FK/índices/RLS/privilegios efectivos y `EXPLAIN` con cardinalidades representativas. |
| C19 | CI → dependencias → compuertas | I/E/T: tres workflows, manifests, ESLint, gate-plan/run-gate, comandos y logs de este corte | TD-08/12/31. Falta `npm ci` limpio, auditoría de vulnerabilidades con registro y SBOM actualizado. No se atribuyen CVE ni versión segura sin evidencia. |
| C20 | Operación/documentación → evidencia | I/E: logger operacional, fuentes obligatorias, dos auditorías históricas, cambios OpenSpec background-deploy, captions, nested-groups y reportes DB | TD-15/20. Falta telemetría real, alertas, retención/PII y revalidación íntegra de cambios activos. |

`src/`, rutas y dominios sin prefijo explícito en C03–C15 son de `apps/web/src/`;
jobs Netlify son de `apps/web/netlify/functions/`. La matriz describe muestras,
no afirma haber leído todos los archivos de las 1.439 fuentes de production.

## Superficie no evaluada en profundidad

El inventario enumera 12 dominios directos: admin-dashboard (8), artifacts (5),
course-delivery (29), curation (20), materials (150), plan (20), production (1.439),
prompts (2), publication (11), scorm (9), syllabus (44), video-duration (4).
Quedan pendientes UI accesible y roles completos; todas las rutas no citadas;
subdominios de production como standalone, slides/imported templates, bundle-agent,
LiveAvatar, narrativa/fragmentos, SFX, fuentes, CAP027/029, worker de integridad y
runtime controlado. Algunas tienen tests en la suite seguridad; eso no reemplaza
auditoría de su implementación. Tampoco se auditaron datos CSV, binarios, paquetes
vendor, todos los scripts operativos, secretos, configuraciones personales ni DB remota.

## Secuencia para continuar

1. Resolver la incertidumbre de C01/C11 con fixtures aislados, sin producción.
2. Revisar cada ruta del inventario con identidad, rol, tenant, schema, límites,
   errores, efectos y prueba asociada; registrar archivo/rango, revisor y fecha.
3. Reconstruir esquema descartable y contrastar contratos SQL antes de creditar RLS.
4. Profundizar C13–C16 y los subdominios pendientes con corpus/render autorizado.
5. Recoger operación y carga con aprobación y datos anonimizados.

No hay una fila «sin evaluar = segura». Para declarar auditoría integral completa,
no pueden quedar superficies pendientes y deben documentarse los límites de A.
