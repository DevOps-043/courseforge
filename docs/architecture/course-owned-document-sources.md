# Fuentes documentales propias — recepción, extracción y ciclo de vida

Estado: base y biblioteca/extracción implementadas localmente; migraciones no aplicadas remotamente y despliegue no realizado. La biblioteca está en preparación de borrador, Base, Temario y Fuentes. El pipeline de generación conserva sus consumidores históricos; no anunciar generación documental completa como operativa.

## Política y revisión de cobertura — fase 3

Migración aditiva `20261106030000_course_source_policy_review.sql`. La biblioteca ofrece «Solo mis archivos» y «Mis archivos + fuentes web» sin preselección. El modo `WEB_ONLY` queda como compatibilidad del flujo histórico; no se reinterpreta `A_WITH_SOURCE`/`B_NO_SOURCE` como autorización para navegar. Cursos sin configuración documental conservan consumidores y cuotas web anteriores. La elección puede guardarse antes de Base sin requerir un plan ni ejecutar IA; cambiar una elección existente pide confirmar la invalidación.

API `GET /api/artifacts/:artifactId/sources/review` devuelve política, revisión, token curricular, evidencia vigente, asociaciones y cobertura. `?policyOnly=1` evita cargar la revisión curricular completa cuando solo se necesita configurar el modo. El rol de aprobación se proyecta desde el tenant resuelto en servidor. `POST` admite comandos estrictos:

- `policy`: `expectedRevision`, `curriculumHash`, `policy`.
- `propose`: sugerencias deterministas por coincidencias entre objetivo/tema y texto; no llama IA, no guarda ni verifica automáticamente.
- `save`: versión y hash esperados, más `associations` con `lessonId`, `evidenceType` (DOCUMENT/WEB), `evidenceId`, `requirementIds`, confirmación de suficiencia (`verified`), contradicción (`conflict`) y resolución. Servidor valida pertenencia y vigencia; el cliente no suministra requisitos, actor, organización o autoridad de revisor.
- `approve`: versión y hash esperados; solo un revisor vigente puede aprobar el conjunto guardado, con plan aprobado, evidencia para cada requisito y contradicciones resueltas. Se conserva el actor de creación y aprobación.

El objetivo usa ref `objective`; temas, `topic:<índice>` bajo el token curricular. El token representa módulos, plan/estado y las partes curriculares de entrega sincrónica/híbrida; cambios de materiales o render no se incluyen. Es un mecanismo de concurrencia, no una credencial ni una afirmación de autenticidad. Máximo 1000 requisitos, 1000 evidencias por procedencia y 1000 asociaciones; excesos producen error, no truncamiento silencioso. El comando de revisión admite hasta 512 KiB y la evidencia textual hasta 2 MiB por revisión. Propuestas indexan términos una vez y la UI monta una lección de revisión a la vez para limitar DOM.

`sourceCoverage` es el criterio compartido de UI, API y worker documental. Cuenta requisitos respaldados y confirmados, no archivos. Un manual puede cubrir todo el curso. En mixto se distingue evidencia documental de URLs revisadas; la búsqueda pide solo los requisitos faltantes y un presupuesto proporcional a vacíos. Las URLs técnicamente válidas siguen pendientes de suficiencia humana; no aprueban el curso automáticamente. La rama histórica conserva el mínimo web y su aprobación previa. PDF manual legado no se convierte implícitamente en URL pública: su adaptador documental pertenece a F4.

Persistencia: `course_source_review_versions`, `course_source_review_approvals` y `course_source_policy_changes` son historiales inmutables para el rol backend, con RLS y sin permisos para navegador. Las versiones guardan referencias sin duplicar texto. La RPC compara revisión y token bajo bloqueo, revalida IDs y estados, y registra actor. La evaluación semántica queda en revisión humana, no se acredita por un hash o cita válida.

Decisión de implementación: las asociaciones vigentes son el conjunto de referencias de `course_source_review_versions` para la revisión actual. El contrato normalizado `course_source_assignments` preparado en F1 no se rellena en paralelo ni se interpreta como cobertura real; F4 debe consumir las revisiones aprobadas o derivar una proyección explícita, sin crear dos fuentes de verdad.

