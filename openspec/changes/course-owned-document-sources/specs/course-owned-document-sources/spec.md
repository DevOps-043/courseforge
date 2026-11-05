# Fuentes documentales propias

## ADDED Requirements

### Requirement: Base de recepción independiente de IA
El sistema SHALL ofrecer un borrador autorizado en estado DRAFT y reservas idempotentes de originales privados sin invocar generación, extracción automática o publicación.

#### Scenario: Reserva vinculada a bytes y actor
- **WHEN** un autor reserva un archivo con tamaño y SHA-256 y confirma sus bytes recibidos
- **THEN** se verifica la recepción en servidor y se guarda UPLOADED, sin declarar READY
- **AND** otra organización o actor no puede confirmar la reserva

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

### Requirement: Política explícita de fuentes
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
