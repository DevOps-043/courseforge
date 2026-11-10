# Fuentes documentales propias — biblioteca, revisión y generación

Estado: fases 1–4 implementadas localmente; migraciones no aplicadas remotamente y despliegue no realizado. La biblioteca está en preparación de borrador, Base, Temario y Fuentes. El pipeline documental usa snapshots y recibos de respaldo; conserva consumidores históricos para cursos anteriores. F5/F6 mantienen validación ampliada y aceptación desplegada pendientes.

## Política y revisión de cobertura — fase 3

Migración aditiva `20261106030000_course_source_policy_review.sql`. La biblioteca ofrece «Solo mis archivos» y «Mis archivos + fuentes web» sin preselección. El modo `WEB_ONLY` queda como compatibilidad del flujo histórico; no se reinterpreta `A_WITH_SOURCE`/`B_NO_SOURCE` como autorización para navegar. Cursos sin configuración documental conservan consumidores y cuotas web anteriores. La elección puede guardarse antes de Base sin requerir un plan ni ejecutar IA; cambiar una elección existente pide confirmar la invalidación.

API `GET /api/artifacts/:artifactId/sources/review` devuelve política, revisión, token curricular, evidencia vigente, asociaciones y cobertura. `?policyOnly=1` evita cargar la revisión curricular completa cuando solo se necesita configurar el modo. El rol de aprobación se proyecta desde el tenant resuelto en servidor. `POST` admite comandos estrictos:

- `policy`: `expectedRevision`, `curriculumHash`, `policy`.
- `propose`: sugerencias deterministas por coincidencias entre objetivo/tema y texto; no llama IA, no guarda ni verifica automáticamente.
- `save`: versión y hash esperados, más `associations` con `lessonId`, `evidenceType` (DOCUMENT/WEB), `evidenceId`, `requirementIds`, confirmación de suficiencia (`verified`), contradicción (`conflict`) y resolución. Servidor valida pertenencia y vigencia; el cliente no suministra requisitos, actor, organización o autoridad de revisor.
- `approve`: versión y hash esperados; solo un revisor vigente puede aprobar el conjunto guardado, con plan aprobado, evidencia para cada requisito y contradicciones resueltas. Se conserva el actor de creación y aprobación.

El objetivo usa ref `objective`; temas, `topic:<índice>` bajo el token curricular. El token representa módulos, plan/estado y las partes curriculares de entrega sincrónica/híbrida; cambios de materiales o render no se incluyen. Es un mecanismo de concurrencia, no una credencial ni una afirmación de autenticidad. Máximo 1000 requisitos, 1000 evidencias por procedencia y 1000 asociaciones; excesos producen error, no truncamiento silencioso. El comando de revisión admite hasta 512 KiB y la evidencia textual hasta 2 MiB por revisión. Propuestas indexan términos una vez y la UI monta una lección de revisión a la vez para limitar DOM.

`sourceCoverage` es el criterio compartido de UI, API y worker documental. Cuenta requisitos respaldados y confirmados, no archivos. Un manual puede cubrir todo el curso. En mixto se distingue evidencia documental de URLs revisadas; la búsqueda pide solo los requisitos faltantes y un presupuesto proporcional a vacíos. Las URLs técnicamente válidas siguen pendientes de suficiencia humana; no aprueban el curso automáticamente. La rama histórica conserva el mínimo web y su aprobación previa. El PDF manual legado se importa explícitamente a biblioteca; no se convierte en URL pública.

Persistencia: `course_source_review_versions`, `course_source_review_approvals` y `course_source_policy_changes` son historiales inmutables para el rol backend, con RLS y sin permisos para navegador. Las versiones guardan referencias sin duplicar texto. La RPC compara revisión y token bajo bloqueo, revalida IDs y estados, y registra actor. La evaluación semántica queda en revisión humana, no se acredita por un hash o cita válida.

Decisión de implementación: las asociaciones vigentes son el conjunto de referencias de `course_source_review_versions` para la revisión actual. El contrato normalizado `course_source_assignments` preparado en F1 no se rellena en paralelo ni se interpreta como cobertura real; F4 consume las revisiones aprobadas, sin crear dos fuentes de verdad.

