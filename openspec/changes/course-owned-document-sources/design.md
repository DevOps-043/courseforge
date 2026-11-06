# Diseño y plan de implementación

## Context
La carga al temario, la curación y los extractos para Materiales tienen contratos distintos. Conectar un botón al registro PDF mantendría exclusiones de cobertura y pérdida de contenido, y no cubriría los otros formatos. Se necesita un dominio documental compartido con consumidores explícitos.

## Goals / Non-Goals
Entregar el recorrido archivo → extracción → asociación curricular → aprobación → generación → trazabilidad. El modo exclusivo limita las fuentes de conocimiento aportadas, pero no puede garantizar por sí solo que un modelo nunca use conocimiento previo: se requieren validación de respaldo y revisión humana.

El alcance cerrado incluye los cuatro formatos con texto extraíble. OCR, audio/video, archivos Office antiguos y bases vectoriales quedan como ampliaciones. Todo formato no soportado se rechaza explícitamente. Mantener los flujos históricos y SCORM.

## Decisions

### 1. Política independiente de la ruta de temario
Decisión confirmada por el usuario: mostrar en cada curso documental «Solo mis archivos» y «Mis archivos + fuentes web», sin opción preseleccionada. Permitir guardar el borrador sin elección, pero bloquear la generación hasta que el autor elija. Persistir la elección y mostrarla al reabrir; no preguntar de nuevo en cada etapa. Cambiarla después requiere confirmar la invalidación de resultados afectados.

- `DOCUMENTS_ONLY`: no ejecutar búsqueda web, grounding, URL context ni herramientas de navegación en ninguna generación del curso; no enviar texto privado como consulta a buscadores. Si falta sustento, detener el componente/lección afectado con diagnóstico.
- `DOCUMENTS_AND_WEB`: documentación propia prioritaria; búsqueda acotada a vacíos visibles, con procedencia diferenciada. No permitir contradicciones silenciosas: el revisor resuelve conflictos.
- `WEB_ONLY`: conserva el flujo web actual y sus cuotas. Los cursos antiguos sin política explícita usan un adaptador compatible con su comportamiento actual; no se reclasifican masivamente ni se regeneran.
- Política y documentos se configuran antes de generar Base. Si se añaden después, marcar Base y las dependencias afectadas para revisión/regeneración explícita; no afirmar retrospectivamente que se generaron con documentos.
- La política se resuelve en servidor y se fija por ejecución. Un override de prompt, un payload o un retry no pueden habilitar herramientas prohibidas.

### 2. Dominio propietario
Crear `apps/web/src/domains/course-sources/` con types, validators, services y repositories; componentes/hooks para la biblioteca y adaptadores pequeños para consumers. Handlers y jobs delegan casos de uso. Compartir extractores existentes tras aislar contratos y conservar pruebas; no copiar lógica ni concentrarla en `curation.actions.ts`.

`syllabus_source_documents` sigue perteneciendo a la importación de temarios. La nueva biblioteca no dependerá de `PROVIDED_SYLLABUS_ENABLED`. La importación de estructura aprobada conserva sus reglas de fidelidad y confirmación.

### 3. Modelo de datos propuesto
Los nombres siguientes son propuestas sujetas a revisión del esquema efectivo:
- `course_source_documents`: ID servidor, curso, organización, actor, estado, referencia Storage privada, nombre seguro, MIME detectado, bytes reales, hash, versión de extracción, diagnóstico seguro y timestamps. Sustituir contenido crea versión nueva; no sobrescribir la versión consumida.
- `course_source_fragments`: fragmentos del texto extraído con orden, hash y localizador real disponible (página, diapositiva, párrafo o rango de caracteres). No inventar paginación; tablas/listas y orden requieren fixtures de fidelidad. El texto completo queda persistido mediante fragmentos, sin depender del extracto de validación.
- `course_source_assignments`: vínculo único por curso/lección/versión documental/fragmento, temas u objetivos cubiertos, procedencia de propuesta y estado revisado. Un documento puede cubrir muchas lecciones.
- Snapshot inmutable por ejecución, asociado al mecanismo vigente de jobs: política, versión del conjunto aprobado, versiones documentales, fragmentos exactos enviados, hashes y presupuesto. Referencias y claves foráneas deben impedir asociaciones cruzadas. No duplicar binarios en snapshots.
- Contador de versión del conjunto de fuentes y política por curso, actualizado atómicamente con asociaciones/aprobaciones. Diseñar la ubicación final en migración después del inventario de dependencias.

RLS y grants de mínimo privilegio; ninguna lectura de archivos privados por URL pública. Autorizar recurso antes de service-role. Índices según consultas curso/estado, documento/orden, lección/versionado y hash por curso. Deduplicación no debe revelar existencia en otra organización. No borrar fuentes históricas consumidas para resolver un duplicado.

