# Plan de implementación: temario explícito como estructura del curso

Fecha: 8 de octubre de 2026.
Estado: plan desarrollado; implementación pendiente.
Proyecto: Courseforge.
Responsabilidad de seguimiento: cada etapa actualiza sus tareas, evidencia de validación y decisiones en este documento.

## 1. Objetivo y alcance

Permitir que un temario entregado por el usuario gobierne el curso completo. La plataforma debe importar su estructura, conservar sus temas y orden, completar información pedagógica faltante y buscar fuentes para las lecciones resultantes. La IA no debe sustituir esa estructura por un temario nuevo.

El comportamiento debe coexistir con los dos flujos actuales: generación desde una idea y generación desde documentos de referencia.

### Resultado observable

Un usuario puede seleccionar un documento como temario principal, revisar la interpretación, confirmar la estructura, completar objetivos faltantes y continuar al plan instruccional, curación y materiales. Puede identificar qué contenido entregó, qué completó el sistema y qué ampliaciones aceptó.

Ejemplo de aceptación: un temario con cuatro módulos, dos lecciones en el primero y siete en el último conserva esas cantidades, títulos y secuencia aunque el artefacto tenga cinco objetivos generales. No se agregan lecciones para satisfacer las reglas actuales de generación.

### Alcance obligatorio

- Declaración explícita del documento principal y separación de documentos de apoyo.
- Extracción completa o fallo visible; no truncamiento silencioso.
- Interpretación estructural revisable, con procedencia y ambigüedades.
- Persistencia del original, estructura confirmada y propuestas de ampliación.
- Enriquecimiento por campos permitidos, sin regeneración libre de módulos.
- Validadores diferentes según el modo de entrada.
- Continuidad de temas, IDs y versión en las fases posteriores.
- Autorización, concurrencia, recuperación de fallos y observabilidad.
- Pruebas, documentación y despliegue gradual con reversión.

### Límites de esta entrega

Este documento no implementa código funcional, no aplica migraciones y no cambia datos de producción. El desarrollo empieza por la etapa E0. No incluye OCR, importación masiva, un editor colaborativo ni cambios al flujo SCORM.

## 2. Diagnóstico sustentado en el código

| Hallazgo | Ubicación | Consecuencia |
|---|---|---|
| Los documentos se representan como texto y metadatos, sin rol de temario | `apps/web/src/domains/syllabus/syllabus-source-documents.ts` | No hay autoridad estructural diferenciada |
| La carga extrae texto y lo devuelve al cliente | `apps/web/src/app/api/syllabus/documents/route.ts` | El `fileId` actual no acredita un documento persistido en servidor |
| El extractor limita cada documento con `.slice(0, 40000)` | `apps/web/src/domains/syllabus/lib/syllabus-document-extractor.ts` | Puede perderse parte del temario sin aviso |
| La investigación recibe idea y objetivos, antes de construir módulos | `apps/web/src/app/api/syllabus/route.ts` y `apps/web/netlify/functions/syllabus-generation-background.ts` | La investigación no parte de la estructura documental |
| El prompt usa documentos como fuente para construir un temario | `apps/web/src/domains/syllabus/lib/syllabus-generation.ts` | La conservación depende de obediencia del modelo |
| El prompt predeterminado permite 3–8 lecciones y no exige paridad de módulos/objetivos | `apps/web/src/domains/syllabus/config/syllabus.config.ts` | Contradice las validaciones posteriores |
| Los validadores y las correcciones background exigen paridad y 3–6 lecciones | `apps/web/src/domains/syllabus/validators/syllabus.validators.ts` y background de syllabus | Pueden rechazar o forzar cambios al temario entregado |
| La aprobación vuelve a ejecutar las validaciones generales | `apps/web/src/app/api/syllabus/route.ts` | Cambiar solo la generación no permite aprobar estructuras importadas |
| El plan toma módulos/lecciones del syllabus y conserva IDs/títulos mediante asociación por posición | `apps/web/netlify/functions/instructional-plan-background.ts` | Es reutilizable; la asociación semántica debe revisarse para evitar contenido intercambiado |
| La curación consume syllabus y planes por lección | `apps/web/netlify/functions/shared/curation-v2/workflow.ts` | La búsqueda puede reutilizarse sobre la estructura confirmada |
| La interfaz llama a marcar fases posteriores como desactualizadas; el servicio advierte errores y aun así devuelve éxito | `apps/web/src/domains/syllabus/components/SyllabusGenerationContainer.tsx` y `apps/web/src/lib/server/pipeline-dirty-actions.ts` | La consistencia no está garantizada por la operación de persistencia |

La suite `npm run test:syllabus-duration`, ejecutada en el análisis previo, terminó con 36 pruebas aprobadas. Esta evidencia corresponde al comportamiento existente; no demuestra fidelidad de una importación nueva.

Hay migraciones antiguas con políticas permisivas y migraciones posteriores de aislamiento por organización. Deben inspeccionarse las políticas efectivas mediante `pg_policies` y pruebas de acceso. No se afirma que producción sea vulnerable sin esa comprobación.