Cambiar política, asociaciones o disponibilidad de documentos invalida dependencias en la misma transacción; un fallo revierte también el cambio. Los workers de curación documental confirman progreso con revisión/token/attempt vigentes. La validación de URLs existentes invalida una revisión si cambia su contenido o aptitud. La aprobación histórica por contar URLs no puede saltarse la revisión documental. Un cambio curricular vuelve obsoleto el token; actualizar y revisar de nuevo antes de aprobar.

**Límite temporal de F3:** las guardas bloquean Base/Temario/Plan/Materiales documentales, incluido modo aún sin elegir, hasta integrar los contextos en F4. No se permite ejecutar el motor anterior como si hubiera leído la biblioteca. La revisión documental y su curación sí están implementadas; no se anuncia todavía generación completa desde documentos. Los cursos históricos sin configuración y `WEB_ONLY` conservan generación. No se regeneran cursos por cambiar una política.

Verificación y cierre: [fase 3](../../openspec/changes/course-owned-document-sources/reports/phase-3.md). QA visual reproducible: `npm run qa:course-source-policy` con componentes/CSS reales y API sintética local; no acredita el piloto de producción.

Actualización F2: `POST /api/artifacts/:artifactId/sources/documents/:documentId` solicita extracción firmada; `GET` devuelve fragmentos autorizados y `?download=1` una descarga privada de 60 segundos. `POST ?action=retire` retira lógicamente sin borrar original. Migración `20261106010000_course_source_extraction.sql`: lease de diez minutos, tres intentos máximos, persistencia atómica y recuperación explícita. Parser con límite 40,000 caracteres, fragmentos con posiciones en texto normalizado. `READY` acredita extracción, no cobertura curricular. La migración aditiva `20261106020000_course_source_lifecycle.sql` completa sustitución e inspección/purga separada; ver [cierre F2](../../openspec/changes/course-owned-document-sources/reports/phase-2-close.md). Las secciones siguientes conservan el contrato base F1; las ampliaciones F2 sustituyen sus límites temporales de disponibilidad.

## Sustitución e historial

`POST /sources/uploads` admite `supersedesId` opcional. La RPC v2 autoriza el mismo curso/organización, requiere un predecesor READY y crea un ID/objeto nuevo con FK compuesta. Una sola sustitución no retirada puede apuntar a cada versión; la clave idempotente incluye el vínculo y no admite cambiarlo. Se aplican las mismas cuotas acumuladas y límites F1. Se rechazan archivos idénticos ya registrados con 409: reutilizar el original, sin duplicarlo.

El predecesor sigue READY durante carga, extracción fallida o interrupción del sucesor. Cuando este completa READY, un trigger retira el anterior en la misma transacción; si el anterior dejó de estar disponible, se revierte la finalización. Se conservan original, fragmentos, fechas y vínculo; no hay UPDATE de identidad ni borrado de versiones históricas. La biblioteca muestra todas las versiones y permite descarga autorizada del anterior. Una sustitución fallida puede recuperarse hasta el límite de intentos o retirarse antes de preparar otra.

La transferencia muestra progreso por bytes y permite cancelar XHR; la reserva queda para reintento/conciliación y la extracción en curso se cancela lógicamente mediante retirada. El reintento en la misma sesión conserva la clave por hash y predecesor. No confundir porcentaje de transferencia con avance del parser.

## Conciliación, retención y purga autorizada

`POST /api/artifacts/:artifactId/sources/reconciliation` exige JSON, mismo origen y rol revisor (ADMIN/SUPERADMIN/ARQUITECTO) con acceso al curso. Cuerpos estrictos:

- `{ "action": "inspect" }`: inspecciona hasta 50 reservas RESERVED vencidas hace más de 24 horas. Solo un 404 explícito de Storage significa MISSING; otros fallos son UNKNOWN. Guarda actor/fecha y versión observada sin exponer rutas o capacidades de descarga. No borra objetos.
- `{ "action": "purge", "documentId": "<UUID>", "confirmDocumentId": "<mismo UUID>" }`: operación irreversible separada; UI pide escribir el ID exacto. Revalida organización, estado RESERVED y al menos siete días desde vencimiento, conciliación conocida, referencias y versión del objeto. UNKNOWN, referencias o cambio de versión bloquean. Solo borra la ruta persistida en el bucket privado; después comprueba ausencia explícita y conserva registro/actor de autorización. Resultado incierto devuelve error y requiere consulta, nunca acredita éxito por timeout.

