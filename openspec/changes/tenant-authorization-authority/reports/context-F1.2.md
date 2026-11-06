# Continuidad F1.2 — 2026-11-04

Zona America/Mexico_City. Responsable local: Codex. HEAD base al iniciar
37dcf7dcfb89d6289369b4c962423a02097b5293, rama staging.
Se recuperó gate-retry.log de F1.1: terminó 2 por ESLint tras aprobar arnés,
documentación y OpenSpec. La interrupción no perdió los documentos.

## Alcance

Estado final: F1.2 cerrado como unidad local del resolver; TD-26 en curso.
No equivale a cierre de frontera privilegiada ni a certificación de ambiente.

- tenant-memberships.ts: consulta SofLIA por actor/status, valida DTO, count y
  coherencia de IDs, aplica retry/abort y convierte fallos en error seguro.
- tenant-context-error.ts: error compartido para evitar ciclo de imports.
- tenant-context.ts: membresías vigentes y rol local; elimina fallbacks de cookie,
  perfil y JWT. Reexporta error, conserva TenantContext y helpers de rutas.
- login/__tests__/tenant-authority.test.ts: ocho pruebas de aceptación sobre
  fuentes reales transpiliadas, con fronteras Next/DB simuladas.
- apps/web/package.json: añade estas pruebas al script existente Auth Bridge.
- OpenSpec: diseño, tareas y esta evidencia. Sin SQL ni cambios en JWT/cookies UI.

La búsqueda de getOrganizationsFromSession solo encuentra consumidores dentro
del resolver; se conserva DTO. Se verificó que los layouts admin y varias rutas
ya manejan TenantContextLookupError. Otros catch genéricos siguen con 500 seguro:
normalización 503 por consumidores y compatibilidad GoTrue quedan en F1.3.
No se cambian archivos de producción multimedia ni sus contratos.

## Pruebas y revisión

| Comando | Resultado | Evidencia |
|---|---|---|
| npm run test:auth-bridge --workspace=apps/web | 1 sandbox | f1-2-auth.log: spawn EPERM |
| Repetición con subprocesos | 1 | f1-2-auth-retry.log: comparación de prototipos entre VM fallaba en fixture; corregida comparando valor serializado |
| Repetición corregida | 0 | f1-2-auth-final.log: contrato previo y 22 tests aprobados, ocho nuevos |
| npm run typecheck | 0 | f1-2-check-0.log |
| npm run test:security-boundaries | 0 | f1-2-check-1.log |
| npm run db:migrations:check | 0 | f1-2-check-2.log; versiones, sin ejecutar SQL |
| npm run verify:pr (subprocesos habilitados) | 2 | f1-2-gate.log; arnés/documentación/OpenSpec aprueban, detiene en fallo previo ESLint |
| Auth Bridge tras sanear logs del resolver | 0 | f1-2-auth-verified.log |
| Auth Bridge final con claim ausente y sin cookie | 0 | f1-2-auth-complete.log; 22/22 |
| npm run docs:check final | 0 | f1-2-docs-final.log |
| git diff --check | 0 | Sin errores; advertencias de conversión LF/CRLF de Git |

Casos: rol válido pese a cookie/rol global ADMIN, rol ausente/desconocido, claims
vacíos, recuperación legacy por autoridad actual, revocación con claim presente,
slug ajeno/sin identidad, caída de ambas autoridades propagada por referer,
respuesta truncada/malformada/inconsistente. El query spy exige user_id/status y
abortSignal. Los tests de timeout reales permanecen en security-boundaries para
tenant-lookup-retry; aquí se prueba propagación del error.

Revisión adversarial propia: no se usa claims como membresía vigente ni cookie
como rol, no se añade autoridad por default, no se registra error crudo en nuevas
lecturas. count exacto impide aceptar listas truncadas. Sin revisión independiente.
No prueba HTTP/SofLIA real, RLS, grants o login real end-to-end; no acredita
latencia/capacidad. La consulta nueva aumenta dependencia remota por request;
requiere medir operación en piloto, sin prometer escala o índices no verificados.

## Trabajo pendiente y siguiente paso

F1.3: assertArtifactOrgAccess/getAuthorizedArtifactAdmin todavía aceptan fallback
de cf_active_org cuando no hay contexto. No considerar TD-26 corregido por este
resolver. Revisar canReviewContent y ForTenant, identidad y tenants en consumidores,
legacy global, errores 503 y switch-organization con membresía actual. Seguir la
condición SQL de roles descrita en design.md antes de certificar autoridad local.
La caracterización de reports/characterize-authority.mjs queda como evidencia
histórica F1.1 y ya no debe ejecutarse como aceptación de fuente nueva. Los tests
de aceptación activos están en Auth Bridge; el helper espera su corrección F1.3.

Preservar todos los cambios previos listados en context-F1.1.md. No reinstalar,
desplegar ni aplicar SQL remoto. Reversión: retirar solo archivos nuevos y revertir
hunks de F1.2 en tenant-context/package.json; ante incidente, mantener denegación
segura en lugar de rehabilitar cookies. No hay efectos de datos remotos.

Se prepara commit local recuperable solo con código, pruebas y este OpenSpec.
El seguimiento añadido a findings.md permanece junto a la auditoría pendiente,
fuera del commit para preservar la separación del trabajo heredado. Los logs
completos permanecen en reports/ del checkout; tablas anteriores resumen códigos.