## 3. Decisiones funcionales

### 3.1 Modos de entrada

Introducir `input_mode` con valores:

- `IDEA`: construir desde idea y objetivos.
- `DOCUMENT_BASED`: construir desde documentos de referencia.
- `PROVIDED_SYLLABUS`: preservar un temario confirmado.

Mantener `route` para compatibilidad con los consumidores actuales: `IDEA` usa `B_NO_SOURCE`; los otros modos usan `A_WITH_SOURCE` inicialmente. No añadir un tercer valor de route ni reinterpretarlo como prohibición de búsqueda web. En esta implementación, el modo gobierna la estructura y la curación sigue su política actual de búsqueda.

Para filas y solicitudes anteriores, derivar el modo de route: A corresponde a DOCUMENT_BASED y B a IDEA. Nunca inferir retrospectivamente que un documento antiguo era un temario obligatorio.

### 3.2 Documento principal

El usuario señala exactamente un documento como temario principal. Los otros documentos son apoyo. El sistema puede sugerir la clasificación, pero no activar silenciosamente el modo de preservación ni mezclar dos temarios incompatibles.

Si se requiere combinar temarios, el usuario prepara una estructura consolidada revisable; la combinación automática queda fuera de la primera implementación.

### 3.3 Preservación y enriquecimiento

- Preservar títulos, jerarquía, orden, temas, IDs y objetivos explícitos.
- Separar la numeración visual del título almacenado; conservar también el texto original.
- Completar únicamente campos ausentes o expresamente habilitados por el usuario.
- No reemplazar objetivos existentes para ajustarlos a un formato de redacción.
- Señalar objetivos poco medibles como incidencias o propuestas, sin modificarlos automáticamente.
- Mapear objetivos del artefacto a módulos; no convertir el número de objetivos en número obligatorio de módulos.
- Si idea u objetivos contradicen el temario, registrar el conflicto y pedir resolverlo en la revisión del producto. No corregirlo ocultando temas.

### 3.4 Expansión controlada

Enriquecimiento significa completar campos o desarrollar los temas de una lección. Expansión estructural significa agregar módulos, lecciones o temas nuevos.

Las ampliaciones se presentan separadas con motivo, evidencia del vacío, ubicación y efecto estimado en duración. Solo las propuestas aceptadas pasan a la estructura operativa. No hay expansión automática basada en conteos mínimos ni tendencias externas.

Una edición humana de títulos, orden o eliminación de temas constituye una revisión explícita: conserva el original y registra el cambio. La validación compara contra la última estructura confirmada por el usuario y mantiene trazabilidad hacia el documento original.

### 3.5 Ambigüedades y duración

- Un listado plano no autoriza inventar módulos. Proponer agrupación y mostrarla para revisión.
- Un módulo sin lecciones queda como incidencia: se solicita definirlas o aceptar una propuesta.
- Los subtemas se conservan como `topics` opcionales por lección; no se convierten automáticamente en lecciones.
- Títulos repetidos pueden ser intencionales en módulos diferentes. Usar IDs para identidad y señalar repetición para revisión; no renombrar automáticamente.
- PDF sin texto suficiente: explicar que requiere OCR previo. No implementar OCR en este alcance.
- El límite actual de 12 horas continúa como restricción de aprobación hasta que negocio defina otra política. Superarlo conserva el borrador y bloquea aprobación con diagnóstico; nunca borra o comprime la estructura para cumplirlo.

## 4. Arquitectura y responsabilidades

Extender el dominio existente; evitar trasladar toda la lógica a `route.ts` o aumentar el tamaño de `SyllabusGenerationContainer.tsx`.

| Responsabilidad | Módulo propuesto | Contrato |
|---|---|---|
| Tipos y schemas | `domains/syllabus/import/syllabus-import.schema.ts` | Documentos, estructura candidata, propuestas y comandos acotados |
| Persistencia y autorización contextual | `domains/syllabus/import/syllabus-import.repository.server.ts` | Consultas por artefacto autorizado y revisiones |
| Extracción e interpretación | `domains/syllabus/import/syllabus-import.service.ts` | Documento persistido → candidato, procedencia e incidencias |
| Completar campos faltantes | `domains/syllabus/import/syllabus-enrichment.service.ts` | Baseline confirmado → parches permitidos |
| Proponer ampliaciones | `domains/syllabus/import/syllabus-expansion.service.ts` | Baseline confirmado → propuestas sin mutar estructura |
| Validar conservación | `domains/syllabus/import/syllabus-fidelity.validator.ts` | Baseline + resultado → bloqueos y advertencias |
| Política de validación | `domains/syllabus/validators/syllabus-validation-policy.ts` | Modo → reglas comunes y específicas |
| Ejecución compartida | `domains/syllabus/services/syllabus-generation-orchestrator.server.ts` | Resolver modo y ejecutar generación o enriquecimiento |
| Interfaz de revisión | `domains/syllabus/components/SyllabusImportReview.tsx` | Candidato, incidencias, edición y confirmación |
| Interfaz de ampliaciones | `domains/syllabus/components/SyllabusExpansionReview.tsx` | Aceptación/rechazo y diferencia antes/después |

