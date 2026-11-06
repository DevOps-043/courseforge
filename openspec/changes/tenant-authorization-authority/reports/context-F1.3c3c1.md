# Continuidad F1.3.c.3.c.1 — 2026-11-05

Zona America/Mexico_City; responsable Codex. Base 1d364f89, staging.
Estado: cerrado como lote HTTP local. Objetivo global de deuda activo;
F1.3.c.3.c, F1.3 y TD-26 permanecen abiertos.

## Alcance y aceptación

Siete métodos: Artlist search GET/import POST; Google Drive list GET/import POST;
cloud-storage list GET/import POST; import-external POST. Conservar schemas,
permisos, selección de proveedor, mappers de cuota/capacidad/timeout y DTO.
Mapear únicamente clases internas de autoridad a 503 seguro, antes del catch
genérico o del mapper externo. No modificar algoritmos de importación ni HTML,
documentos, render, snapshots, UI o firma de jobs. No hay proveedores reales.

Import-external resuelve tenant dentro del callback de consulta de videoId de
HeyGen; esa frontera también debe impedir consulta/descarga tras un fallo.
Artlist search es un catálogo global autenticado: no se añade una nueva exigencia
tenant ni se modifica su contrato de permisos.

El loader de pruebas comparte Error y DOMException nativos entre módulos VM,
igual que la aplicación; permite probar instanceof y errores de proveedor reales
sin falsos negativos por realms distintos. Las dependencias de red/DB se simulan;
schemas, parser, respuestas, mapper externo y resolver de origen de vídeo son reales.

## Evidencia

| Comando | Código / resultado | Archivo |
|---|---|---|
| Suite nueva antes de corregir handlers | 1; 7 fallan por 500/502 en vez de 503, cuatro casos de compatibilidad aprueban | f1-3c3c1-before.log |
| Auth Bridge inicial | 0; 86/86 | f1-3c3c1-auth.log |
| Auth Bridge final con casos particulares HeyGen | 0; 87/87 | f1-3c3c1-auth-final.log |
| npm run lint | 0; mismos 572 warnings, sin diferencias de huellas | f1-3c3c1-lint.log |
| npm run typecheck | 0 | f1-3c3c1-types.log |
| npm run test:security-boundaries | 0 | f1-3c3c1-security.log |
| npm run verify:pr | 1; arnés 26/26, OpenSpec 41/41, lint y tipos aprueban; 11 ciclos pendientes | f1-3c3c1-gate.log; 2.278 archivos/582 warnings de Madge |
| npm run db:migrations:check | 0; versiones, sin ejecutar SQL | f1-3c3c1-migrations.log |
| docs:check y openspec:validate finales | 0 / 0 | f1-3c3c1-docs-final.log / f1-3c3c1-openspec-final.log |
| git diff --check | 0 | Advertencias CRLF de Git, sin errores |

Los siete tests de autoridad recorren 32 pares frontera/clase de error. Verifican
503/DEPENDENCY_UNAVAILABLE/retryable, correlación, private no-store y ausencia de
mensaje sensible; cero construcción de proveedores, importaciones o persistencia
después del fallo. Las otras cinco pruebas cubren ausencia 401/403/404, validación
400 y tamaño declarado 413, DTO positivo de los tres listados, fallback genérico,
reconexión 409, cuota 413, recurso 404, timeout 504 y saturación/circuito 503 con
Retry-After. Las clases particulares de HeyGen se sustituyen para probar sus
ramas HTTP 403/409/502; no se acredita SDK real ni consulta al proveedor.

Se ejecutan fuentes/parser/schemas/api-response/mapper externo y resolver de
origen reales. Los servicios externos, limiter de ejecución, identidad y DB son
dobles. Las clases de capacidad y circuito son reales; el limiter no se somete
a concurrencia en esta suite (la suite de seguridad existente lo prueba aparte).
NextResponse.json se adapta a Response.json nativo; no se levanta Next desplegado.

## Revisión propia y límites

Se revisaron imports, orden de guards y catches, schemas y efectos posteriores;
no hay revisión independiente. El mapper opera solo sobre clases internas, no
sobre códigos similares en objetos arbitrarios. Los errores externos no se
reclasifican; no se amplían roles/tenants ni se cambian efectos del caso feliz.

No se prueban aquí descarga/upload real, persistencia exitosa de un import,
fallos después de guardar bytes ni recuperación/idempotencia de efectos parciales.
No se certifican permisos SQL/RLS ni límites incrementales de transporte (TD-27).
Los errores se inyectan antes de los efectos del proveedor. El orden de descarga,
registro y RPC existente se conserva por inspección; su atomicidad no se modifica.

Siguiente lote F1.3.c.3.c.2: lectura de medios/descargas, audio y biblioteca SFX;
caracterizar respuestas binarias/range y sus fronteras antes de añadir guards.
También quedan integraciones/HeyGen, slides/open-design, automatización/standalone
y soportes HTTP HyperFrames. F1.3 y TD-26 continúan abiertos. El objetivo global
sigue el plan principal; F0.3 y el resto de unidades no se sustituyen por este lote.

Se conservan auditoría y documentación heredadas sin incluirlas en el commit.
Reversión: commit local de este lote, preservando denegación segura. No hay
SQL, publicación, despliegue, generación ni uploads de prueba.

Checkpoint: el commit local que contiene este registro reúne las siete rutas,
loader/suite/script Auth Bridge y este OpenSpec; consultar git log para su ID.
No quedan procesos de verificación en ejecución. No archivar este OpenSpec:
F1.3 y la aceptación de ambiente todavía no están integradas/certificadas.
