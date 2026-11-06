# Verificaciones y evolución de métricas

Fecha del corte: **2026-11-04**, zona America/Mexico_City. Entorno local Windows /
PowerShell, Node v24.19.0 / npm 11.19.0, dependencias ya instaladas;
no instalación limpia ni acceso productivo. CI declara Node 22: no se acredita
equivalencia del resultado local con ese runtime.
HEAD inicial `37dcf7dcfb89d6289369b4c962423a02097b5293`; árbol inicialmente limpio.
Las modificaciones de esta entrega son documentación y evidencia, sin código de
producto. [OpenSpec](../../openspec/changes/audit-technical-debt-2026-11/proposal.md).

## Línea base congelada B2026-11-04

| Métrica | Inicial | Meta / método |
|---|---|---|
| Hallazgos priorizados de este corte | 12: 4 P1, 8 P2; todos planificados | Cierre por aceptación del registro; esfuerzo no pondera severidad. |
| Verificados como corregidos | P1 0/4; P2 0/8 | Evidencia de criterios completos, fecha y cambio; no tests preexistentes como crédito de remediación. |
| Riesgos críticos P0 demostrados | 0 en alcance revisado | Revisar áreas pendientes; no interpretar como seguridad global. |
| Riesgos P1 pendientes | 4 | 0 al cumplir aceptación; no baja prioridad por ser caros. |
| Cobertura por dominio directo | 12/12 con muestra estática; 0 certificados exhaustivamente | Expandir según matriz de cobertura, registrar pruebas y límites. |
| Cobertura por flujo de la matriz | 20/20 con evidencia local parcial; 0 con aceptación integral de ambiente | Revisar pendientes por fila. I/E/R/T no se suman como un porcentaje de calidad. |
| Rutas HTTP | 158 inventariadas; 5 muestreadas directamente (switch-org, Lia, upload SCORM, save-draft, publish); ninguna certificada exhaustivamente | Revisar archivo/método/permiso/tenant/efecto/test de todas; mantener denominador de este corte. |
| Superficie SQL | 214 archivos inventariados; revisión selectiva | Reconstrucción descartable y matriz de permisos, no conteo como validación. |
| Grafo Madge | 11 ciclos, 577 warnings / 2.262 archivos procesados | Ver TD-12; distinguir aristas de tipos y warnings. |
| Límite JSON | 65.536 B leídos al rechazar 1.024 B en dos parsers | Ver TD-27; cancelación incremental medible. |
| Operación/carga/costos | Sin línea base disponible | Obtener medición autorizada según plan antes de fijar metas numéricas. |

Los seis IDs históricos revalidados en el corte son TD-06/08/10/12/15/20. Los seis
nuevos son TD-26–31. Los otros 19 históricos no se importan como cerrados ni se
incluyen en el denominador de 12. Los nuevos descubrimientos posteriores irán a
B2026-11-04+N, sin reescribir esta base.

## Comandos ejecutados

Salidas en [reports/](../../openspec/changes/audit-technical-debt-2026-11/reports/).
Cada `.log` contiene stdout/stderr del comando indicado, sin secretos añadidos.
PowerShell informa el código npm como EXIT en la sesión; el wrapper de captura
puede terminar 0 al imprimir ese valor. La tabla registra el código del comando,
no confunde el wrapper con el test.