Los nombres son propuestos y deben ajustarse a las convenciones verificadas en E0. Los contratos son obligatorios; no crear un archivo por cada función ni abstraer una capa sin responsabilidad real.

Los adaptadores HTTP autentican, autorizan, validan, llaman al caso de uso y traducen errores. El orquestador y servicios gobiernan el dominio. Los repositorios encapsulan las operaciones de persistencia y concurrencia. Las funciones background llaman al mismo núcleo que la ejecución local.

## 5. Modelo de datos y persistencia

### 5.1 Extensión aditiva de syllabus

Proponer columnas:

- `input_mode`: modo validado; backfill compatible.
- `active_import_id`: importación que originó la estructura operativa, nullable para flujos actuales.
- `content_version`: versión de contenido usada para concurrencia e identificación de dependencias.

Mantener `modules`, `source_summary`, `validation`, `qa`, `state` e `iteration_count`. Iteración de IA y versión de contenido son conceptos distintos: una edición manual cambia versión, pero no consume una iteración de IA.

### 5.2 Registro de documentos

Nueva tabla `syllabus_source_documents` con ID servidor, `artifact_id`, creador, nombre, MIME verificado, tamaño, hash de bytes, texto extraído, versión de extracción, estado/diagnóstico y fechas.

- Persistir únicamente tras autorización del artefacto.
- No usar el UUID remitido por el cliente como comprobante de propiedad.
- No confiar en nombre/extensión para verificar formato.
- Mantener límite de archivos, bytes y caracteres como política central.
- Rechazar el exceso de texto íntegro con mensaje explícito. El soporte futuro por segmentos requiere otra política; no improvisarlo cortando texto.
- En la primera entrega, el texto completo, metadatos y hash permiten operar la importación. Archivar binarios en bucket privado es una mejora posterior salvo que auditoría exija conservar el archivo original.
- No registrar el texto documental en logs. Retención ligada al artefacto y eliminación según política del producto.

### 5.3 Registro de importaciones

Nueva tabla `syllabus_imports` con:

- `id`, `artifact_id`, autor y fechas.
- Documento principal y referencias verificadas a documentos de apoyo.
- `status`, `revision`, versión del parser/modelo y clave idempotente de la operación.
- Texto original o referencia a su registro inmutable.
- `extracted_outline`: primera interpretación preservada.
- `candidate_outline`: estructura revisable.
- `confirmed_outline`: snapshot confirmado, con IDs generados por servidor.
- `issues`, `expansion_proposals`, decisiones y procedencia.
- Metadatos de ejecución: intento, vencimiento de reserva y error seguro.

El outline permite objetivos ausentes durante la importación. El contrato final de `syllabus.modules` conserva los campos exigidos por el pipeline y añade `topics` opcionales. No forzar objetivos inventados para validar un borrador todavía incompleto.

Cada elemento debe indicar origen: `DOCUMENT`, `USER_EDIT` o `ACCEPTED_EXPANSION`, con documento y ubicación verificable. Las citas deben corresponder al texto extraído; un indicador de confianza de IA no sustituye esa comprobación.

Una revisión confirmada se conserva como snapshot inmutable. Nuevos cambios producen una nueva revisión/snapshot con referencia al anterior. Evitar almacenar toda la historia como una lista ilimitada en un único JSONB.

### 5.4 Integridad y seguridad

- FKs explícitas; una importación o documento de otro artefacto no puede asociarse solo por conocer su ID.
- RLS derivada de artefacto y organización con pruebas sobre las políticas efectivas.
- El acceso de service role exige autorización previa en HTTP o un trabajo background firmado y ligado a la reserva vigente.
- Escritura de snapshots y decisiones mediante operaciones controladas; no habilitar actualizaciones arbitrarias del original desde el cliente.
- Índices para búsquedas por artefacto y unicidad de operación/revisión; justificar con consultas reales.
- Migración aditiva sin borrar datos actuales; validar restricciones después de backfill.

El detalle SQL debe validarse en E1 contra las migraciones acumuladas y el esquema real. No asumir que las definiciones históricas son el esquema efectivo.

## 6. APIs y ejecución

### Contratos propuestos

| Operación | Endpoint | Reglas principales |
|---|---|---|
| Extraer y registrar documentos | `POST /api/syllabus/documents` | Artefacto autorizado, límites, IDs servidor, sin truncamiento |
| Iniciar interpretación | `POST /api/syllabus/imports` | IDs persistidos, un principal, clave idempotente; 202 si background |
| Consultar candidato/progreso | `GET /api/syllabus/imports/{id}` | Sin exponer documentos de otra organización |
| Editar interpretación | `PATCH /api/syllabus/imports/{id}` | `expectedRevision`, campos permitidos, IDs estables |
| Confirmar baseline | `POST /api/syllabus/imports/{id}/confirm` | Incidencias estructurales resueltas y versión esperada |
| Enriquecer y finalizar borrador de temario | `POST /api/syllabus` | PROVIDED_SYLLABUS requiere importación confirmada; entrada leída del servidor |
| Resolver propuestas | `POST /api/syllabus/imports/{id}/expansions/decisions` | IDs de propuestas, aceptar/rechazar, revisión esperada |
| Aprobar temario | `PATCH /api/syllabus` | Política por modo, fidelidad, duración y versión actual |