Cambiar política, asociaciones o disponibilidad de documentos invalida dependencias en la misma transacción; un fallo revierte también el cambio. Los workers de curación documental confirman progreso con revisión/token/attempt vigentes. La validación de URLs existentes invalida una revisión si cambia su contenido o aptitud. La aprobación histórica por contar URLs no puede saltarse la revisión documental. Un cambio curricular vuelve obsoleto el token; actualizar y revisar de nuevo antes de aprobar.

La restricción temporal de F3 se sustituye en F4 por comprobación de contexto y recibos vigentes. Sin elección o documentos listos se bloquea el inicio documental; Materiales exige revisión aprobada. Los cursos históricos sin configuración y `WEB_ONLY` conservan generación. No se regenera por cambiar una política. La implementación local no equivale a activación desplegada.

## Inicio de Base y recuperación de extracción

En un borrador documental, guarda la política, comprueba al menos un archivo con «Texto disponible» e indica el propósito del curso en «Generar Base». La acción autoriza la organización y reserva la ejecución sobre el mismo artefacto. Una solicitud concurrente no genera otro curso ni reserva un segundo job. Puedes retomar el borrador desde su detalle y reintentar un fallo de Base con el propósito guardado.

La migración `20261107010000_course_source_extraction_diagnostics.sql` sigue a F4. Conserva el lease y distingue fallos de lectura, formato, cantidad de texto y persistencia. Los fallos históricos genéricos con tres intentos tienen una recuperación adicional. Los fragmentos conservan los límites de caracteres Unicode completos y sus posiciones UTF-16. La invalidación puede marcar una solicitud de publicación anterior como desactualizada sin permitir cambios de estado ni envíos obsoletos. Aplica la migración antes de desplegar aplicación y workers de esta corrección.

La biblioteca conserva un original por archivo y divide internamente el texto en tramos. La migración `20261110030000_split_long_course_sources.sql` fija un presupuesto de 1,200,000 unidades UTF-16 de texto activo por curso. Un solo original puede ocupar todo el presupuesto. La publicación verifica completitud y capacidad en una transacción y conserva el límite usado en el último intento para recuperar versiones agotadas por un tope inferior. Base recorre los fragmentos por lotes recuperables dentro de su presupuesto y verifica citas literales. Reintentar con el mismo propósito, modelo y revisión conserva el avance. Temario y Plan siguen sujetos a su contexto directo. [Contrato, activación y piloto](../../openspec/changes/course-owned-document-sources/long-source-plan.md).

La migración `20261110040000_align_base_source_snapshot_budget.sql` permite que el snapshot de Base valide hasta 1,200,000 unidades UTF-16 antes de preparar los lotes. El presupuesto por llamada se aplica durante la generación. Tras aplicar la migración, un intento rechazado por el límite anterior puede reintentarse en el mismo borrador con los documentos ya procesados.

## F4: generación con fuentes y comprobación de respaldo

Migración aditiva `20261106040000_course_source_generation.sql`; servicios `course-source-generation.ts` y `course-source-generation.service.ts`. Base, Temario local/background/importado y Plan reciben el texto íntegro de todos los fragmentos READY dentro del presupuesto. No requieren aprobación curricular antes de que exista el plan. En ambos modos documentales se omite la investigación web de esas etapas: las búsquedas del modo mixto se realizan exclusivamente en curación para vacíos revisables. Los prompts configurados y feedback no conceden herramientas.

Materiales selecciona los IDs de la revisión aprobada para la lección vigente, incluidas sus variantes `-Gn`; conserva texto y localizador real, también después del carácter 12.000. Un manual suficiente no hereda el mínimo web histórico. El contexto pasa a componentes estándar y a guion/storyboard, modelos alternativos, reanudaciones y regeneraciones parciales. Las sesiones consumen evidencias con sus identidades curriculares originales; los documentos pueden abarcar varias lecciones y una URL conserva sus lecciones aprobadas.

