# Fuentes documentales propias

## ADDED Requirements

### Requirement: Base de recepción independiente de IA
El sistema SHALL ofrecer un borrador autorizado en estado DRAFT y reservas idempotentes de originales privados sin invocar generación, extracción automática o publicación.

#### Scenario: Reserva vinculada a bytes y actor
- **WHEN** un autor reserva un archivo con tamaño y SHA-256 y confirma sus bytes recibidos
- **THEN** se verifica la recepción en servidor y se guarda UPLOADED, sin declarar READY
- **AND** otra organización o actor no puede confirmar la reserva

#### Scenario: El adaptador reconstruye la URL de una mutación documental
- **WHEN** una mutación documental del mismo origen llega por un proxy con una URL interna distinta de la URL pública
- **THEN** el servidor reconoce el origen HTTPS válido con la señal `Sec-Fetch-Site: same-origin` del navegador y comprueba la autorización habitual
- **AND** rechaza solicitudes entre orígenes, incluso entre subdominios del mismo sitio, con un código distinto de una denegación por rol

#### Scenario: Reintento y cuota
- **WHEN** se repite la misma clave con los mismos campos
- **THEN** se recupera el mismo borrador o documento sin duplicarlo
- **AND** cambiar campos con la misma clave o exceder una cuota impide crear otra reserva

#### Scenario: Storage con política histórica permisiva
- **WHEN** un rol de navegador intenta acceder directamente al bucket nuevo
- **THEN** una política restrictiva impide leer o modificar los originales incluso si otra política concede acceso genérico

### Requirement: Biblioteca privada persistente por curso
El sistema SHALL permitir cargar y reutilizar PDF textual, DOCX, PPTX y TXT desde la preparación de Base, Temario y Fuentes con autorización por curso y organización, original verificable y diagnóstico de extracción.

#### Scenario: Reutilización tras recarga
- **WHEN** un autor carga un documento válido y vuelve a abrir el curso
- **THEN** el documento y su estado permanecen disponibles sin repetir la carga
- **AND** puede seleccionarse para Temario y para las lecciones autorizadas

#### Scenario: Documento no interpretable
- **WHEN** se carga un PDF escaneado sin texto extraíble o un archivo corrupto
- **THEN** se informa el motivo y el documento no se habilita como fuente lista

#### Scenario: Exceso o formato falso
- **WHEN** los bytes reales, contenido extraído, MIME o estructura incumplen el contrato
- **THEN** se rechaza el archivo sin truncar silenciosamente ni aprobar contenido parcial

### Requirement: Talleres con originales largos
El sistema SHALL admitir originales largos dentro de presupuestos medidos y reutilizar evidencia versionada desde Base hasta Materiales, conservando los originales como archivos individuales y la trazabilidad de cada cita.

#### Scenario: El autor consulta el avance de Base
- **WHEN** la generación de Base está activa o se detiene tras confirmar parte de sus lotes
- **THEN** el detalle del curso muestra la etapa y los lotes confirmados disponibles con la consulta de estado existente
- **AND** muestra el resultado cuando termina y permite distinguir una pausa de un fallo al consultar el estado
- **AND** una ejecución anterior u otra organización no pueden publicar avance para el trabajo actual

#### Scenario: Lectura concurrente con presupuesto compartido
- **WHEN** hay varios lotes documentales pendientes
- **THEN** PostgreSQL concede como máximo tres reservas vigentes de la misma ejecución y descuenta cada intento del presupuesto compartido
- **AND** un fallo de un lote conserva los resultados confirmados de los demás y permite reanudar los pendientes
- **AND** las versiones de planificación existentes conservan sus límites y su cobertura ordenada

#### Scenario: La evidencia relevante está al final del original
- **WHEN** un autor autorizado aporta un documento largo válido y una regla relevante aparece en su última sección
- **THEN** el sistema recorre todos los fragmentos, recupera la regla para el objetivo o tema correspondiente y permite verificar la cita contra el original
- **AND** Materiales recibe el contexto aprobado de la lección, acotado a su presupuesto