Reutilizar respuestas, correlation IDs, autenticación y dispatch firmado existentes. Códigos esperados: 400 entrada inválida; 401 falta de sesión; 404 recurso no accesible; 409 conflicto de revisión/estado; 413 exceso de tamaño; 422 estructura que no puede confirmarse; 503 dependencia temporalmente indisponible.

La nueva solicitud del modo importado lleva referencia a importación y revisión; no toma el texto reenviado por cliente como autoridad. Para las rutas anteriores, preservar el contrato durante la transición y normalizarlo en el adaptador.

### Máquina de estados

Documentos: `EXTRACTING → READY | FAILED`.

Importación: `PARSING → REVIEW_REQUIRED → CONFIRMED`, con `FAILED` para errores técnicos. Incidencias de interpretación conducen a revisión, no a falsa confirmación. Cambiar un baseline confirmado crea una nueva revisión y vuelve a revisión.

El syllabus mantiene los estados existentes: `STEP_DRAFT → STEP_GENERATING → STEP_READY_FOR_QA → STEP_APPROVED`. Fallos de enriquecimiento usan la recuperación existente y conservan la importación confirmada.

No consumir las cinco iteraciones de generación existentes al subir archivos, editar candidatos o confirmar. Los intentos de parsing tienen su propia política acotada. Las solicitudes repetidas con igual clave idempotente no crean ejecuciones duplicadas.

### Guardas de concurrencia

- La reserva contiene artefacto, importación/revisión y versión de syllabus que el trabajo puede modificar.
- Las llamadas a proveedores ocurren fuera de transacciones de BD.
- La escritura final comprueba reserva e input vigente. Un trabajo antiguo no puede sobrescribir una edición nueva.
- Parches con revisión obsoleta reciben 409 y mantienen el borrador del cliente para recuperación.
- No fusionar automáticamente estructuras editadas en paralelo.
- Aplicar leases y recuperación de trabajos vencidos, siguiendo el patrón existente del syllabus.

## 7. Uso de IA y validaciones

### Importación

Usar un contrato de salida estructurado para módulos, lecciones, temas y citas. El modelo extrae y señala incertidumbres. No consulta la web ni rellena lagunas estructurales como si provinieran del documento.

### Enriquecimiento

Usar un prompt específico, diferente del prompt de generación libre. Recibe el baseline confirmado y devuelve parches por ID para campos autorizados. El backend rechaza IDs desconocidos, campos protegidos o resultados fuera de esquema.

Los overrides de prompt e instrucciones de iteración no pueden desactivar las reglas de fidelidad. No anexar al nuevo modo las reglas actuales de paridad o regeneración completa. Si se permiten prompts configurables, resolver un código específico para enriquecimiento y aplicar siempre guardas en código.

Si todos los campos requeridos están completos, no llamar a IA únicamente para producir otro temario. Calcular duración, validar y preparar QA de forma determinista.

### Ampliaciones

Analizar vacíos después de confirmar la estructura. No realizar investigación general antes de importar. Las propuestas pueden apoyarse en fuentes, pero se presentan como adiciones del sistema y no como temas originales.

### Política de validación

| Tipo | Generación existente | Temario explícito |
|---|---|---|
| JSON, campos requeridos y límites operativos | Bloqueante | Bloqueante al finalizar; esquema de borrador permite faltantes |
| IDs y correspondencia de elementos | Validar resultado | IDs estables, todos los elementos originales o cambios humanos trazados |
| Cantidad módulos/objetivos | Conservar inicialmente política existente, unificando prompt y código | Cobertura de objetivos; no igualdad de cantidades |
| Lecciones por módulo | Política central compatible | Cantidad entregada; límites operativos separados de recomendaciones pedagógicas |
| Títulos repetidos | Política vigente | Advertencia revisable; identidad por ID |
| Objetivos/Bloom | Validación vigente | Propuestas si originales son insuficientes; completar los faltantes y resolver conflictos explícitos |
| Duración | Restricción actual | Restricción actual sin alterar automáticamente la estructura |
| Fidelidad de títulos, temas, orden y jerarquía | No aplica al original documental | Bloqueante para cambios de IA no autorizados |

Antes de comenzar, decidir una única política para los modos existentes. Como opción de menor impacto, alinear el prompt con la validación efectiva de paridad y 3–6; no cambiar simultáneamente toda la pedagogía de generación. Esa decisión no se aplica al modo importado.

La fidelidad estructural debe ser determinista. Para calidad semántica, combinar casos de prueba revisados por humanos con revisión del usuario; no declarar que un schema JSON prueba comprensión del contenido.

## 8. Continuidad del workflow

