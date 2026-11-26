# Ampliación de preparación de sesiones hacia Academy y Hub

## Formulario único de creación

La creación de cursos y talleres comparte ahora el mismo formulario para admin y constructor. Asíncrono, síncrono e híbrido reutilizan título, descripción, público y resultados. Solo aparecen los ajustes aplicables: sesiones/enfoque, relación híbrida y duración de videos asíncronos. El borrador documental utiliza el título común y evita crear un segundo curso desde el botón de generación cuando ya existe un borrador.

El servidor valida la habilitación de sesiones e inicializa la configuración autorizada antes del despacho de IA. Se conserva Nexus por defecto para llamadas anteriores. Una inicialización repetida confirma la configuración idéntica y rechaza sobrescribir otra ya editada. Si falla una etapa posterior, el curso o borrador conserva su identidad para recuperación; no se presenta esta secuencia como una única transacción. La importación SCORM conserva su proceso y confirma la modalidad antes de navegar al artefacto, sin generar automáticamente sesiones.

La tipografía se resuelve también en body, donde Next define sus variables de fuente, con fallbacks válidos. La especificación y verificación están en [unificación del formulario](../../openspec/changes/unify-workshop-authoring-form/proposal.md).

## Revisión visual local

El 18 de noviembre se alinearon los componentes de impartición con los tokens `engine-*`: panel, controles, editor por secciones, salidas por audiencia y entrega al aula. La consulta y la entrega muestran esperas diferenciadas y errores recuperables. Se corrigió el texto de entrega para reflejar que Learning conserva notas y respuestas privadas con acceso autorizado. La revisión usa componentes reales y controladores de QA sin llamadas remotas; queda pendiente verificarla dentro del recorrido autenticado y con sus fuentes de Next. La evidencia coordinada vive en el reporte visual-review.md del cambio extend-live-session-preparation de Hub.

## Segunda entrega de documentos

### Autoría del recorrido híbrido

Después de aprobar el temario, el panel de agenda permite ordenar sesiones de Hub y tramos de estudio de Learning. Los tramos asíncronos indican título, minutos e IDs de lección; los síncronos referencian una sesión de la agenda. El servidor valida cobertura combinada, referencias, duplicados y duración y conserva la revisión de concurrencia existente. Guardar invalida los planes y aprobaciones dependientes; no dispara generación.

El recorrido se persiste en hybridRoute dentro del documento de impartición. El generador de planes recibe esa secuencia y las conexiones de estudio antes/después deben respetar su orden. Los documentos anteriores siguen siendo legibles; los híbridos deben completar el recorrido antes de generar o aprobar nuevos planes. El síncrono puro conserva su validación de cobertura completa en vivo.

Esta ampliación cubre la autoría de Architect. La producción Nexus y la publicación existentes todavía usan el currículo anterior: el filtrado de sus materiales y la navegación ordenada de Academy requieren la siguiente ampliación coordinada. El manifiesto de preparación de Hub conserva su contrato y solo transporta sesiones síncronas.

La ficha actualiza el estado de impartición cuando cambia la aprobación del temario y ofrece Actualizar estado. Un respaldo heredado que repite el modelo principal se interpreta como ausencia de respaldo adicional, conservando la configuración almacenada y las demás validaciones de modelos.

La creación unificada incluye ayuda contextual «?» para los campos comunes y los ajustes por modalidad. Los selectores presentan una explicación general y otra de la selección vigente, incluidas las duraciones personalizadas. Se reutiliza la ayuda de prompts con fondo opaco en ambos temas y asociación accesible entre botón y descripción. Estas ayudas explican la configuración; no disparan generación ni modifican las reglas de entrega.

Las nuevas generaciones de materiales incluyen instrumentos por actividad, contingencias por bloque, plantilla vacía de registro y aplicabilidad justificada de los tres entregables condicionales. La agenda, los planes, la presentación, la guía, las referencias y la ficha se derivan del contenido aprobado. El paquete consolida 14 documentos con identidad estable por sesión y tipo.

Los documentos participan en las huellas de contenido y fuentes. Cambiar material, plan o fuentes invalida su aprobación. Los cursos anteriores pueden leerse y exportarse; la generación vuelve a completar las sesiones cuyos documentos faltan. Una nueva aprobación de materiales exige completar los documentos.

El prompt predeterminado de materiales usa la versión code-2. Los prompts configurados por organización conservan su versión y reciben el esquema ampliado y las reglas obligatorias de generación.

La entrega firmada a Academy permite hasta 256 KiB de JSON. Los documentos separan secciones de participante y facilitador. Academy los conserva de forma privada hasta que el instructor publica las secciones permitidas. La carga de archivos y la emisión de video se implementan en entregas posteriores.

Estado de las dos primeras entregas implementadas localmente, pendientes de publicación y piloto.

La entrega existente de sesiones aprobadas conserva ahora el plan por bloques y las notas del ponente. El constructor exige plan y materiales, valida minutos totales y mantiene referencias de prácticas por bloque. Las notas referencian el ID de la escena correspondiente. Las respuestas razonadas de actividades conservan su carácter de contenido de autoría.