#### Scenario: El curso contiene varios originales largos
- **WHEN** el total de texto no cabe en una llamada pero cumple el presupuesto de trabajo del curso
- **THEN** las etapas estructurales consultan evidencia por alcance y la selección mantiene procedencia y revisión
- **AND** superar el presupuesto de admisión produce un diagnóstico medible sin truncar ni publicar fragmentos parciales

#### Scenario: Un original ocupa el presupuesto del curso
- **WHEN** el texto extraído de un original supera 600,000 unidades y cabe en el presupuesto de 1,200,000 unidades UTF-16 activas del curso
- **THEN** se guarda en tramos internos bajo un solo original y se publica el conjunto completo en orden
- **AND** una publicación concurrente que exceda el saldo del curso conserva su original y devuelve el diagnóstico de cuota sin publicar fragmentos

#### Scenario: El archivo menciona una página externa
- **WHEN** una URL aparece como cita o ejemplo dentro del texto aportado
- **THEN** la mención conserva su procedencia documental y el modo exclusivo no consulta la página
- **AND** en modo mixto solo una evidencia web validada en Curaduría, asociada al requisito y aprobada en su revisión, puede respaldar Materiales con procedencia web

### Requirement: Sustitución conserva versiones inmutables
El sistema SHALL crear un original nuevo vinculado a su predecesor y conservar el anterior disponible hasta que la extracción del sucesor se confirme atómicamente.

#### Scenario: Sustitución fallida
- **WHEN** el archivo nuevo falla o se interrumpe su extracción
- **THEN** el original anterior conserva su estado disponible y sus fragmentos
- **AND** el nuevo puede recuperarse o retirarse sin sobrescribir el anterior

#### Scenario: Sustitución completada
- **WHEN** el sucesor pasa a READY
- **THEN** el anterior pasa a RETIRED en la misma transacción y sigue descargable como historial
- **AND** no se admiten dos sucesores vigentes para el mismo predecesor

### Requirement: Conciliación y purga son operaciones distintas
El sistema SHALL inspeccionar reservas vencidas tras 24 horas sin borrarlas y permitir purga puntual únicamente a un revisor autorizado tras siete días, confirmación exacta y comprobación de referencias y versión del objeto.

#### Scenario: Storage no confirma ausencia
- **WHEN** Storage responde con un error distinto de 404 o no acredita versión
- **THEN** se registra UNKNOWN y no se habilita borrado por esa observación

#### Scenario: Purga puntual autorizada
- **WHEN** se confirma el ID exacto de una reserva sin referencias, con retención cumplida y objeto sin cambios
- **THEN** solo se elimina su objeto privado y se confirma su ausencia antes de registrar éxito
- **AND** se conserva el registro documental y el actor de autorización

### Requirement: Política explícita de fuentes por curso
El sistema SHALL resolver y fijar en servidor una política documental exclusiva, documental con complemento web o web, independiente de la ruta histórica del temario y del flag de importación de estructura.

#### Scenario: Elección por curso documental
- **WHEN** se prepara un curso documental nuevo
- **THEN** se ofrecen «Solo mis archivos» y «Mis archivos + fuentes web» sin opción preseleccionada
- **AND** la generación permanece bloqueada hasta elegir explícitamente una política

#### Scenario: Persistencia de la elección
- **WHEN** se vuelve a abrir un curso cuya política ya fue elegida
- **THEN** se recupera la selección sin solicitarla de nuevo por etapa
- **AND** cambiarla posteriormente requiere confirmar la invalidación de los resultados afectados

#### Scenario: Curso exclusivo
- **WHEN** una ejecución o reintento utiliza `DOCUMENTS_ONLY`
- **THEN** ninguna etapa ni proveedor fallback invoca búsqueda web, grounding o URL context
- **AND** no envía fragmentos privados como consulta a un buscador

#### Scenario: Información insuficiente
- **WHEN** un componente necesita contenido no respaldado por las fuentes aprobadas
- **THEN** se muestra el vacío y se impide aprobar el componente sin inventar citas o habilitar web implícitamente

### Requirement: Cobertura por evidencia curricular
El sistema SHALL evaluar cobertura documental por objetivos y temas de lección mediante asociaciones revisables y versionadas, con el mismo criterio en interfaz, API y jobs.

#### Scenario: Manual único
- **WHEN** un documento contiene evidencia suficiente para todas las lecciones
- **THEN** puede cubrir el curso sin exigir varios archivos por lección