### Plan instruccional

- Consumir únicamente un syllabus aprobado y su versión.
- Incluir temas originales, objetivos confirmados y procedencia útil, con contexto acotado por lección.
- Solicitar respuestas por `lesson_id`, comprobar correspondencia y rechazar desconocidos/duplicados.
- Revisar la asociación actual por posición: no asignar un ID correcto a contenido que el modelo entregó para otra lección.
- Mantener la comprobación existente de completitud y añadir pruebas de reordenamiento accidental.
- Guardar la versión del syllabus usada al generar el plan.

### Curación

- Reutilizar búsqueda, validación de URL, cobertura, checkpoints y presupuesto de ejecución existentes.
- Incorporar `topics` y objetivo por lección. El resumen global actualmente acota keywords y objetivos; no usar ese resumen como única representación del temario.
- Comprobar que el plan corresponde a la versión aprobada del syllabus.
- El documento que describe el temario no se convierte automáticamente en fuente educativa validada.
- Documentos de apoyo siguen la política de fuentes existente; su carga no demuestra aptitud educativa ni cobertura.

### Materiales y fases posteriores

- Verificar que reciben el plan y fuentes de la versión vigente.
- Mantener temas y lecciones incluso cuando no se encuentren suficientes fuentes: indicar bloqueo/cobertura insuficiente, no eliminar contenidos.
- Conservar artefactos ya producidos al cambiar el temario; marcarlos como desactualizados.
- No republicar ni reemplazar cursos externos automáticamente por cambiar la estructura.

### Invalidación confiable

La operación servidor que cambia el contenido debe incrementar versión, reiniciar QA cuando corresponda y marcar dependencias existentes como desactualizadas de forma atómica. Usar una función transaccional acotada para ese caso de uso y probar sus permisos.

No considerar suficiente un aviso visual descartable: antes de continuar cada fase, comprobar su versión de entrada. Un usuario que descarta un aviso no convierte un plan antiguo en compatible.

No mantener una transacción abierta durante generación de IA. Guardar el nuevo contenido y la invalidación en una transacción corta después de validar la respuesta.

## 9. Camino de implementación y entregables

Cada etapa debe completarse con evidencia antes de pasar a la siguiente. Se pueden preparar fixtures y documentación en paralelo a tareas locales, pero los cambios de contratos dependen de E0–E1.

| Etapa | Dependencias | Entregable | Condición de salida |
|---|---|---|---|
| E0. Cerrar contratos y baseline | Ninguna | ADR breve, fixtures y política de validación | Decisiones verificadas y casos esperados definidos |
| E1. Persistencia y seguridad | E0 | Migración, repositorios, pruebas de BD | Integridad, aislamiento y concurrencia probados |
| E2. Extracción e importación | E1 | Documentos persistidos, parser y endpoints | Candidato fiel o incidencias visibles; original conservado |
| E3. Revisión y confirmación | E2 | UI y comandos de revisión | Usuario confirma estructura con IDs estables |
| E4. Enriquecimiento y ampliaciones | E3 | Servicios, runner compartido y validadores | No se modifica estructura protegida; QA funciona |
| E5. Plan, fuentes e invalidación | E4 | Continuidad por versión/ID y temas | Workflow usa el temario vigente y rechaza entradas obsoletas |
| E6. QA integral | E1–E5 | Suite de regresión, matriz y evidencia manual | Criterios de aceptación satisfechos |
| E7. Despliegue y operación | E6 | Flag, runbook, piloto y seguimiento | Funcionalidad operativa y reversión probada |

### E0 — Contratos y baseline

- [x] Registrar fixtures: completo, solo títulos, subtemas, plano ambiguo, títulos repetidos y temarios que incumplen conteos actuales. Casos reproducibles en las suites de importación/orquestación.
- [x] Fijar expansión optativa y conservación de objetivos proporcionados.
- [x] Definir límites operativos centralizados para módulos, lecciones, temas y texto; considerar límites actuales de edición y tiempos de jobs.
- [x] Auditar consumidores de `SyllabusLesson`, schemas strict y normalizadores para que no descarten `topics`.
- [x] Auditar versiones de entrada, estados de aprobación y mecanismos de invalidación de cada fase.
- [ ] Comprobar políticas RLS efectivas y documentar correcciones necesarias.
- [x] Elegir y registrar política consistente para los modos existentes.

Aceptación: fixtures contienen resultados esperados y decisiones sin contradicciones entre prompt, validación y aprobación.

### E1 — Datos, integridad y autorización

- [x] Añadir tablas y columnas de forma aditiva con FKs y constraints.
- [x] Implementar backfill compatible sin reclasificar cursos antiguos como PROVIDED_SYLLABUS.
- [x] Implementar repositorios, snapshots y comparación de revisiones.
- [x] Crear operación transaccional de guardado/versionado/invalidation con permisos restringidos.
- [ ] Definir retención, lectura de texto y eliminación de borradores.
- [x] Añadir versión de entrada en plan y dependencias que lo requieran.
- [x] Validar migración en BD desechable, RLS y rollback lógico.