### 4. Ingesta fiable y acotada
1. Crear/resolver borrador de curso autorizado sin iniciar IA; así se cargan archivos antes de Base sin inventar un propietario temporal.
2. Reservar carga con token/intención vinculada a actor, organización, curso, ruta servidor, MIME y cuota. Usar subida directa firmada a Storage para no depender de multipart grandes en Netlify.
3. Confirmar carga y verificar bytes, MIME real, cabecera/estructura, hash y límites en servidor. El cliente no declara que un documento esté listo.
4. Extraer en job autenticado y firmado, con reserva, reintentos acotados, idempotencia y cancelación; estado visible tras recargar: cargando, procesando, listo o error. Separar fallo de extracción, aceptación incierta del job y carga pendiente.
5. Fragmentar y persistir de forma recuperable; solo `READY` con contenido válido puede asociarse. Persistencia final y estado deben ser atómicos. TXT UTF-8, ZIP Office limitado por tamaño descomprimido/entradas/tiempo y PDF con límites de páginas/recursos. No ejecutar macros, scripts, adjuntos o recursos externos.
6. Reconciliar cargas abandonadas con período de gracia y auditoría; no borrar un objeto ante un timeout sin consultar su estado.

Límites iniciales propuestos: 8 documentos seleccionados, 15 MB por archivo, 40 MB por lote, 40,000 caracteres por documento y 120,000 por selección, reutilizando el contrato del temario. Rechazar excesos, no truncar. Mantener lectura de PDF históricos de hasta 25 MB sin ampliar automáticamente el límite de cargas nuevas. Cuotas acumuladas por curso y organización, concurrencia y presupuesto de extracción deben fijarse y probarse antes del piloto; una cantidad de archivos no equivale a presupuesto de tokens.

### 5. Biblioteca y revisión de cobertura

Decisión F3 implementada: las referencias de evidencia se guardan como conjuntos inmutables acotados en `course_source_review_versions`, con aprobaciones separadas y CAS. Se evita sobrescribir asociaciones revisadas y duplicar texto. `course_source_assignments`, preparado en F1, no es una segunda fuente activa; cualquier proyección futura debe derivarse de la revisión aprobada. El resolver compartido es `sourceCoverage`; la propuesta es determinista y siempre no verificada, sin ejecutar IA.
Entradas visibles desde preparación de Base, Temario y Fuentes: seleccionar/arrastrar, progreso, error por archivo, vista del texto interpretado, original autorizado, reutilización, sustitución y retirada lógica. Mostrar política, límites y procesamiento por proveedor IA. No exigir volver a subir en cada etapa.

Proponer asociaciones a partir de fragmentos con IDs servidor; el autor puede corregirlas y el revisor aprobarlas. Algoritmo de cobertura compartido entre UI, API y workers:
- En modo documental, validar respaldo por objetivo/tema del plan y evidencia suficiente para el componente; un único manual puede ser suficiente. No aplicar el mínimo web de dos archivos ni aprobar por un simple contador de fragmentos.
- La propuesta del modelo no aprueba por sí misma: cobertura con vacíos requiere corrección o revisión explícita; guardar autor y versión revisada.
- En modo mixto, documentos aprobados satisfacen lo que cubren y la web resuelve los vacíos. Mantener una sola función de decisión, con desglose de cobertura documental/web y conflictos.
- En modo web histórico, preservar cálculo actual. Cambiar fuente, política o asociaciones invalida la aprobación y los consumidores afectados.

### 6. Contexto y trazabilidad en todas las etapas
Base y Temario reciben contexto documental con presupuesto explícito; Plan conserva objetivos y temas trazables. Materiales recupera fragmentos aprobados por lección y componente, no solo los primeros 12,000 caracteres del documento ni el `content_excerpt` histórico.

Primer enfoque: recuperación determinista por asociaciones revisadas y secciones; evitar añadir embeddings como requisito. Si el contenido excede el presupuesto, informar el alcance excluido y requerir selección/división; ningún recorte silencioso. Contexto y selección son reproducibles desde el snapshot.

Todas las rutas locales, background, reanudaciones, regeneraciones parciales y fallback de proveedor usan el mismo resolver. Las fuentes permanecen como datos no confiables. Las herramientas se controlan en código según política, aunque un prompt solicite navegar.

Cada componente declara IDs de evidencia enviados y localizadores verificables. Validar pertenencia al snapshot y asociación con la lección, vigencia y correspondencia de citas textuales cuando existan. Para suficiencia semántica usar chequeo explícito y revisión humana; un ID válido no demuestra una afirmación correcta. Ejemplos pedagógicos nuevos deben distinguirse del contenido atribuido a una fuente. Ante material sin respaldo, pedir corrección y no inventar citas.

