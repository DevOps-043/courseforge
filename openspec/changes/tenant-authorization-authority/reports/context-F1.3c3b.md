# Continuidad F1.3.c.3.b — 2026-11-04

Zona America/Mexico_City; responsable local Codex. HEAD base 372d891a, staging.
Se preserva documentación heredada y logs anteriores. Sin proveedores reales,
SQL remoto, instalación, render, generación pagada o despliegue.
Estado: F1.3.c.3.b cerrado como lote local; TD-26 y ownership adicional pendientes.

## Alcance y solución

Cinco rutas, nueve métodos: syllabus GET/PATCH/DELETE/POST; prompt GET;
documents POST; imports GET/POST; storage/signed-upload-url POST.
Se reutiliza authorizationUnavailableResponse para errores de clases internas de
identidad/tenant con 503, retryable, correlación, mensaje fijo y no-store privado.

POST syllabus proyecta el error después de su bloque existente de compensación
de reserva. No cambia su estrategia de reserva ni sus operaciones de rollback.
Las demás entradas proyectan en catch antes del logger genérico. Imports usa su
errorResponse común, conservando SyllabusImportError/Zod y demás contratos.
Prompt conserva 503 para sus fallos ajenos a autoridad. Documentos mantiene sus
errores de archivos/extracción; tenant ausente ahora se rechaza 403 antes de leer
multipart. No cambia tamaño ni parser multipart (TD-27 permanece abierto).

Hallazgo adicional durante inspección: resolveActiveUploadOrganizationId usaba
cf_active_org, claims y cf_user_orgs cuando fallaba el resolver. Se retiró ese
fallback y sus imports. Toda firma exige tenant vigente, incluso thumbnails y
production-videos. No modifica formatos de paths, buckets, MIME, límites, media
HyperFrames ni credenciales de upload. La relación actor/tenant usa el resolver
compartido de unidades previas.

Archivos: las cinco rutas; source-test-loader.ts incorpora URL/File reales para
ejecutar handlers; syllabus-authority-http.test.ts; script Auth Bridge y OpenSpec.
No se cambia el servicio de importación, workers ni documento multimedia.

## Evidencia

| Comando | Resultado | Evidencia / límite |
|---|---|---|
| npm run test:auth-bridge --workspace=apps/web | 0 | f1-3c3b-auth.log; contrato previo y 70/70 tests, once nuevos respecto al lote anterior |
| npm run typecheck | 0 | f1-3c3b-check-0.log |
| npm run test:security-boundaries | 0 | f1-3c3b-check-1.log |
| npm run test:syllabus-import-flow --workspace=apps/web | 0 | f1-3c3b-check-2.log |
| npm run test:syllabus-duration --workspace=apps/web | 0 | f1-3c3b-check-3.log |
| npm run db:migrations:check | 0 | f1-3c3b-check-4.log; sin ejecutar SQL |
| git diff --check | 0 | Sin errores; advertencias CRLF de Git |
| npm run verify:pr | 2 | f1-3c3b-gate.log; arnés/documentación/OpenSpec aprobados; fallo previo ESLint |
| npm run docs:check final | 0 | f1-3c3b-docs-final.log |

Se ejecutan handlers reales transpiliados, schemas/parser JSON reales,
authorizeSyllabusImport real, api-response real con NextResponse.json sustituido
por Response.json. Request/FormData/File/Headers/URL son objetos nativos.
Identidad, tenant y acceso al artefacto se simulan para inyectar ambas clases de
error en cada frontera. Para documentos la prueba de artefacto atraviesa el
parseo multipart. Los tests comprueban 503/no-store/correlación/retryable y
ausencia de mensajes crudos. Spies impiden firma, extracción, persistencia,
consulta de prompts, generación y dispatch después del fallo. Dependencias
posteriores a autorización se sustituyen sin ejecutar proveedores.
También se prueban tenant ausente (documentos/upload) y errores de documentos
sin archivos 400/tamaño declarado 413. No es cobertura de todas las cuotas HTTP.
La compensación posterior a una reserva se conserva por inspección del diff;
la nueva suite inyecta fallos antes de la reserva, sin acreditar ese interleaving.

## Revisión propia y riesgos residuales

Se aplicaron tenant-security-change, api-job-change y criterios de
adversarial-review; revisión del mismo agente, sin independencia. Ningún mapper
concede acceso o evita la compensación de reserva ya existente. No se ensayan
operaciones reales de firma ni uploads. Los tests no certifican SQL/RLS ni CI.

Las ramas genéricas thumbnails/production-videos no muestran una comprobación
explícita de pertenencia del path al tenant/recurso. Exigir tenant cierra el
fallback de autoridad, pero no acredita ownership completo. F1.3.c.3.b.2 debe
reconstruir consumidores, convenciones de paths y permisos efectivos de Storage,
probar paths propios/ajenos y acotar firma sin romper compatibilidad. No se afirma
explotación remota ni se cambia el denominador histórico de la auditoría por esta
observación estática; registrar hallazgo adicional al caracterizar impacto.

## Siguiente paso y reversión

Priorizar F1.3.c.3.b.2 (ownership upload) y después F1.3.c.3.c (producción y otros
contratos). TD-26 y F1.3 siguen en curso; permisos de roles/RLS y aceptación real
de ambiente pendientes. Recuperar este registro y contrastar HEAD/status antes
de editar. No normalizar globalmente respuestas específicas de preview/render.
Reversión: commit local del lote; preservar rechazo seguro de autorización.
Los logs completos quedan locales en reports/; este archivo conserva resultados.