Aceptación: un usuario de otra organización no puede leer/asociar documentos; dos confirmaciones competidoras no sobrescriben resultados; fallos de invalidación no reportan éxito.

### E2 — Extracción e interpretación

- [x] Persistir documentos extraídos y devolver referencias servidor.
- [x] Cambiar truncamiento por error explícito, conservando compatibilidad de respuesta para clientes antiguos.
- [x] Validar firmas de formato, tamaño, archivos comprimidos y límites de recursos de parsers.
- [x] Implementar parser estructurado con citas comprobables e incidencias.
- [x] Implementar dispatch background firmado, idempotencia y leases para interpretación.
- [x] Crear endpoints de iniciar/consultar importación y mensajes de error seguros.

Aceptación: ninguna omisión por truncamiento; archivos ambiguos producen revisión; reintentar no duplica importaciones; fallo técnico permite recuperar el original.

### E3 — Interfaz y baseline confirmado

- [x] Incorporar los tres modos con descripciones claras.
- [x] Seleccionar un documento principal y marcar los de apoyo.
- [x] Mostrar árbol interpretado, fragmentos de origen e incidencias.
- [x] Permitir correcciones de interpretación sin consumir iteraciones de generación.
- [x] Confirmar con `expectedRevision`; conservar borrador local ante 409.
- [x] Recuperar documentos y estado después de recargar, cerrar sesión o reintentar.
- [x] Mantener fuera de la UI los detalles de proveedores, schemas y reservas que no ayudan al usuario.

Aceptación: el usuario sabe qué estructura confirmó y qué campos faltan; no hay un botón que regenere libremente el temario importado.

### E4 — Completar y ampliar

- [x] Resolver modo desde servidor y ejecutar el núcleo común local/background.
- [x] Crear prompt de enriquecimiento con salida por ID y lista de campos permitidos.
- [x] Aplicar parches preservando títulos, orden, temas y objetivos explícitos.
- [x] Implementar propuestas de ampliación y sus decisiones versionadas.
- [ ] Mostrar diferencias de estructura, objetivos y duración.
- [x] Aplicar validación por modo en generación, servicio, edición y aprobación.
- [x] Manejar conflictos de objetivos y duración sin borrar el borrador válido.
- [x] Conservar baseline si falla IA; permitir reintentos acotados.

Aceptación: un prompt adverso o un modelo que cambie estructura no logra guardarla; un temario completo puede llegar a QA sin generación innecesaria.

### E5 — Continuidad del curso

- [x] Llevar temas al contexto del plan y a la búsqueda por lección.
- [x] Sustituir o reforzar asociación posicional del plan con correspondencia por ID.
- [x] Guardar versión de entrada y bloquear uso de planes/fuentes obsoletos.
- [x] Ejecutar invalidación al persistir contenido desde cualquier vía autorizada.
- [x] Auditar materiales y publicación para evitar pérdida de lecciones o uso inadvertido de versiones antiguas.
- [x] Mantener recursos existentes y permitir regeneración explícita.

Aceptación: cada lección original tiene plan, cobertura de fuentes y materiales correspondientes o un bloqueo visible; cambiar el temario no permite continuar con un plan incompatible.

### E6 — Verificación integral

- [x] Ejecutar suites relevantes existentes y nuevas de importación/fidelidad.
- [x] Ejecutar pruebas locales de contratos HTTP y SQL aislado para RLS, transacciones e idempotencia. La revisión de políticas efectivas de producción permanece pendiente en E0.
- [ ] Probar proveedores con fakes adversos y una muestra real acotada.
- [ ] Recorrer flujo completo en local y despliegue Netlify de QA.
- [ ] Verificar UX en escritorio, tamaños reducidos, teclado y estados de error.
- [x] Registrar limitaciones residuales y evidencia; no confundir mocks con validación semántica de modelos reales.

Aceptación: ningún criterio obligatorio pendiente; fallos conocidos documentados con impacto y tratamiento.

### E7 — Entrega y operación

- [ ] Activar por flag servidor para organizaciones piloto; mantener modos anteriores disponibles.
- [ ] Comprobar budgets, timeouts, límites de ejecución y latencia con archivos del máximo admitido.
- [ ] Documentar soporte: importación ambigua, OCR, exceso de duración, trabajo vencido y conflicto de revisión.
- [ ] Ensayar desactivación del modo nuevo sin eliminar importaciones ni romper cursos existentes.
- [ ] Revisar errores y fidelidad durante el piloto; ampliar disponibilidad tras validar.

Aceptación: flag controlado, recuperación probada, monitoreo accionable y documentación disponible.

## 10. Matriz de QA

