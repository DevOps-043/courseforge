# Continuidad F1.3.a

Fecha 2026-11-04, America/Mexico_City. Responsable local: Codex.
HEAD base: 0927374c; rama staging. Sin worktree, instalación ni operaciones remotas.
Estado final de unidad local: F1.3.a cerrado; F1.3 en curso, TD-26 sin cierre.
Trabajo heredado: documentación de auditoría y logs listados en los registros
anteriores, preservados. No se incorporan al commit de esta subunidad.

## Alcance y decisión

F1.3 se subdivide por sus consumidores. Esta subunidad cierra el helper central
de artefactos y canReviewContent. No declara completa F1.3 ni corregido TD-26.

- tenant-context.ts añade resolveTenantContextByOrganizationId: resuelve ID solo
  contra membresías actuales y exige el rol local mediante resolver existente.
- artifact-action-auth.ts elimina getActiveOrganizationId como fallback y la
  unión de IDs de cookies/claims; sin tenant válido retorna null antes de leer
  artefactos. assertArtifactOrgAccess y ForTenant verifican de nuevo organización.
  La consulta filtra un solo tenant y comprueba que el resultado lo conserve.
  No se permite organización null legacy ni selectores contradictorios.
- canReviewContent revalida tenant/rol y comprueba userId actual. No consulta el
  perfil global ni permisos de un userId diferente. El DTO recibido es selector.
- source-test-loader.ts comparte el cargador de fuente real entre suites.
- artifact-authority.test.ts agrega seis escenarios y tenant-authority.test.ts
  agrega resolución por ID. package.json conecta ambas suites a Auth Bridge.

La memoización React sigue siendo por request; no hay caché de permisos entre
solicitudes. Se conservan firmas públicas para minimizar cambios de consumidores.
Este helper sigue siendo de pertenencia al tenant, no define permisos específicos
por operación ni ownership adicional de cada curso. Esos controles siguen en
sus casos de uso. No hay cambios en SQL, JWT, UI o contratos de multimedia.

## Validación

| Comando | Código | Evidencia y límite |
|---|---|---|
| npm run typecheck | 0 | f1-3a-types.log |
| npm run test:auth-bridge --workspace=apps/web | 0 | f1-3a-auth.log; contrato previo y 29/29 tests; siete nuevos frente a F1.2 |
| npm run test:security-boundaries | 0 | f1-3a-check-0.log; pruebas locales, no RLS real |
| npm run db:migrations:check | 0 | f1-3a-check-1.log; sin aplicar SQL |
| git diff --check | 0 | Advertencias CRLF de Git, sin errores de whitespace |
| npm run test:publication --workspace=apps/web | 0 | f1-3a-domain-0.log; cliente, no carrera SQL |
| npm run test:course-delivery | 1 sandbox; 0 repetido | f1-3a-domain-1.log / f1-3a-delivery-retry.log; 25/25 con subprocesos habilitados |
| npm run verify:pr | 2 | f1-3a-gate.log; arnés/documentación/OpenSpec aprobados; fallo previo de ESLint |
| Auth Bridge después de revisión final | 0 | f1-3a-auth-final.log; 29/29, incluye slug duplicado |
| npm run docs:check final | 0 | f1-3a-docs-final.log |

Pruebas sobre fuentes reales con Next/Supabase simulados: contexto null y cookie
ajena no leen artefactos; ForTenant ajeno no consulta, propio sí; query filtra
tenant propio; resultados ajenos/null rechazados; selectores contradictorios
rechazados; caída de autoridad propagada sin lecturas de artefactos; revisión
no confía en rol del DTO, exige identidad actual y rol vigente. La suite del
resolver prueba por separado membresía/rol real del adaptador con red simulada.
La revisión detectó riesgo de resolver un ID mediante slug duplicado; el helper
comprueba que el tenant resuelto conserve el ID solicitado y el test lo demuestra.

Revisión propia con criterios adversarial-review: sin perfil global como fallback,
sin lectura de artefactos antes del gate central, sin nuevas dependencias ni
autoridad desde claims. No es revisión independiente ni E2E de los 18 archivos.
El primer intento de editar el script por Python falló por quoting antes de
escribirlo; se corrigió mediante here-string y la suite ejecutó ambos archivos.

## Consumidores y siguientes lotes

f1-3a-consumers.log inventaría 18 archivos (incluido el helper): rutas syllabus,
storage/signed-upload-url, save-draft, publish, automation/runs; acciones de
artefactos, syllabus import, plan, curación, materiales y publicación; servicios
course-delivery y pipeline-dirty-actions. La lista es búsqueda de símbolos,
no cobertura HTTP exhaustiva. Se inspeccionaron los patrones de delivery-access,
materials-action-context, save-draft y acciones de publicación para conservar
firmas y denegación existente. Los otros flujos requieren caracterización por lote.

F1.3.b: getAuthorizedCurationRowAdmin y getAuthorizedMaterialComponentAdmin hacen
prelecturas privilegiadas antes de llegar al gate de artefacto. Revisar también
getAuthorizedMaterialComponentAdminForTenant, materials-action-helpers y todos
los wrappers de filas/lecciones. Exigir contexto antes de leer relaciones y
filtrar tenant en consultas derivadas; probar éxito, ausencia y errores.
F1.3.c: getAuthenticatedUser prioriza GoTrue mientras el resolver usa Auth Bridge:
probar sesiones duales e identidad divergente, nunca aceptar ID del payload.
Revisar switch-organization con membresía vigente y expiración conservada; rutas
que hoy proyectan autoridad caída como 500 deben normalizar a 503 por flujo.
Pendiente condición SQL de roles y aceptación externa del OpenSpec.

Riesgo residual: helpers derivados pueden leer metadatos ajenos antes de denegar;
no se afirma ausencia de lecturas service-role ajenas en todo el sistema.
Sesiones globales legacy ahora no acceden al helper tenant sin contexto, por
decisión de mínimo privilegio; habilitar flujo global requiere contrato separado.
Reversión: revertir solo commit F1.3.a; ante incidente preservar denegación segura.
Sin publicación, despliegue, secretos ni acceso a BD remota.

Se guarda commit local recuperable de los archivos de esta subunidad, sin incluir
documentación heredada ni logs completos, que permanecen en reports/ del checkout.
