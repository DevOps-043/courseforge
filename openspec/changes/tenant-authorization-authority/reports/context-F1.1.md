# Continuidad F1.1

Fecha: 2026-11-04, America/Mexico_City. Ejecución local: Codex.
Estado: cerrado como unidad de definición/caracterización; TD-26 sigue en curso,
sin corrección runtime ni aceptación de ambiente. F1.2/F1.3 pendientes.
Base: staging, HEAD 37dcf7dcfb89d6289369b4c962423a02097b5293.
Runtime Node v24.19.0/npm 11.19.0; dependencias existentes. Sin npm ci ni Node 22.

## Trabajo previo preservado

README.md, TECHNICAL_DEBT_AUDIT.md, docs/README.md,
docs/TECHNICAL_DEBT_ANALYSIS.md, docs/architecture/system-context.md,
docs/technical-debt/, openspec/changes/audit-technical-debt-2026-11/ y
openspec/changes/remediation-execution-baseline/ ya estaban pendientes al iniciar.
Esta unidad añade solo openspec/changes/tenant-authorization-authority/.
Sin commit ni integración remota. No se archiva OpenSpec antes de integrar.

## Decisiones y límites

Contrato completo en ../design.md y ../specs/tenant-authority/spec.md.
SofLIA organization_users acredita membresía activa vigente; Engine
organization_user_roles acredita rol local. Cookie solo selecciona navegación.
JWT válido sin IDs puede recuperar membresía desde autoridad actual; no desde
cookie. Sin rol local se deniega. Caída de autoridad produce indisponibilidad.
El DTO UI se conserva. GoTrue legacy requiere identidad verificada equivalente,
no confianza en ID del payload; su aceptación debe probarse al conectar F1.2.

La sincronización de login escribe roles SofLIA sobre roles locales; falta probar
precedencia y recuperación ante fallo de sincronización antes de acreditar login
integral. No se añaden defaults que concedan permisos cuando falte una fila.
La revocación de JWT directo/RLS, jobs ya iniciados y toda sesión global legacy
exceden una corrección del resolver; no se promete revocación global inmediata.

## Matriz y verificaciones

Fixtures tenant: cookie owner sin rol, claims vacíos y cookie ajena, ausencia de
rol, rol desconocido, autoridad de rol caída, constructor válido con cookie owner,
ausencia de identidad. Fixture helper: sin contexto y cf_active_org ajena.
Fixtures declarativos pendientes de adaptador: membresía revocada con claim/rol,
JWT legacy con membresía actual, autoridad de membresía caída y membresía invited.
Estos últimos cuatro no tienen cobertura ejecutable actual; no se contabilizan
como pruebas aprobadas. No se ejecuta una implementación de política inventada.

| Comando | Código | Evidencia y alcance |
|---|---|---|
| node …/reports/characterize-authority.mjs | 0 | characterization.log; 8 escenarios actuales confirmados, 5 incumplen contrato seguro |
| Mismo comando --acceptance | 1 esperado | acceptance-before.log; demuestra que caracterización verde no equivale a corrección |
| npm run test:auth-bridge --workspace=apps/web | 1 sandbox; 0 repetido | check-0.log / auth-retry.log; spawn EPERM inicial, luego contrato y 14 tests de identidad aprobados |
| npm run test:security-boundaries | 0 | check-1.log; contratos/políticas locales, no RLS real |
| npm run db:migrations:check | 0 | check-2.log; versiones, no aplica SQL ni verifica permisos |
| npm run verify:pr | 1 sandbox | check-3.log; adapters pasa, harness bloqueado por Git EPERM |

Los runners de caracterización se invocan desde la raíz. Sus assertions del
comportamiento inseguro deben sustituirse por assertions seguras al implementar
F1.2/F1.3: son evidencia de base, no suite de seguridad para conectar tal cual a CI.
El modo --acceptance sigue usando caracterización actual y no sustituye tests de
la fuente corregida. Sin HTTP real, firma criptográfica en fixtures ni SQL/RLS.

## Revisión adversarial propia

Se aplicó adversarial-review sin agente independiente. Se intentó refutar el
contrato con roles faltantes/desconocidos, claims vacíos, cookie ajena y caída de
autoridad. El modo aceptación falla; no se reporta TD-26 corregido.
Riesgo adicional observado estáticamente: políticas INSERT/UPDATE de
20260621123000_create_organization_user_roles.sql solo restringen tenant. Antes
de certificar autoridad local, comprobar grants y todas las políticas efectivas
con anon/authenticated y demostrar rechazo a autoasignación de ADMIN. No se
afirma exposición remota sin esa evidencia. Registrar como hallazgo adicional al
confirmar frontera efectiva; no reescribir el denominador histórico de auditoría.
El plan de validación exige esa prueba; F1.2 puede progresar cerrando cookies.

## Punto exacto para continuar

F1.2 habilitada. Leer contrato de este cambio y paquete S del plan, después
contrastar git status/HEAD. Implementar servicio/adaptador server-side separado
del resolver, con membresía actual, roles y metadatos de autoridad. Reutilizar
tenant-lookup-retry con abortSignal y caché por request. Revisar consumidores de
getOrganizationsFromSession y DTO antes de cambiar forma/tipos.
Conectar los fixtures de aceptación a fuente real corregida, añadiendo ausencia
de cookie, slug manipulado, revocación, timeout, sesión legacy y login válido.
Verificar errores 503 en rutas/layouts afectados; no tragarlos como ausencia.
F1.3 revisará helpers, canReviewContent, ForTenant y accesos legacy por lotes.
Ejecutar Auth Bridge, seguridad, tipos y gate; mantener visible fallo previo lint.

Reversión F1.1: retirar solo este OpenSpec. Sin acciones remotas ni datos que
revertir. Se preservan los cambios previos. No se consultaron secretos.

| Fecha | Estado anterior → nuevo | Evidencia | Siguiente acción |
|---|---|---|---|
| 2026-11-04 | planificado → cerrado (F1.1) | Contrato y fixtures, suites locales; runtime pendiente | F1.2, con prueba de autoridad actual |