| Consumidor | Integración |
| --- | --- |
| Base | `generate-artifact-background.ts`: snapshot previo, omisión de research y recibo del resultado. |
| Temario | `api/syllabus`, `syllabus-generation-background` y `syllabus-import.service`: mismo resolver; fidelidad de importación existente conservada. |
| Plan | `instructional-plan-background`: contexto protegido tras prompt/feedback y comprobación entre módulos. |
| Materiales/videos | `materials-generation-runtime`, `materials-model-client`: selección por lección, vigencia por llamada, recibo por componente y pendientes recuperables. |
| Sesiones | `delivery-generation` y `commit_course_source_delivery_unit`: recibos de cada unidad; ediciones manuales quedan revisables hasta recuperar respaldo. |
| QA | `current_course_source_component_ids` y contexto de validación: los IDs de fuentes por sí solos no aprueban componentes obsoletos. |
| Producción | Idempotencia diferenciada por revisión; guardas de `production_jobs`, `production_assets` y `production_complete`. |
| Publicación | Guardas SQL, comprobación antes de encolar y antes de enviar el outbox; revisión/token del paquete y rechazo de referencias privadas. |

Presupuestos: 120.000 caracteres de evidencia en estructura y 60.000 por lección/sesión; máximo 1.000 fragmentos. La salida sometida a comprobación admite 180.000 caracteres. El exceso es un error explícito: retirar fuentes sin uso, reducir alcance o dividir el curso; no se recortan fragmentos. La revisión de respaldo tiene hasta 120 segundos, comparte el tiempo restante de Materiales y respeta modelos alternativos configurados ante errores técnicos. Una decisión semántica desfavorable bloquea el resultado, sin buscar otro juez que lo apruebe.

### Snapshots, citas y concurrencia

`course_source_snapshots` conserva política, revisión, identidad de ejecución, versión real de temario, fingerprint y manifiesto. Los documentos se fijan por FK a fragmentos inmutables en `course_source_snapshot_items`; no se duplica su texto. La evidencia web guarda el extracto exacto en el manifiesto para reproducirlo tras cambios de URL. No se incluyen rutas Storage ni URLs firmadas. La clave de ejecución deriva del run/iteración/lección o unidad de sesión; repetirla recupera el mismo snapshot o rechaza entradas distintas.

Las primeras etapas exigen la misma política, selección READY y entradas previas. Una nueva asociación curricular no obliga a regenerar indefinidamente Base/Temario/Plan si sus fuentes y entradas siguen iguales: su vigencia se reconcilia al aprobar. Materiales exige además revisión y aprobación actuales, incluyendo Base, módulos, versión de temario, plan y currículo de sesiones. Los materiales y renders no participan en el hash curricular para evitar invalidarse a sí mismos.

Los inputs ya cargados por cada consumidor se cotejan con el currículo vigente antes de fijar el snapshot; un contador nuevo no legitima inputs anteriores. Producción y publicación rechazan dependencias estructurales sucias o sin recibo vigente. La aprobación de curación documental conserva `syllabus_content_version` para mantener los controles existentes de temario importado en Materiales.

Una llamada de comprobación sin herramientas examina el respaldo completo de cada salida. El servidor valida UUIDs permitidos, citas literales de las evidencias y afirmaciones presentes en la salida; PostgreSQL repite esas comprobaciones literales y registra `course_source_generation_receipts` con hash del JSON exacto. Guardas de persistencia rechazan otro contenido, lección o snapshot vencido. Los recibos quedan en `source_evidence_id` para estructura y en `assets.course_source_evidence_id` para componentes; sesiones usan `course_source_delivery_receipts`. Los fallos de un componente no eliminan los demás componentes respaldados.

Esta comprobación semántica usa IA y **no es una prueba matemática de fidelidad**. Continúan siendo necesarias revisión humana, controles pedagógicos y aceptación con proveedores reales. La auditoría almacena citas privadas con acceso de backend; no se exportan esas tablas como materiales públicos. Los logs nuevos conservan IDs/estado/costos, no prompts ni texto documental. No se garantiza ejecución exactamente una vez frente a todos los fallos externos: se conservan los controles de run, iteración, versión y aceptación incierta del pipeline.

La edición directa de contenido no hereda recibos anteriores. Para cambios documentales se utiliza Regenerar con retroalimentación y su comprobación de respaldo. Guardar Base no inicia una llamada pagada oculta: devuelve esa instrucción explícita. La edición histórica sigue disponible con autorización por recurso, campos permitidos y organización validada en servidor.

### Fuentes históricas y operación

