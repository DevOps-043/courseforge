# Fuentes documentales propias — contrato de fase 1

Estado: base y biblioteca/extracción implementadas localmente; migraciones no aplicadas remotamente y despliegue no realizado. La biblioteca está en preparación de borrador, Base, Temario y Fuentes. El pipeline de generación conserva sus consumidores históricos; no anunciar generación documental completa como operativa.

Actualización F2: `POST /api/artifacts/:artifactId/sources/documents/:documentId` solicita extracción firmada; `GET` devuelve fragmentos autorizados y `?download=1` una descarga privada de 60 segundos. `POST ?action=retire` retira lógicamente sin borrar original. Migración `20261106010000_course_source_extraction.sql`: lease de diez minutos, tres intentos máximos, persistencia atómica y recuperación explícita. Parser con límite 40,000 caracteres, fragmentos con posiciones en texto normalizado. `READY` acredita extracción, no cobertura curricular. Sustitución versionada y conciliación de huérfanos continúan pendientes; ver [evidencia F2](../../openspec/changes/course-owned-document-sources/reports/phase-2.md). Las secciones siguientes conservan el contrato base F1; la extracción nueva sustituye sus límites temporales de disponibilidad.

## Responsabilidades

`apps/web/src/domains/course-sources` separa schemas, reglas de recepción, repositorio, Storage, autorización y adaptación HTTP. Sus rutas delegan casos de uso; no importan proveedores IA ni disparan jobs.

La biblioteca es independiente de `syllabus_source_documents` y del flag `PROVIDED_SYLLABUS_ENABLED`. El cargador histórico de Temario y la acción PDF de curación conservan su contrato. El creador histórico `generateArtifactAction` sigue iniciando IA; no debe utilizarse para crear un borrador documental. La conexión entre el nuevo borrador y generación pertenece a una fase posterior.

## API implementada

Todos los endpoints usan Auth Bridge y organización activa del servidor; aceptan ADMIN, SUPERADMIN, ARQUITECTO o CONSTRUCTOR vigentes. El acceso al curso usa el contrato actual por organización, no una nueva regla de propiedad exclusiva del creador. La firma y confirmación de una reserva sí pertenecen al actor que la creó. Los cuerpos son estrictos y no aceptan identidad, organización, rutas Storage ni estado elegidos por el cliente.

| Método/ruta | Entrada | Resultado |
|---|---|---|
| `POST /api/artifacts/drafts` | `idempotencyKey` UUID, `title` de 1..300 caracteres | `artifactId`, `state: DRAFT`; no inicia IA. |
| `GET /api/artifacts/:artifactId/sources` | `offset` (0..100000), `limit` (1..50; predeterminado 20) | Documentos paginados, `nextOffset`; sin texto, hashes, actores ni rutas privadas. |
| `POST /api/artifacts/:artifactId/sources/uploads` | `idempotencyKey` UUID, `filename`, `mimeType`, `sizeBytes`, `sha256` hexadecimal minúsculo | Documento y capacidad de upload privada, o `upload: null` si ya fue confirmado. |
| `POST /api/artifacts/:artifactId/sources/uploads/confirm` | `documentId` UUID | Documento recibido con estado `UPLOADED`. |

Máximo JSON: 4096 bytes. Las mutaciones requieren `Content-Type: application/json` y rechazan origen cruzado si `Origin` o `Sec-Fetch-Site` lo indican; no añaden CORS permisivo. Respuestas usan el envelope existente con `requestId`, `correlationId`, `success`, y `Cache-Control: private, no-store`. Códigos: 400 contrato, 401 sesión/tenant ausente, 403 rol/actor/origen, 404 recurso no autorizado, 409 reserva/conflicto, 413 tamaño, 415 contenido incompatible, 429 cuota y 503 dependencia. La indisponibilidad de autoridad conserva el mapper común 503 y nunca habilita acceso alternativo.

## Protocolo de carga

1. Crear borrador o usar un curso autorizado. Repetir clave y título devuelve el mismo ID; cambiar el título con la misma clave produce conflicto.
2. Calcular SHA-256 local de los bytes y reservar carga. Solo PDF, DOCX, PPTX y TXT con extensión/MIME coincidentes; nombre sin controles ni separadores de ruta.
3. El servidor genera documento y ruta inmutable `organizations/<org>/courses/<curso>/<documento>`. Firma sin sobrescritura en `course-source-originals`; no guardar esa capacidad en logs o documentos públicos. La capacidad usa la vigencia del SDK Storage (dos horas); la reserva en DB vence dos horas después de crearse y nunca se renueva por reintento.
4. El cliente sube con el mecanismo firmado de Storage y tipo declarado. La URL no demuestra recepción ni aptitud curricular.
5. Confirmar: servidor consulta metadata, comprueba tamaño antes de descargar, verifica bytes reales, hash e inspección inicial de formato. Office limita entradas antes de materializar el directorio; TXT exige UTF-8 y ausencia de NUL. PDF comprueba cabecera. No se descomprime contenido Office ni se extrae texto aquí.
6. La RPC bloquea la fila y confirma `UPLOADED` una sola vez. Confirmaciones repetidas devuelven su estado sin descargar de nuevo. Timeout o error de DB requieren consultar listado/volver a confirmar la misma reserva; no borrar originales como compensación.