| Caso | Resultado requerido | Nivel |
|---|---|---|
| 4 módulos frente a 5 objetivos | Se conservan 4; se valida cobertura | Unitario + integración |
| Módulos con 2 y 7 lecciones | No se alteran para cumplir 3–6 | Unitario + E2E |
| Temario completo con objetivos | No se reemplazan ni se genera estructura nueva | Unitario + proveedor falso |
| Temario solo con títulos | Objetivos completados por ID sin cambiar títulos/orden | Integración + muestra IA |
| Subtemas bajo una lección | Se conservan en plan y contexto de búsqueda | Contrato + integración |
| Listado plano o jerarquía dudosa | Revisión requerida; no confirmación automática | Parser + manual |
| Dos posibles temarios | Se exige elegir principal; apoyo no reordena baseline | E2E |
| Prompt injection dentro del documento | No altera guardas, permisos ni estructura | Seguridad + proveedor falso |
| Modelo devuelve IDs desconocidos u omite lecciones | Respuesta rechazada sin pérdida del baseline | Unitario |
| Modelo entrega planes en otro orden | Se asocian por ID o se rechaza la respuesta | Integración |
| Mismo título en distintos módulos | IDs independientes y revisión de advertencia | Unitario + E2E |
| Documento por encima del límite de caracteres | Error explícito, ningún temario parcial utilizable | Extracción |
| PDF escaneado sin texto | Mensaje útil y posibilidad de reemplazar archivo | Integración + manual |
| Exceso de 12 horas | Borrador preservado; aprobación bloqueada con diagnóstico | Validación + E2E |
| Archivo o importación de otra organización | Acceso denegado y ninguna asociación | RLS + HTTP |
| Reintento con misma clave | Una ejecución/resultado de operación | Concurrencia |
| Worker antiguo termina tras edición | No sobrescribe nueva revisión | Integración |
| Falla BD al marcar downstream | Operación no reporta éxito parcial | Transacción |
| Cambio posterior al plan | Versiones desalineadas detectadas antes de continuar | Integración + E2E |
| Fuentes insuficientes para una lección | Bloqueo de cobertura; lección conservada | Curación |
| Curso histórico y modos actuales | Comportamiento compatible y datos conservados | Regresión |
| Importación en local y Netlify | Misma política y resultado contractual | Integración |

## 11. Observabilidad, capacidad y operación

Eventos estructurados sugeridos: `syllabus.import.started`, `parsed`, `review_required`, `confirmed`, `enrichment.completed`, `fidelity.rejected`, `expansion.decided`, `revision.conflict`, `downstream.invalidated` y `import.failed`.

Registrar request/correlation ID, artefacto, organización, importación, revisión, duración, intento, modelo y cantidades. No registrar documentos completos, prompts con contenido privado, credenciales ni PII.

Medir tiempo de extracción/parsing/enriquecimiento, consumo de IA, fallos por formato, conflictos, propuestas aceptadas y rechazos de fidelidad. Reutilizar telemetry y presupuesto de generación actuales.

Procesar por módulos/lecciones con concurrencia y contexto acotados, respetando presupuesto global del job. No reenviar los 120,000 caracteres documentales completos a cada lección del curso.

La carga requiere límites por usuario/organización y backpressure con los mecanismos disponibles. Verificar si el dispatch actual alcanza el volumen esperado antes de introducir otra infraestructura.

No declarar capacidad para 100,000 generaciones simultáneas: ese volumen exige colas, cuotas por tenant, planificación de workers y presupuestos de proveedores. Este cambio debe ser compatible con esa evolución y validarse primero para la carga real del producto.

## 12. Compatibilidad, despliegue y reversión

1. Desplegar migración aditiva y lectores compatibles, con flag apagado.
2. Desplegar persistencia/importación y validadores sin activar UI general.
3. Habilitar en QA y completar E6 con ambas rutas de ejecución.
4. Habilitar piloto por organización y observar métricas.
5. Extender disponibilidad cuando se cumplan los criterios de salida.

Reversión inicial: apagar flag de nuevas importaciones y conservar lectores capaces de entender el nuevo modo. Mantener originales, revisiones y cursos ya creados. No revertir a un binario que interprete PROVIDED_SYLLABUS como generación libre ni eliminar tablas con datos de usuarios.

Una eliminación futura de columnas/tablas exige exportación, migración inversa explícita y verificación de dependencias; no forma parte del rollback habitual.

## 13. Definición de implementación completa

- [x] Los tres modos son explícitos y compatibles.
- [x] El temario principal es persistido y autorizado por servidor.
- [x] No hay truncamiento silencioso; las incertidumbres detectadas se muestran y las posibles omisiones semánticas requieren revisión humana.
- [x] El original y las revisiones confirmadas pueden auditarse.
- [x] La IA no puede modificar estructura protegida por medio de prompts o respuestas.
- [x] Las ampliaciones son distinguibles y solo se incorporan mediante decisión explícita.
- [x] Edición, generación y aprobación aplican la misma política por modo.
- [x] Plan, fuentes y materiales conservan identidad, temas y versión.
- [x] Las fases obsoletas no continúan por haber descartado un aviso.
- [ ] Seguridad, concurrencia, errores y recuperación tienen evidencia de QA.
- [ ] Los flujos anteriores y SCORM conservan compatibilidad verificada.
- [ ] Documentación, piloto, observabilidad y reversión están listos.