| Verificación | Resultado real | Evidencia y alcance |
|---|---|---|
| git status --short / git rev-parse HEAD | Limpio / HEAD anterior | Inspección inicial; no fetch ni inferencia de despliegue. |
| python …/reports/inventory.py | 0 | inventory.json, prefijos/extensiones explícitos; solo fuentes versionadas. |
| node …/reports/reproduce.mjs | 0 | reproduce.log; assertions confirman comportamientos inseguros actuales, no correcciones ni E2E. |
| npm run verify:pr (sandbox inicial) | 1 | verify-pr.log; adapters pasa (27), harness falla con spawnSync git EPERM; pasos posteriores no ejecutados por ese intento. |
| npm run verify | 2 | verify-product.log; ESLint 9.39.5 no encuentra plugin react-hooks para immutability. Resto omitido por cortocircuito. |
| npm run typecheck | 0 | typecheck.log; ejecución separada del verify fallido. |
| npm run architecture:cycles | 1 | cycles.log; 11 ciclos/577 warnings, 2.262 archivos; no afirmar 11 defectos runtime. |
| npm run db:migrations:check | 0 | migrations.log; 214 SQL, colisiones históricas congeladas. No ejecuta SQL. |
| npm run test:security-boundaries | 0 | security.log; suites de contratos/políticas y guardas estáticas. No acredita RLS real ni ausencia de bypass en todas las rutas. |
| npm run test:auth-bridge --workspace=apps/web (sandbox) | 1 | auth-bridge.log; contrato inicial pasa, runner de auth-session bloqueado por spawn EPERM. |
| Mismo comando con subprocesos permitidos | 0 | auth-bridge-retry.log; contrato y 14 pruebas de ciclo de identidad aprobados. No llama a login real. |
| npm run test:curation --workspace=apps/web | 0 | curation.log; validación/cobertura/workflow/schema local. Sin proveedor real. |
| npm run test:publication --workspace=apps/web | 0 | publication.log; prueba del cliente, no carrera SQL de TD-28. |
| npm run test:materials-generation --workspace=apps/web | 0 | materials.log; generación/recuperación local con dependencias simuladas; no proveedor IA ni persistencia real. |
| npm ls eslint eslint-config-next eslint-plugin-react-hooks --all | 0 | lint-dependencies.log; resolución instalada, no certificación tras npm ci ni auditoría CVE. |
| npm run docs:audit | 0 | docs-audit.log; genera docs/documentation-audit.md, ignorado por Git y temporal; no certifica semántica. |
| npm run verify:pr (subprocesos permitidos) | 2 | verify-pr-retry.log; adapters, harness, docs, OpenSpec (38/38) y test:harness aprobados; verify se detiene en el mismo error ESLint. |
| npm run docs:check (revisión final) | 0 | docs-check-final.log; 257 documentos y enlaces nuevos verificados tras completar entregables. |
| git diff --check | 0 | Sin errores en diff versionado; archivos nuevos además revisados por verificador de documentación. |

La verificación documental final y las suites restantes se registran también en
[el informe de entrega](../../openspec/changes/audit-technical-debt-2026-11/reports/verification.md).
No se ejecutaron build/QA visual, render, load tests, npm audit de red, Deno ni
reset/SQL remoto. Tampoco se consultaron logs o configuraciones de producción.

## Historial y protocolo de actualización

| Fecha | Lote | Cambio asociado | Estado / resultado |
|---|---|---|---|
| 2026-11-04 | B2026-11-04 | audit-technical-debt-2026-11, sobre HEAD indicado | Identificación, validación local parcial y planificación; 0 cierres de producto. |
| 2026-11-04 | B2026-11-04, sin cambio de denominador | Refinamiento documental por contexto, mismo OpenSpec | Seis fases y 25 unidades planificadas; ninguna corrección iniciada. [Verificación del plan](../../openspec/changes/audit-technical-debt-2026-11/reports/phase-plan-verification.md). |

Para cada transición añadir fila con ID, estado anterior/nuevo, fecha, autor,
commit/OpenSpec, comando, código, evidencia y criterio demostrado. No sobrescribir
la historia. Un bloqueo necesita dependencia y acción para desbloquearlo. Un
«resuelto pendiente de verificación» no cuenta como cerrado. Solo sumar a progreso
verificado al demostrar todos los criterios; separar por P0/P1/P2/P3 y lote.

Formato para futura transición (plantilla, no resultado ejecutado):
`fecha | ID | anterior → nuevo | commit/cambio | criterio | comando/código | evidencia | responsable`.

## Revisión adversarial propia

Se contrastaron los hallazgos con sus defensas: IDs firmados sí filtran membresías
no vacías; error de consulta de rol no usa fallback; hay outbox/claims e idempotencia;
hay SQL PGlite y QA visual en CI; algunos ciclos son de tipos. Se inspeccionó el
trigger de syllabus antes de sostener TD-28. Ninguna de esas defensas acredita los
casos residuales descritos, pero impide afirmar vulnerabilidades generales.
El mismo agente realizó esta revisión; no es una revisión independiente.
Se amplió TD-26 al observar que el helper de artefactos agrega la cookie activa a
la consulta service-role sin cruzar membresías cuando no hay contexto; se reprodujo
con JWT simulado de membresía no vacía. No se limitó el hallazgo al primer fallback.