`UPLOADED` solo acredita recepción verificada. PDF con cabecera puede seguir siendo corrupto o escaneado; Office puede tener XML inválido. La extracción, budgets de descompresión, diagnóstico, estado `READY` y evaluación curricular pertenecen a F2/F3 y aún no se exponen. No hay job de extracción en esta fase.

## Persistencia y seguridad

Migración: `supabase/migrations/20261105010000_course_owned_document_sources.sql`.

- `course_source_settings`: política opcional y revisión; `null` significa elección pendiente. No se habilita ninguna política por defecto ni se conecta aún al generador.
- `course_source_drafts`: idempotencia por organización/actor/clave y vínculo al borrador.
- `course_source_documents`: intención de carga, bytes/hash, referencia privada, estado e identidad inmutables. Reemplazo futuro crea otro ID; no sobrescribe el original.
- `course_source_fragments`: texto y localizador; no se escribe desde las rutas F1.
- `course_source_assignments`: asociaciones versionadas con lecciones y revisión; no hay endpoint F1 para aprobarlas.
- `course_source_snapshots` y `course_source_snapshot_items`: contrato inmutable de evidencia por ejecución/etapa; las FK compuestas impiden vincular fragmentos de otro curso. No crean integraciones con jobs por existir las tablas.

Mapa para F4: `curation_rows` seguirá como resultado por lección y conservará IDs históricos. El adaptador resolverá documentos/asociaciones aprobados a IDs de evidencia del snapshot, sin copiar el texto a `validation_report`; Materiales consumirá el fragmento canónico. No se añade FK de `lesson_id` a un identificador supuesto: actualmente las lecciones viven dentro del JSON versionado del plan. La validación de pertenencia curricular y el compare-and-swap de revisión se implementan en F3/F4 antes de exponer escrituras de asociaciones. La columna `source_revision` y las versiones de snapshot son el contrato de esas guardas, no una invalidación ya conectada al pipeline.

RLS activa, sin grants ni políticas permisivas de tablas nuevas para `anon`/`authenticated`. RPC `SECURITY INVOKER` con `search_path` vacío, ejecutables solo por service-role. API autoriza antes de construir el repositorio. El backend tiene SELECT/INSERT; UPDATE únicamente sobre documentos para confirmar y avanzar estado; no DELETE. Snapshots/fragmentos no tienen UPDATE. El trigger de documentos protege identidad, bytes, hash y localizador ante cambios accidentales desde backend.

Storage: bucket privado con formatos y 15 MB máximos; política restrictiva impide SELECT/INSERT/UPDATE/DELETE directos del nuevo bucket para roles de navegador, incluso frente a políticas permisivas previas. No se amplía la lista de buckets de la ruta genérica de firma.

## Cuotas iniciales y concurrencia

| Límite | Valor |
|---|---|
| Archivo | 15 MB |
| Curso | 50 reservas/documentos, 200 MB |
| Organización | 500 reservas/documentos, 2 GB |
| Borradores documentales | 50 por actor/organización en 24 horas |
| Directorio Office | 2000 entradas; ZIP64 y volúmenes múltiples rechazados |

La reserva serializa por organización mediante bloqueo transaccional corto, comprueba cuotas e inserta en una transacción. Reservas vencidas y fuentes retiradas continúan contando hasta que exista conciliación/retención; F1 no purga. Un hash repetido en un curso produce conflicto y debe reutilizarse el documento existente; no revela duplicados de otra organización. Las cuotas SQL y constantes de aplicación deben cambiar conjuntamente y validarse mediante pruebas.

## Puesta en servicio y reversión

Antes de ejecutar SQL remoto autorizado: comprobar versión de migraciones, backup, enum `artifact_state` con `DRAFT`, tablas `profiles`/`artifacts`, grants service-role e historial de políticas Storage. Ensayar con el rol real de backend, sin superusuario. Aplicar el archivo entero; incluye transacción y no utiliza `IF NOT EXISTS` para ocultar aplicación parcial.

Postflight: tablas nuevas con RLS; RPC sin EXECUTE para navegador; bucket privado/límite/MIME; política restrictiva activa; originales inaccesibles por acceso directo; rutas y configuración de aplicación coordinadas. Las pruebas PGlite usan un Storage SQL mínimo y no acreditan el servicio Storage ni Auth Bridge desplegados.

La reversión operativa conserva datos y bloquea nuevas llamadas a estas rutas en el despliegue. No borrar tablas ni volver públicos los originales. Las fases futuras añadirán habilitación por organización antes del piloto de generación; no activar el nuevo flujo desde UI hasta integrar sus guardas.

## Verificación

- `npm run test:course-sources`: contratos/servicios/HTTP y migración real en PGlite aislado, sin configuración remota. Requiere runtime temporal PGlite: por defecto `apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js`; override `COURSE_SOURCES_PGLITE_PATH`. No es dependencia de producción.
- Preparación del runtime si falta: `npm install --prefix apps/web/.tmp/syllabus-sql-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8`. No instala ni conecta una base remota.
- `npm run db:migrations:check`, `npm run typecheck`, `npm run verify:pr` y suites de autoridad correspondientes.

Diseño de las fases siguientes y criterios de aceptación: [OpenSpec](../../openspec/changes/course-owned-document-sources/tasks.md). La cobertura por contenido, citas y elección de política por curso se implementarán después de esta base.
