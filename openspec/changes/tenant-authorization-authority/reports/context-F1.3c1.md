# Continuidad F1.3.c.1 — 2026-11-04

Zona America/Mexico_City. Responsable local Codex. HEAD base 8a581b59, staging.
Trabajo heredado y logs previos preservados; sin instalación ni consulta remota.
Estado final local: F1.3.c.1 cerrado; F1.3.c y TD-26 en curso.
F1.3.c se subdivide: cambio de organización, identidad, errores HTTP por flujo.
La revisión de identidad no está implementada en este tramo.

## Diagnóstico y solución

switch-organization confiaba en organization_ids históricos y DTO de cf_user_orgs.
Ahora verifica sub UUID/email del JWT, exp válida, membresía activa vigente y rol
local reconocido del destino. Usa loadCurrentUserMemberships y
getOrganizationPlatformRole; no sincroniza roles en una operación de lectura.
Revocación y falta de rol devuelven 403, sin escribir cookies. Autoridad caída
produce 503 con mensaje seguro y retryable, también sin escritura de cookies.
Los errores de recurso de los helpers anteriores no cambian.

El JWT conserva exp original y actualiza organization_ids desde membresías
actuales; app_metadata restante se conserva. No amplía lifetime ni permite
cambiar con refresh token sin identidad/exp válidas. Una sesión legacy sin lista
firmada puede usar membresía verificada. Ya no requiere cf_user_orgs para cambiar.
DTO de organización desde servidor: id, nombre, slug, rol de membresía y logo.
tenant-memberships.ts añade logo_url opcional a selección/schema/DTO, conservando
compatibilidad con fixtures y ausencia de logo. El rol de membresía presentado
en UI no reemplaza el rol tenant local para autorización.

## Archivos y pruebas

- app/api/auth/switch-organization/route.ts: frontera HTTP, autoridad actual,
  claims renovados y manejo de error 503.
- lib/server/tenant-memberships.ts: logo opcional, sin nuevas dependencias.
- login/__tests__/switch-organization-authority.test.ts: fuente HTTP real
  transpiliada, Request real y JWT HS256 firmado/verificado con secreto sintético.
  Autoridades y escritura de cookies simuladas; no se accede a Next/DB reales.
- apps/web/package.json conecta suite al script de Auth Bridge existente.
- OpenSpec: contrato, tareas y evidencia de esta unidad.

| Comando | Resultado | Evidencia / límite |
|---|---|---|
| npm run test:auth-bridge --workspace=apps/web (primer intento) | 0 | f1-3c1-auth.log; script previo, aún sin nuevo archivo conectado |
| Mismo comando con nueva suite | 0 | f1-3c1-auth-final.log; contrato y 43 tests; siete nuevos respecto a F1.3.b |
| npm run db:migrations:check | 0 | f1-3c1-check-2.log; versiones, sin ejecutar SQL |
| npm run typecheck | 0 | f1-3c1-check-0.log |
| npm run test:security-boundaries | 0 | f1-3c1-check-1.log |
| Auth Bridge final sin compilación solapada | 0 | f1-3c1-auth-verified.log; 43/43, incluye JWT expirado/sin exp |
| git diff --check | 0 | Sin errores; advertencias CRLF de Git |
| npm run verify:pr | 2 | f1-3c1-gate.log; arnés/documentación/OpenSpec aprobados, fallo previo ESLint |
| npm run docs:check final | 0 | f1-3c1-docs-final.log |

Casos: JWT real/DTO actual sin cookie, IDs renovados y exp igual; legacy sin IDs;
revocada con claim presente; rol ausente/desconocido; caída de ambas autoridades;
sesión ausente, inválida, expirada, sin exp o sin identidad; payload inválido y
destino ajeno. Spies exigen actor/tenant correctos, cero escrituras ante denegación
y ausencia de lecturas cf_user_orgs. Se usa la clase de error real y el parser JSON
real; las respuestas se proyectan con stub de api-response conservando status/body.

El alias python.exe no estuvo disponible al conectar el script; se usó lectura y
escritura UTF-8 de .NET sin reinstalar ni modificar el runtime. La primera suite
aún en ejecución y la siguiente compilaron el mismo proyecto; ambas finalizaron
0. La validación final se ejecutó sin solapamiento de compilaciones del proyecto.

## Revisión y siguiente paso

Revisión adversarial propia: no permite reanimar una membresía revocada, ni usar
cookie o perfil global para suplir rol; los errores no renuevan tokens. JWT se
verifica con HS256; expiración no se amplía. No hay revisión independiente.
No se acredita operación real del proveedor ni cierre SQL/RLS o de TD-26.
Los claims de membresía renovados son instantáneas; la autorización tenant sigue
dependiendo del resolver vigente. Grants/RLS efectivos siguen pendientes.

F1.3.c.2: getAuthenticatedUser y getAccessToken priorizan GoTrue, mientras resolver
tenant y /api/auth/session prefieren Auth Bridge. Probar sesiones duales y
divergentes, autoridad caída y usuario GoTrue-only; centralizar identidad sin
aceptar ID del payload y verificar que el token de jobs corresponda al actor.
F1.3.c.3: normalizar errores 503 en otros consumidores por lotes, preservando
contratos particulares de UI/rutas. F1.3 y TD-26 permanecen en curso.

Reversión: commit local de esta subunidad; ante incidente mantener denegación por
autoridad vigente. No hay datos persistidos, SQL, proveedores reales o despliegue.
Logs completos quedan en reports/ local, resumen en este registro versionado.
