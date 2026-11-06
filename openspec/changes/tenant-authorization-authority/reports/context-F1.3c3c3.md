# Continuidad F1.3.c.3.c.3 — 2026-11-05

Zona America/Mexico_City; responsable Codex; base f2996baa, staging.
Estado: cerrado como lote HTTP local; objetivo global, F1.3 y TD-26 activos.

Alcance: siete rutas/dieciséis métodos: HeyGen connection GET/POST/DELETE y
validate POST; HyperFrames connection GET/POST/DELETE y validate POST; HyperFrames
settings GET/PUT; assembly-branding GET/PUT/PATCH; LiveAvatar GET/POST/DELETE.
Solo proyectar clases internas de autoridad antes de errores genéricos/de proveedor.
Conservar schemas, DTO, permisos, orden de efectos y errores específicos.

Pruebas con handlers/NextResponse/parser/schemas/clases de error reales y dobles
de DB, credenciales, webhooks y medios. No leer claves ni .env, no consultar
proveedores ni crear embeds/webhooks reales. Las pruebas no autorizan efectos
de configuración externos. No hay cambios de contratos de proveedor ni motion.

## Evidencia

| Comando | Código / resultado | Archivo |
|---|---|---|
| Primer intento de caracterización | 1; 16 fallos HTTP y 2 artefactos de comparación entre realms VM | f1-3c3c3-before.log |
| Caracterización tras clonar defaults al realm del test | 1; 16 métodos fallan por 500 en vez de 503, 11 escenarios de compatibilidad pasan | f1-3c3c3-before-verified.log |
| npm run test:auth-bridge --workspace=apps/web | 0; 135/135 | f1-3c3c3-auth.log |
| npm run lint | 0; 572 warnings sin cambios de huellas | f1-3c3c3-lint.log |
| npm run typecheck | 0 | f1-3c3c3-types.log |
| npm run test:security-boundaries | 0 | f1-3c3c3-security.log |
| npm run test:hyperframes --workspace=apps/web | 0; script completo | f1-3c3c3-hyperframes.log |
| npm run db:migrations:check | 0; versiones, sin SQL | f1-3c3c3-migrations.log |
| npm run verify:pr | 1; 42 ítems OpenSpec, 26 tests arnés, lint/tipos pasan; 11 ciclos | f1-3c3c3-gate.log; 2.282 archivos/582 warnings Madge |
| docs:check y openspec:validate finales | 0 / 0 | f1-3c3c3-docs.log / f1-3c3c3-openspec.log |
| git diff --check | 0 | Advertencias CRLF, sin errores |

Los 27 tests nuevos contienen 96 pares método/frontera/clase de autoridad
(16 métodos × identidad/rol/tenant × dos clases). Comprobaron 503 seguro,
retryable/correlación/no-store y cero clientes, servicios, lecturas, escrituras,
webhooks, proveedor, medios o limpieza después del fallo. Otros casos cubren
401/403, consultas, validación, save antes de webhook, errores de webhook tras
guardar, desconexión con capacidad compartida, clear RPC sin clave anterior,
settings y fallback inválido, selección y finalización 201/replay 200/conflicto
409, metadatos/video/duración rechazados y dispose/cleanup. LiveAvatar cubre
catálogo desconectado/conectado, conexión y embedding 201/conflicto 409,
credenciales con providerCode, API 400/429/502 y retryable preservado. Los códigos
falsos de autoridad no se aceptan como clases internas.

## Revisión y límites

Revisión propia con adversarial-review, sin independencia. Producción cambia
solo imports y guards de error: 35 líneas añadidas en siete rutas. LiveAvatar
centraliza el guard en su formatter existente. No cambia el orden de autorización,
schemas, DTO, efectos o finally de liberación de mediabunny. El loader incorpora
Response nativo para probar correctamente instanceof Response en ensamble.

Las pruebas ejecutan handlers/NextResponse/parser/schemas y clases reales;
DB, credenciales, webhooks, SDK y mediabunny son dobles. No se leen o descifran
claves reales. El checksum de ensamble usa metadatos sintéticos; no acredita
decodificación de vídeo ni firma/limpieza real de Storage. Los filtros se registran
como argumentos; no certifican RLS/SQL. Los errores de autoridad se inyectan antes
de efectos. El fallo de webhook posterior a save conserva la respuesta existente
y no demuestra compensación, atomicidad o reintento idempotente externo.

Los defaults VM se comparan tras structuredClone: corrige artefactos de prototipos,
sin cambiar el DTO esperado ni tratar esos dos fallos como defectos de producto.
Todo servicio y estado de credencial es sintético. Sin .env, servicios reales,
generación, despliegue, envíos ni SQL remoto. La suite completa de HyperFrames
vuelve a ejecutarse tras el prerrequisito F3.4.a; no se certifica CI por ello.

Siguiente lote de autoridad: F1.3.c.3.c.4, operaciones/clips/jobs HeyGen; quedan
slides/open-design, automatización/standalone y soportes HTTP HyperFrames.
F0.3 está habilitada para clasificar los once ciclos y warnings del gate antes
de F3.5. El objetivo global conserva todas las unidades del plan principal.
Reversión por commit local del lote; no hay efectos remotos que revertir.

El commit que contiene este registro limita código/pruebas/documentación al lote.
La auditoría heredada y el plan se conservan fuera del commit. Todos los handles
de verificación están terminales; no hay procesos que reiniciar. No archivar
este OpenSpec mientras F1.3 y aceptación de ambiente permanezcan pendientes.