### 7. Concurrencia, invalidación y operación
Congelar fuentes/política/temario al iniciar un job. Comprobar versión al reservar y al confirmar resultados; un job antiguo no puede aprobar sobre fuentes nuevas. Invalidación y modificación de fuentes deben ser transaccionales. Conservar borradores anteriores con estado obsoleto y diagnóstico; evitar regeneración pagada automática.

La invalidación incluye Base cuando cambia su fundamento, Temario/Plan según alcance y Materiales/derivados/publicación. Revalidar la versión antes de producir, ensamblar o publicar; no eliminar renders ni aprobaciones históricas como efecto oculto. Coordinar con guardas existentes de `syllabus_content_version` y no sustituirlas.

Logs estructurados con correlación, IDs/versiones, conteos y tiempos; sin texto privado, tokens, nombres sensibles ni URLs firmadas. Métricas: cargas aceptadas/rechazadas, extracción fallida, cola/latencia, conflictos de versión, vacíos de cobertura y consumo por etapa/organización. Topes de concurrencia, leases y backpressure; no prometer una carga de usuarios sin SLO y medición.

### 8. Contratos HTTP y jobs propuestos
Fijar rutas finales en F1, bajo `/api/artifacts/:artifactId/sources`; no modificar la semántica histórica de `/api/syllabus/documents` sin adaptador.
- Crear intención y confirmar upload: comandos idempotentes; deduplicación por curso/hash y consulta de resultado tras timeout.
- Listar documentos: paginación real y campos explícitos; detalle/fragmentos y descarga privada con autorización por recurso.
- Proponer/guardar asociaciones y aprobar conjunto: schemas estrictos, versión esperada y conflicto 409 ante edición concurrente.
- Sustituir/retirar: nuevas versiones y retirada lógica con comprobación de dependencias; sin purga inmediata.
- Política: actualización con versión esperada e invalidación atómica.
- Job de extracción: identidad/reserva/versiones firmadas, sin textos grandes ni URLs firmadas en payload persistido; carga contexto autorizado en servidor.

Usar envelope y códigos de error existentes: 401/403/404 según política de acceso, 409 conflicto, 413 tamaño, 415 formato cuando corresponda, 429 cuota, 503 dependencia. Estados de procesamiento consultables; errores de proveedor saneados.

### 9. Compatibilidad y privacidad al entregar
Leer cursos históricos con adaptadores; no convertir `B_NO_SOURCE` en permiso para saltarse una política documental explícita. Integrar los PDF manuales válidos existentes sin fingir disponer del archivo original en cargas antiguas del temario: si solo hay texto persistido, identificar ese origen y pedir recarga cuando se requiera original verificable. Migración/backfill local idempotente con reporte y sin reejecutar IA.

Producción consume materiales aprobados y conserva procedencia interna. Publicación no envía `private://`, rutas Storage, URLs firmadas, originales ni texto documental como recurso público. Si el usuario quiere entregar un archivo al alumno, requiere un acto explícito separado y contrato soportado por SofLIA; no es efecto de citarlo. El contenido generado destinado al curso sí sigue la revisión y publicación actuales.

## Alternatives
- Solo exponer la acción PDF: descartado por formatos incompletos, exclusión de cobertura y extractos parciales.
- Guardar todo en `source_summary`/`validation_report`: descartado como modelo canónico por mezcla de responsabilidades, duplicación y ausencia de revisiones documentales.
- Reutilizar `syllabus_source_documents` como biblioteca general: introduciría dependencia del flag y ciclo de vida de importación de estructura; usar adaptador, no cambiar su propiedad implícitamente.
- Introducir una base vectorial desde el inicio: pospuesto hasta demostrar que las asociaciones y recuperación determinista resultan insuficientes.

## Migration Plan
Migración aditiva local con inventario previo de tablas/políticas/Storage; ensayos aislados, constraints, RLS y prueba con rol realista. No editar migraciones históricas. Registrar preflight/postflight de solo lectura para ejecución remota autorizada.

Habilitación controlada por organización, independiente del importador de temarios, con UI/API/jobs coordinados. Piloto primero, métricas y luego ampliación. Rollback detiene nuevas operaciones documentales y conserva lectura, originales, snapshots e historial; nunca degrada `DOCUMENTS_ONLY` a web ni habilita publicación obsoleta. No borrar columnas/tablas como reversión habitual.

## Risks / Trade-offs
Extracción puede perder estructura; fixtures reales y vista previa son obligatorios. Contexto limitado requiere rechazo/selección explícita. Los modelos pueden alucinar pese a las citas; revisión de respaldo y humana permanece. Preservar originales privados aumenta retención/costo: definir plazo de cargas huérfanas y política de eliminación antes de activar. El plan no incluye OCR ni certifica fidelidad perfecta o capacidad masiva sin medición.