#### Scenario: Modo mixto
- **WHEN** se autoriza complementar documentos con web
- **THEN** la cobertura distingue ambas procedencias y expone vacíos y contradicciones para revisión

#### Scenario: Propuesta todavía no revisada
- **WHEN** el sistema propone fragmentos coincidentes con un objetivo o tema
- **THEN** se conservan como sugerencias sin suficiencia confirmada y no permiten aprobar hasta su revisión

#### Scenario: URL sin identidad curricular
- **WHEN** una URL heredada no identifica la lección a la que pertenece
- **THEN** no se considera evidencia general ni puede cubrir otras lecciones implícitamente

#### Scenario: Revisión anterior al cambio de configuración
- **WHEN** un usuario guarda o aprueba con revisión o token curricular anteriores
- **THEN** se rechaza el comando sin sobrescribir la nueva configuración

#### Scenario: Fallo al invalidar dependencias
- **WHEN** falla una escritura de invalidación durante un cambio de política o asociaciones
- **THEN** se revierte también la revisión, política y demás modificaciones de esa transacción

### Requirement: Contexto completo dentro de límites explícitos
El sistema SHALL conservar el texto extraído válido y recuperar los fragmentos aprobados relevantes para cada consumidor, sin limitarse al extracto inicial de validación.

#### Scenario: Sección posterior al extracto histórico
- **WHEN** el respaldo de una lección aparece después del carácter 12,000
- **THEN** el contexto enviado contiene esa sección con ID y localizador verificables

#### Scenario: Presupuesto insuficiente
- **WHEN** el contexto seleccionado excede el presupuesto de la operación
- **THEN** se explica la limitación y se requiere selección o división, sin omisión silenciosa

### Requirement: Trazabilidad e invalidación transaccional
El sistema SHALL congelar política, versiones y fragmentos por ejecución, validar citas contra ese snapshot y controlar vigencia al aprobar y consumir los resultados.

#### Scenario: Cambio durante generación
- **WHEN** una fuente o política cambia antes de confirmar un job anterior
- **THEN** el resultado anterior no aprueba la nueva versión y los consumidores afectados quedan obsoletos
- **AND** se conservan resultados históricos sin disparar regeneración pagada automática

#### Scenario: Cita inválida
- **WHEN** el modelo devuelve una referencia inexistente o ajena a la lección o snapshot
- **THEN** el material no se acepta como válido y se ofrece un diagnóstico seguro

#### Scenario: Cita real pero respaldo rechazado
- **WHEN** los IDs y citas existen pero la comprobación semántica detecta contenido sin respaldo
- **THEN** el componente queda pendiente y se conservan otros componentes válidos
- **AND** una decisión semántica desfavorable no activa otro modelo para obtener aprobación

#### Scenario: Reintento de la misma ejecución
- **WHEN** se repite la reserva de contexto para el mismo run, iteración o unidad con entradas idénticas
- **THEN** se recupera el snapshot existente sin duplicar sus fragmentos
- **AND** entradas diferentes para esa ejecución se rechazan

#### Scenario: Inputs anteriores a la captura del contexto
- **WHEN** un consumidor conserva objetivos, módulos o plan anteriores al currículo vigente
- **THEN** no los vincula al fingerprint nuevo y se detiene antes de generar

#### Scenario: Base usa un documento largo del taller
- **WHEN** la biblioteca procesa un documento que supera el contexto directo de Base y cumple los presupuestos del curso y de lotes
- **THEN** conserva íntegro el texto extraído y el job recorre todos sus fragmentos en lotes acotados
- **AND** la redacción y la verificación usan citas literales de lotes confirmados mientras el manifiesto identifica la revisión completa

#### Scenario: Reprocesamiento tras ampliar el límite
- **WHEN** un documento agotó sus intentos con `TEXT_LIMIT` y se solicita extracción con un límite superior
- **THEN** el worker con la capacidad nueva puede reservar un intento adicional sobre el original existente
- **AND** el contador histórico se conserva y el mismo límite no permite repetir esa recuperación