Sin purga automática ni borrado de documentos UPLOADED/READY/RETIRED o fragmentos. El historial y las reservas conciliadas siguen contando en cuotas; no se declara una liberación de presupuesto antes de reconciliar datos/retención de forma separada. Para una carga huérfana fuera de una reserva conocida no se ofrece borrado general del bucket: debe investigarse administrativamente antes de autorizar un efecto.

No se ejecutó purga de datos reales al desarrollar esta funcionalidad. En despliegue, el operador debe usar primero inspección, revisar el ID/curso/retención y autorizar cada purga desde el control separado. Mantener el historial de conciliación durante la vida del curso; las fuentes consumidas no tienen borrado automático. Cualquier política de eliminación de curso completo requiere un cambio específico.

## Responsabilidades

`apps/web/src/domains/course-sources` separa schemas, reglas de recepción, repositorio, Storage, autorización y adaptación HTTP. Las rutas de recepción no disparan generación; la ruta de procesamiento solicita el job firmado de extracción, sin proveedores IA.

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

`UPLOADED` solo acredita recepción verificada. PDF con cabecera puede seguir siendo corrupto o escaneado; Office puede tener XML inválido. F2 expone extracción con lectura Office acotada, diagnóstico y estado `READY`; la evaluación curricular pertenece a F3 y todavía no se ofrece.

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

La reserva serializa por organización mediante bloqueo transaccional corto, comprueba cuotas e inserta en una transacción. Reservas vencidas y fuentes retiradas continúan contando incluso tras purgar su objeto: se preservan sus registros y no se anuncia liberación de presupuesto. Un hash repetido en un curso produce conflicto y debe reutilizarse el documento existente; no revela duplicados de otra organización. Las cuotas SQL y constantes de aplicación deben cambiar conjuntamente y validarse mediante pruebas.

## Puesta en servicio y reversión

Antes de ejecutar SQL remoto autorizado: comprobar versión de migraciones, backup, enum `artifact_state` con `DRAFT`, tablas `profiles`/`artifacts`, grants service-role e historial de políticas Storage. Ensayar con el rol real de backend, sin superusuario. Aplicar el archivo entero; incluye transacción y no utiliza `IF NOT EXISTS` para ocultar aplicación parcial.

Postflight: tablas nuevas con RLS; RPC sin EXECUTE para navegador; bucket privado/límite/MIME; política restrictiva activa; originales inaccesibles por acceso directo; rutas y configuración de aplicación coordinadas. Las pruebas PGlite usan un Storage SQL mínimo y no acreditan el servicio Storage ni Auth Bridge desplegados.

La reversión operativa conserva datos y bloquea nuevas llamadas a estas rutas en el despliegue. No borrar tablas ni volver públicos los originales. Las fases futuras añadirán habilitación por organización antes del piloto de generación; no activar el nuevo flujo desde UI hasta integrar sus guardas.

## Verificación

- `npm run test:course-sources`: contratos/servicios/HTTP y migración real en PGlite aislado, sin configuración remota. Requiere runtime temporal PGlite: por defecto `apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js`; override `COURSE_SOURCES_PGLITE_PATH`. No es dependencia de producción.
- Preparación del runtime si falta: `npm install --prefix apps/web/.tmp/syllabus-sql-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8`. No instala ni conecta una base remota.
- `npm run db:migrations:check`, `npm run typecheck`, `npm run verify:pr` y suites de autoridad correspondientes.
- `npm run qa:course-sources`: navegador local con React/CSS reales, APIs sintéticas y solicitudes externas bloqueadas; captura escritorio y móvil oscuro, comprueba sustitución/historial, texto seguro y confirmación explícita de purga. No utiliza datos tenant ni acredita Storage desplegado.

Diseño de las fases siguientes y criterios de aceptación: [OpenSpec](../../openspec/changes/course-owned-document-sources/tasks.md). La cobertura por contenido, citas y elección de política por curso se implementarán después de esta base.