## 14. Seguimiento para siguientes sesiones

Punto actual: E6 parcial y E7 pendiente de aplicación manual y piloto. E0–E5 están implementadas localmente; la revisión de políticas históricas de producción y la aceptación E2E siguen pendientes.

Al concluir cada etapa, registrar: archivos afectados, decisiones tomadas, comandos y resultados de pruebas, migraciones aplicadas en cada ambiente, riesgos residuales y etapa siguiente. Cambiar las casillas solo con evidencia.

La implementación y la guía operativa están disponibles. Las casillas marcadas acreditan código y validación local; no representan despliegue en producción. Las decisiones finales, consultas SQL de preflight, aceptación manual, activación por organización y rollback se detallan en `operacion-temario-explicito.md`. El usuario indicó aplicar la migración manualmente: no se han hecho escrituras de producción ni se ha activado el flag.


## 15. Evidencia de implementación local — 2026-10-08

| Validación | Resultado | Alcance |
|---|---|---|
| test:syllabus-import | 16 pruebas aprobadas | Fidelidad, objetivos, propuestas, IDs, límites y lectura compatible sin columnas nuevas |
| test:syllabus-duration | 38 pruebas aprobadas | Regresión de estructura, duración, documentos y planes; rechazo de truncamiento y TXT inválido |
| test:curation | Suite aprobada; 10 casos de workflow y 2 contratos strict, además de validación/cobertura | Temas y objetivo llegan a búsqueda; versión obsoleta falla antes de buscar |
| test:materials-generation | 34 pruebas aprobadas | Generación, persistencia y recuperación existentes |
| PostgreSQL aislado / PGlite 0.5.8 | 11 pruebas aprobadas | Migración real, permisos, concurrencia, cuotas, snapshots, fidelidad y rollback transaccional |
| TypeScript completo | Aprobado | Frontend, servicios y funciones background |
| ESLint de módulos nuevos y rutas | Aprobado | Análisis estático focalizado |
| Build Next.js | Aprobado | 97 páginas; siete avisos de tracing de filesystem en módulos de producción visual fuera del cambio |
| Guard de migraciones | Aprobado, 186 archivos SQL | Sin nuevas colisiones de versión |

Los parsers de PDF y los tests de recuperación producen mensajes esperados al simular archivos o proveedores inválidos. No se realizaron llamadas de generación IA ni escrituras sobre producción para esta QA. El archivo SQL está envuelto en una transacción y es de aplicación única.

Diferencias frente al diseño inicial: la API usa un único endpoint de comandos validado; el original persistido es el texto extraído completo dentro del límite y el hash del archivo, no el binario original; el modo importado usa snapshots SQL como autoridad de aprobación. El enriquecimiento de un temario con todos los objetivos no solicita generación de estructura. La cobertura semántica y las omisiones de interpretación requieren comparación humana con el texto original.

Pendientes para cierre operativo: revisión SQL de RLS/grants históricos, aplicación manual, despliegue, aceptación con IA real en local/Netlify, revisión de accesibilidad y piloto. La retención actual vincula texto y revisiones a la vida del artefacto; una política temporal y la gestión de eliminación de borradores deben acordarse antes de ampliar disponibilidad. Las pruebas E2E de SCORM no se han repetido.

La aprobación del temario verifica `content_version` mediante compare-and-swap: si cambia entre lectura/validación y escritura, retorna 409 sin aprobar la nueva versión. El reinicio genérico retorna 409 para el modo importado y exige revisión confirmada. La consulta del texto original lleva `Cache-Control: private, no-store`.


## 16. Continuación de QA local — 2026-10-09

El usuario confirmó que aún no aplicó la migración y pidió continuar únicamente con validación local. No se hicieron lecturas adicionales ni escrituras sobre producción.

- `npm run test:syllabus-import-flow`: 39 casos aprobados (22 de orquestación con SDK simulados OpenAI/Gemini y 17 de HTTP/carga).
- `npm run test:syllabus-import`: 16 casos aprobados.
- `npm run test:syllabus-duration`: 38 casos aprobados.
- TypeScript completo: aprobado.
- ESLint focalizado: aprobado para runner, política, proveedor, autorización y rutas de importación/carga.

Correcciones: los temarios completos se guardan sin consultar configuración IA ni apoyo innecesario; Gemini rechaza terminación MAX_TOKENS; la API devuelve los códigos adecuados para falta de tenant y payload excesivo; sesión y tenant deben representar al mismo usuario antes de acceso privilegiado, incluida carga persistente. El timeout de modelo está centralizado.

El build aislado se detuvo antes de compilar por una restricción de acceso de Windows al canonicalizar baseUrl. Se reintentó fuera del aislamiento, sin despliegue ni migración. El resultado final se añade a continuación. Detalle de casos, fronteras simuladas y limitaciones: `qa-temario-explicito.md`.

E6 sigue parcial: no se acredita semántica de IA real, transporte/firma Netlify desplegados ni UX/accesibilidad completa mediante mocks. E7 sigue pendiente de aplicación manual, aceptación y piloto.