#### Scenario: Base reanuda una lectura documental interrumpida
- **WHEN** el autor reintenta con el mismo propósito, revisión y modelo tras un fallo recuperable
- **THEN** el job conserva los lotes confirmados y continúa con los pendientes dentro del presupuesto vigente
- **AND** la salida solo puede llegar a revisión tras completar todos los lotes y verificar su respaldo

#### Scenario: Fallo de la primera generación de Base
- **WHEN** la generación falla antes de obtener un recibo de evidencia
- **THEN** Base registra el fallo terminal sin quedar atascada en generación
- **AND** esa transición no modifica contenido ni permite aprobar una salida sin recibo

#### Scenario: Inicio sobre un borrador documental existente
- **WHEN** el autor indica el propósito en un borrador autorizado con política documental y al menos un archivo READY
- **THEN** se reserva una sola ejecución de Base sobre ese artefacto y se guarda su entrada para reintentar
- **AND** una pérdida de la política documental antes del worker detiene la ejecución antes de investigar en web

#### Scenario: Unicode y diagnóstico de extracción
- **WHEN** un carácter suplementario coincide con el límite de un fragmento
- **THEN** se conserva completo y se guarda con localizadores coherentes
- **AND** un fallo de lectura o persistencia se distingue de un documento que carece de texto extraíble

#### Scenario: Extracción con publicación anterior
- **WHEN** extraer un documento cambia la revisión de un curso con una solicitud de publicación existente
- **THEN** se guarda el texto y se marca la publicación como desactualizada
- **AND** avanzar el envío exige fuentes vigentes

#### Scenario: Temario importado versionado
- **WHEN** se aprueba la cobertura documental de un temario importado
- **THEN** la curación conserva la versión del temario vigente exigida por Materiales
- **AND** una modificación posterior requiere revisar otra vez su cobertura

#### Scenario: Respuesta tardía de producción
- **WHEN** un job devuelve un asset después de cambiar la revisión o el contenido de su componente
- **THEN** se rechaza su promoción y no se declara producción completa

#### Scenario: Temario histórico sin original
- **WHEN** el autor importa una fuente histórica que conserva texto pero carece de binario original
- **THEN** se crea explícitamente un TXT derivado con procedencia y diagnóstico
- **AND** requiere procesamiento y revisión antes de usarse como evidencia

### Requirement: Recuperación e idempotencia
El sistema SHALL autorizar y verificar las cargas en servidor, limitar extracción y concurrencia, y permitir consultar efectos inciertos antes de repetirlos.

#### Scenario: Respuesta perdida
- **WHEN** la confirmación o el job fueron aceptados pero el cliente perdió la respuesta
- **THEN** repetir el mismo comando recupera el resultado sin duplicar documentos ni jobs

#### Scenario: Carga abandonada
- **WHEN** una carga vence sin confirmación
- **THEN** la conciliación comprueba referencias y estado antes de cualquier limpieza con período de gracia

### Requirement: Aislamiento y entrega segura
El sistema SHALL revalidar identidad, permisos y organización antes de acceder a originales, fragmentos, asociaciones o descargas firmadas, y mantener privadas las fuentes durante publicación.

#### Scenario: Acceso cruzado
- **WHEN** un usuario intenta leer o asociar una fuente de un curso no autorizado
- **THEN** la operación se deniega sin entregar contenido ni revelar información privada

#### Scenario: Publicación de curso
- **WHEN** se prepara el payload público de un curso documental
- **THEN** no incluye originales, rutas Storage, referencias privadas ni URLs firmadas como recursos públicos
- **AND** un conjunto obsoleto de fuentes impide publicar materiales afectados

### Requirement: Compatibilidad y aceptación operativa
El sistema SHALL preservar cursos históricos y flujos SCORM, distinguir importación de estructura de fuentes documentales, y acreditar el nuevo flujo con evidencia desplegada antes de declararlo operativo.

#### Scenario: Curso histórico sin política
- **WHEN** se abre un curso anterior sin configuración documental nueva
- **THEN** conserva su comportamiento previo mediante compatibilidad explícita y no se regenera automáticamente

#### Scenario: Activación incompleta
- **WHEN** solo existen código, migración local o pruebas simuladas
- **THEN** la documentación distingue implementación de activación y no afirma aceptación en producción