Academy valida la preparación y la devuelve exclusivamente al instructor autorizado que utiliza un Hub compatible. El transporte ampliado admite 256 KiB de JSON; los límites del estudio siguen siendo 12 escenas y 20 prácticas. Si un curso excede esos límites, se rechaza su entrega con un mensaje accionable. El próximo contrato de archivos requiere acordar el volumen y la navegación del estudio.

Publicar Academy compatible antes de enviar manifiestos ampliados. Un servidor anterior rechaza el campo adicional. La activación sigue bajo SYNCHRONOUS_COURSES_ENABLED y conserva las aprobaciones vigentes.

Las siguientes entregas completan la vinculación de archivos por bloque, los archivos privados, B-roll y videos demo/guía, las encuestas y el registro real de sesión. La ruta coordinada vive en el cambio extend-live-session-preparation de Hub.

## Distribución híbrida desde Plan hasta Publicar

Materiales muestra el estado de generación de Hub con avisos diferenciados para ejecución activa, cola, pausa, fallo, cancelación y finalización. Un fallo indica explícitamente que la ejecución terminó, conserva el conteo de sesiones guardadas y separa generación de aprobación. Los rechazos marcados como no reintentables requieren revisión de fuentes/contenido: tanto la interfaz como el worker los excluyen de una reanudación directa. Las otras sesiones pendientes pueden continuar. El [análisis del rechazo y su presentación](../../openspec/changes/coordinate-material-generation/reports/rejection-and-visible-status.md) documenta la evidencia y los límites de ese diagnóstico.

La generación de sesiones tiene un límite por intento de 90 segundos para Agenda y Plan, y 180 segundos para Materiales. Antes de iniciar otra unidad, reserva tiempo para el respaldo configurado, hasta 120 segundos de comprobación de fuentes y 15 segundos de guardado dentro del presupuesto de ejecución de nueve minutos. Si no cabe otra unidad, pausa para reanudación; no inicia otra generación. Estos presupuestos no garantizan la latencia de proveedores externos.

Los fallos guardan una categoría y etapa en `last_error`, sin respuestas privadas del proveedor. Los logs relacionan ejecución, unidad, operación, modelo y límite. El worker devuelve su estado final y el handler responde 503 ante `FAILED`; las consultas de progreso pueden devolver 200 al recuperar correctamente ese estado fallido. Reanudar conserva las unidades confirmadas y vuelve a intentar las pendientes. Los errores históricos conservan su diagnóstico anterior.

Academy utiliza una proyección del temario basada en las lecciones asíncronas del recorrido, conservando identidades antes de filtrar. Los planes y componentes de materiales registran la huella de distribución; el pipeline rechaza contenido sin huella vigente y conserva las versiones anteriores para revisión. La curación reúne las necesidades de ambos destinos, incluidas las de temas exclusivos de sesiones en vivo. La vista de Materiales permite iniciar ambos motores y conservar progreso y controles separados. Los botones propios de sesiones preparan solo Hub; la aprobación conjunta verifica ambos conjuntos.

La coordinación requiere `20261121010000_coordinated_material_retries.sql` en Architect. Hub conserva un solo worker por ejecución: un fallo de contenido de Materiales no interrumpe las demás sesiones. El autor puede encolar un reintento de la sesión fallida mientras otra sigue ejecutándose; se atiende después de la llamada actual y antes de la siguiente pendiente, con un máximo de cuatro intentos por sesión y ejecución. El guardado de progreso no reemplaza esa cola. El cierre con reintentos pendientes vuelve a despachar; una pausa por presupuesto sin reintentos en cola conserva el mecanismo de reanudación existente. Cambios de entradas, cancelación y guardados inciertos detienen la tanda para revisión.

Academy conserva unidades por lección y componentes por tipo. El reintento dirigido reserva una lección fallida sin cambiar la versión global ni reiniciar las demás; permite hasta dos lecciones activas. Si ambas están ocupadas, se informa falta de capacidad y se puede reintentar cuando una termine, sin esperar al curso completo. Un reintento sin instrucciones conserva componentes válidos; una iteración con instrucciones o selección explícita regenera el alcance elegido. La comprobación de respaldo sigue siendo obligatoria. El cierre global revisa pendientes y activos bajo el lock del padre. Detalles y límites: [análisis de Materiales](../../openspec/changes/coordinate-material-generation/reports/analysis.md).

Producción y ensamble del recorrido operan sobre los materiales asíncronos. Los paquetes históricos que conservan lecciones de otra distribución requieren reconciliación antes de aprobar; no se eliminan automáticamente. La comprobación previa a un commit no sustituye una guarda transaccional en base de datos: esa ampliación y el inventario de endpoints audiovisuales independientes siguen pendientes.

La publicación vigente usa el inbox de Academy, cron, staging y revisión. Su aplicación identifica contenido por posición y no aplica el recorrido híbrido. Hasta implementar recepción versionada con identidades externas estables, navegación y comprobante de revisión, Architect bloquea esa publicación híbrida. La entrega individual de preparación a sesiones programadas conserva su contrato y validaciones. No confundir envío al inbox con publicación aprobada. La [revisión del pipeline](../../openspec/changes/unify-workshop-authoring-form/reports/hybrid-pipeline-review.md) registra evidencia, límites y siguientes entregas.
