# Continuidad F1.3.c.3.a — 2026-11-04

Zona America/Mexico_City; responsable local Codex. HEAD base a95f8099, staging.
Trabajo heredado de auditoría y logs de unidades previas preservados.
Estado: F1.3.c.3.a cerrado como lote local; F1.3.c.3 y TD-26 en curso.

## Alcance y diagnóstico

Se inicia la normalización HTTP por lotes: save-draft, publish y admin/users
convertían errores de identidad/tenant en 500. Ahora usan una proyección común
de las clases AuthIdentityLookupError y TenantContextLookupError a 503
DEPENDENCY_UNAVAILABLE, retryable y correlación estándar.
El mensaje es fijo, no refleja error.message. Headers privados no-store/Vary
Cookie impiden almacenar una indisponibilidad de autorización como respuesta
reutilizable. El mapper emite un aviso estructurado con código y correlationId,
sin error crudo ni identidad. Errores ajenos a estas clases no se reclasifican.

Archivos: authorization-unavailable-response.ts mantiene la proyección HTTP;
las tres rutas agregan su guard en catch antes del logger genérico. No cambia
schemas, permisos, publicación/outbox ni jobs. source-test-loader.ts incorpora
Headers real para ejecutar api-response.ts en la VM de tests; package.json
conecta authorization-http.test.ts al script existente de Auth Bridge.

## Pruebas

| Comando | Resultado | Evidencia / límite |
|---|---|---|
| npm run test:auth-bridge --workspace=apps/web, primer corte | 0 | f1-3c3a-auth.log; contrato previo y 59/59 tests, siete nuevos respecto a F1.3.c.2 |
| Auth Bridge final con aviso seguro | 0 | f1-3c3a-auth-final.log; 59/59 |
| npm run typecheck | 0 | f1-3c3a-check-0.log |
| npm run test:security-boundaries | 0 | f1-3c3a-check-1.log |
| npm run test:publication --workspace=apps/web | 0 | f1-3c3a-check-2.log; cliente, no carrera SQL |
| npm run db:migrations:check | 0 | f1-3c3a-check-3.log; versiones, sin aplicar SQL |
| git diff --check | 0 | Sin errores; advertencias CRLF de Git |
| npm run verify:pr | 2 | f1-3c3a-gate.log; arnés/documentación/OpenSpec aprobados; fallo previo ESLint |
| npm run docs:check final | 0 | f1-3c3a-docs-final.log |

La nueva suite ejecuta fuentes HTTP reales con Request real, parser JSON y schemas
reales. api-response.ts real se ejecuta con NextResponse.json sustituido por
Response.json; la serialización y headers estándar sí son reales. No es servidor
Next desplegado. Identidad, tenant, DB, dispatch y revalidate se simulan.
Para cada ruta se inyectan ambas clases en identidad/tenant y en autorización
de artefacto donde existe. Se comprueban 503, retryable, requestId/correlationId,
headers y ausencia de detalles sensibles. Los spies rechazan toda consulta,
escritura, revalidación o dispatch posterior al fallo; objetos con un code
parecido no se aceptan como clase de autoridad. Validación inválida sigue 400 y
error genérico sigue 500. El aviso seguro conserva correlación sin mensaje crudo.

## Revisión y límites

Revisión propia según adversarial-review, sin independencia. El mapper no añade
fallback ni ejecuta mutaciones. Las denegaciones 401/403/404 existentes conservan
su contrato. Sin SQL remoto, servicios reales, envío de publicación ni despliegue.
Las pruebas del cliente de publicación no cubren carrera SQL; TD-28 no se cierra.
Los fallos conocidos se mapean donde se propagan; no se afirma normalización de
errores capturados antes por otros servicios. TD-26 y F1.3 permanecen abiertos.

## Siguiente punto

F1.3.c.3.b: syllabus, syllabus/prompt, syllabus/documents, importación de syllabus
y storage/signed-upload-url. Revisar catches y contratos antes de reutilizar mapper:
prompt ya retorna 503 genérico, documentos actualmente puede devolver 400 con
message de excepción. Preservar errores legítimos de archivos/quotas; probar que
una autoridad caída no inicia extracción, persistencia ni generación.
F1.3.c.3.c: rutas de producción con respuestas específicas y wrappers de acceso;
inventariar y dividir por capacidad si requieren tests propios. No cambiar UI de
identidad 500 ni contratos de preview/render automáticamente.
La aceptación SQL/grants/RLS y ambiente sigue pendiente antes de cerrar TD-26.

Reversión: commit local del lote, conservando rechazo seguro de los helpers.
Los logs completos quedan locales; este documento registra comandos/códigos.