`GET /api/artifacts/:artifactId/sources/legacy` lista hasta 50 fuentes por origen. `POST` recibe exclusivamente `kind` (`SYLLABUS_DOCUMENT` o `CURATION_PDF`), `sourceId` e `idempotencyKey`; usa identidad y curso autorizados en servidor. La copia pasa por reserva, cuotas, checksum y confirmación de biblioteca. Debe procesarse y asociarse antes de generar. No cambia ni borra la fuente histórica.

El temario histórico conserva texto, pero no un original binario: la importación crea un TXT derivado y lo anuncia expresamente. Un PDF de curación solo se lee desde `curation-sources`, en el namespace del curso y organización autorizados; un original ausente, alterado o mayor al límite nuevo de 15 MB exige volver a cargar/dividir. `course_source_legacy_imports` conserva origen, hash y disponibilidad del original, sin autoridad aportada por el payload.

Despliegue pendiente: aplicar F1–F4 en orden y desplegar aplicación/jobs coordinadamente antes del piloto. El fingerprint F4 incorpora Base y versión de temario: aprobaciones documentales anteriores requieren revisión, no backfill de suficiencia. Ante una reversión, bloquear nuevas generaciones documentales con guardas temporales y conservar snapshots/recibos; no borrar tablas históricas ni regresar silenciosamente al motor web. La aplicación remota y el plan operativo completo pertenecen a F6. Evidencia y revisión propia: [cierre F4](../../openspec/changes/course-owned-document-sources/reports/phase-4.md).

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

La conciliación conserva documentos UPLOADED/READY/RETIRED y sus fragmentos. El historial y las reservas conciliadas siguen contando en cuotas. Una carga huérfana fuera de una reserva conocida requiere investigación administrativa.

No se ejecutó purga de datos reales al desarrollar esta funcionalidad. En despliegue, el operador debe usar primero inspección, revisar el ID/curso/retención y autorizar cada purga desde el control separado. Mantener el historial de conciliación durante la vida del curso; las fuentes consumidas no tienen borrado automático.

La eliminación del artefacto requiere dos confirmaciones. La segunda presenta
documentos, descargas y reservas antes de confirmar. La transacción elimina el
curso y sus registros documentales, conserva la clave de creación para rechazar
reintentos y agenda la limpieza de originales en Storage. Un manifiesto que
cambia exige revisar la lista nuevamente. Una dependencia protegida revierte
la eliminación. Véase el [contrato de eliminación](../../openspec/changes/fix-artifact-deletion/design.md).

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

`UPLOADED` solo acredita recepción verificada. PDF con cabecera puede seguir siendo corrupto o escaneado; Office puede tener XML inválido. F2 expone extracción con lectura Office acotada, diagnóstico y estado `READY`; F3 aporta evaluación curricular y F4 consume sus revisiones.

## Persistencia y seguridad

Migración: `supabase/migrations/20261105010000_course_owned_document_sources.sql`.

- `course_source_settings`: política opcional y revisión; `null` significa elección pendiente. No se habilita ninguna política por defecto ni se conecta aún al generador.
- `course_source_drafts`: idempotencia por organización/actor/clave y vínculo al borrador.
- `course_source_documents`: intención de carga, bytes/hash, referencia privada, estado e identidad inmutables. Reemplazo futuro crea otro ID; no sobrescribe el original.
- `course_source_fragments`: texto y localizador; no se escribe desde las rutas F1.
- `course_source_assignments`: asociaciones versionadas con lecciones y revisión; no hay endpoint F1 para aprobarlas.
- `course_source_snapshots` y `course_source_snapshot_items`: contrato inmutable de evidencia por ejecución/etapa; las FK compuestas impiden vincular fragmentos de otro curso. No crean integraciones con jobs por existir las tablas.

`curation_rows` conserva resultados e IDs históricos. F4 resuelve las asociaciones aprobadas a IDs de evidencia del snapshot, sin copiar texto documental a `validation_report`; Materiales consume el fragmento canónico. No se añade FK de `lesson_id` a un identificador supuesto: las lecciones viven dentro del JSON versionado del plan. F3/F4 validan pertenencia curricular, revisión y vigencia de snapshots antes de aceptar resultados.

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
