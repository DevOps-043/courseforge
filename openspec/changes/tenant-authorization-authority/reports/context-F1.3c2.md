# Continuidad F1.3.c.2 — 2026-11-04

Zona America/Mexico_City; responsable local Codex. HEAD base 416fc973, staging.
Se preserva documentación heredada de auditoría y logs de unidades anteriores.
Estado final local: F1.3.c.2 cerrado; F1.3 y TD-26 siguen en curso.

## Diagnóstico y cambios

getAuthenticatedUser y getAccessToken elegían GoTrue primero; el resolver tenant
y /api/auth/session preferían Bridge. Un usuario con dos sesiones divergentes
podía tener distinto actor en la acción y autorización. getSession devolvía token
sin verificar su correspondencia con el actor.

- server-identity.ts centraliza elección: Bridge válido primero, GoTrue verificado
  si Bridge no existe/es inválido. Memoización React por request, sin caché global.
  GoTrue-only no obtiene permisos por sus metadatos: tenant exige las mismas
  membresías actuales y rol local. No hay mapeo por email a otro ID SofLIA.
- session.ts añade getAuthBridgeSession: devuelve juntos usuario y token exacto
  verificado. getAuthBridgeUser conserva DTO sin token. Exige exp finita entera,
  no expirada, sub/email presentes y HS256. JWT inválido devuelve null; errores de
  configuración/operación propagan AuthIdentityLookupError seguro; señales Next
  DYNAMIC_SERVER_USAGE se preservan. Retira logs de identidad y errores crudos.
- auth-identity-error.ts define código AUTH_LOOKUP_UNAVAILABLE y retryable.
- artifact-action-auth.ts delega selección de actor/token; conserva firmas y DTO.
  Token Bridge es el verificado. Token GoTrue requiere getUser(token) con mismo
  actor que getUser(); mismatch o rechazo retorna null. Caídas se propagan.
- tenant-context.ts usa la identidad central; conserva nombre bridgeUser del
  DTO interno para compatibilidad, aunque puede representar GoTrue-only.
- api/auth/session/route.ts verifica fallback GoTrue con el mismo adaptador;
  mantiene proyección pública sin tokens ni permisos nuevos.
- server-identity.test.ts y fixtures previos conectados por test:auth-bridge.

Los consumidores directos de token están en materiales/production.actions.ts
(generación y operaciones de producción) y curación/curation-action-context.ts;
f1-3c2-token-consumers.log conserva sus llamadas. No se cambian payloads ni firma
de jobs, y no se invocan jobs reales. Otros métodos llamados getAccessToken en
proveedores Google Drive/Artlist son OAuth propios y no corresponden a este helper.

## Evidencia y aceptación

| Comando | Código | Evidencia / límite |
|---|---|---|
| npm run typecheck inicial | 0 | f1-3c2-types.log |
| npm run test:auth-bridge --workspace=apps/web | 0 | f1-3c2-auth.log; contrato previo y 52 tests, nueve nuevos respecto a F1.3.c.1 |
| Auth Bridge con errores getSession | 0 | f1-3c2-auth-final.log; 52/52 |
| npm run typecheck | 0 | f1-3c2-check-0.log |
| npm run test:security-boundaries | 0 | f1-3c2-check-1.log |
| npm run test:curation --workspace=apps/web | 0 | f1-3c2-check-2.log |
| npm run db:migrations:check | 0 | f1-3c2-check-3.log; solo versiones, sin ejecutar SQL |
| Auth Bridge final con firma incorrecta real | 0 | f1-3c2-auth-verified.log; 52/52 |
| git diff --check | 0 | Sin errores; advertencias de conversión CRLF de Git |
| npm run verify:pr | 2 | f1-3c2-gate.log; arnés/documentación/OpenSpec aprobados; fallo previo ESLint |
| npm run docs:check final | 0 | f1-3c2-docs-final.log |

Pruebas sobre fuentes reales con fronteras Next/GoTrue simuladas: sesiones duales
divergentes, prioridad Bridge sin consultar GoTrue, GoTrue-only, token de otro
actor, token inválido, error de Bridge sin fallback, error 503/thrown de GoTrue y
getSession, ausencia de sesión y rechazo 400. Verificación Bridge usa JWT reales
con secreto sintético: token exacto, sin exp, expirado, malformado; configuración
caída no filtra detalle y señales Next se propagan. Las pruebas tenant previas
siguen verificando membresías/roles con red simulada; no hay E2E de GoTrue/SofLIA.

## Revisión propia, límites y siguiente paso

Revisión con criterios adversarial-review, sin independencia. DTO de identidad
público no recibe token. Bridge inválido/expirado puede usar una sesión GoTrue
válida, igual que la política UI previa; fallo operativo no cambia de actor.
JWT/issuer/audience y revocación directa de RLS no se rediseñan: conservan las
limitaciones del OpenSpec. La autorización real sigue dependiendo de autoridad
tenant y rol local, con aceptación SQL/grants/RLS pendiente.

F1.3.c.3 normalizará errores de autoridad/identidad a 503 por flujo. En esta unidad
se propagan errores seguros; algunos catch genéricos aún devuelven 500. El endpoint
de identidad UI conserva 500 operacional para compatibilidad con su contrato.
No afirmar cierre de F1.3 ni TD-26 por estos cambios locales.

Reversión: commit local de esta unidad, manteniendo denegación segura. No hay
datos persistidos, SQL remoto, despliegue ni modificación de secretos. Los logs
completos permanecen locales en reports/ y este registro conserva sus resultados.
