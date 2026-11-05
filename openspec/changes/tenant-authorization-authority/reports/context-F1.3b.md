# Continuidad F1.3.b — 2026-11-04

Zona America/Mexico_City; responsable local Codex; HEAD base 16d59247, staging.
Se preserva trabajo heredado de auditoría y logs de las unidades anteriores.
Esta unidad modifica solo helpers de autorización derivados, su suite y OpenSpec.
Estado: F1.3.b cerrado como unidad local; F1.3 y TD-26 siguen en curso.

## Diagnóstico y cambios

Los helpers leían filas/componentes/materiales/lecciones antes de comprobar el
artefacto padre. Ahora resuelven el tenant primero y usan joins !inner hasta
artifacts con filtro organization_id. Los vínculos están documentados en BD.sql
(curation→artifacts, curation_rows→curation, materials→artifacts,
material_lessons→materials); el helper de componentes ForTenant ya usaba su cadena.
Ese dump es evidencia de estructura disponible, no certificación del esquema remoto.

- artifact-action-auth.ts: curación pasa de dos lecturas sin scope a una lectura
  de relación filtrada. Devuelve row con id/curation_id como antes y valida el
  artefacto final. Componentes generales y ForTenant comparten un lector interno
  filtrado, con autoridad previa y validación final del artefacto.
- materials-action-helpers.ts: resuelve tenant y filtra materials/artifacts o
  material_lessons/materials/artifacts antes de devolver el recurso; conserva
  comprobación final mediante getAuthorizedArtifactAdminForTenant.
- derived-resource-authority.test.ts ejecuta fuentes reales y usa spies de DB
  para exigir filtro del tenant antes de cada resultado. Se conecta a Auth Bridge.

La firma de los cinco helpers se conserva. Errores de recurso: curación,
materiales, lecciones y componente ForTenant retornan null; componente general
conserva MaterialComponentLookupUnavailableError. Errores de autoridad se propagan.
Los errores nuevos se registran con mensajes constantes en español, sin detalle
crudo del proveedor. assets mantiene su tipo público existente: cambiarlo a
unknown introdujo errores en consumidores y se revirtió ese cambio fuera de alcance.

## Evidencia

| Comando | Resultado | Evidencia / límite |
|---|---|---|
| npm run typecheck inicial | 2 | f1-3b-types.log; cambio de tipo assets incompatible, corregido restableciendo contrato |
| npm run test:auth-bridge --workspace=apps/web | 0 | f1-3b-auth.log; contrato y 35 tests en primer corte |
| npm run test:security-boundaries | 0 | f1-3b-check-0.log; contratos locales |
| npm run test:curation --workspace=apps/web | 0 | f1-3b-check-1.log; proveedor simulado |
| npm run db:migrations:check | 0 | f1-3b-check-2.log; sin ejecutar SQL |
| npm run typecheck final | 0 | f1-3b-types-final.log; tipos públicos restaurados |
| Auth Bridge final | 0 | f1-3b-auth-final.log; contrato previo y 36/36 tests, siete nuevos frente a F1.3.a |
| git diff --check | 0 | Sin errores; advertencias CRLF de Git |
| npm run verify:pr | 2 | f1-3b-gate.log; arnés/documentación/OpenSpec aprobados, fallo previo ESLint |
| npm run docs:check final | 0 | f1-3b-docs-final.log |

Casos: sin contexto, selector ForTenant ajeno, propio con relaciones objeto o
arreglo, ausencia/recurso ajeno, fallo de recurso, falta de relación y autoridad
caída. El spy exige !inner y filtro tenant en cada lectura de recurso, más el
filtro tenant del artefacto final. Las pruebas no ejecutan joins PostgREST reales:
su aceptación en ambiente descartable con schema efectivo sigue pendiente.

Revisión adversarial propia (sin independencia): ninguna ruta de estos cinco
helpers consulta recursos antes de resolver contexto; ForTenant no acepta ID
ajeno; falta de relación y errores no disparan fallback global. La respuesta
curación preserva su DTO. No se tocaron dispatch/jobs ni persistencia de materiales.
No hay dependencias nuevas, SQL, secretos, render, despliegue ni proveedores reales.

## Consumidores y límites

f1-3b-consumers.log registra consumidores directos. Se leyeron los wrappers
curation-action-context y materials-action-context: llaman helpers y mantienen
su manejo de ausencia/errores. Se mantienen los tipos para rutas de importación
Artlist/cloud-storage/Google Drive y Open Design detectados por typecheck.
Esto no acredita pruebas E2E de cada importador, ni controles de todos los accesos
service-role fuera de los helpers intervenidos. Aumenta una comprobación final de
artefacto para componente ForTenant; la caché de autoridad es por request.

## Siguiente paso

F1.3.c: resolver identidad divergente GoTrue/Auth Bridge, switch-organization y
errores HTTP 503 por lote. TD-26 permanece abierto; faltan grants/RLS de roles y
aceptación real de entorno. No certificar toda la fase con estas suites simuladas.
Reversión: revertir solo commit F1.3.b, preservando documentos previos; ante
incidente mantener denegación segura, no rehabilitar prelecturas sin scope.
Los logs completos quedan locales en reports/; el commit conserva este resumen.
