# Ampliación de preparación de sesiones hacia Academy y Hub

## Formulario único de creación

La creación de cursos y talleres comparte ahora el mismo formulario para admin y constructor. Asíncrono, síncrono e híbrido reutilizan título, descripción, público y resultados. Solo aparecen los ajustes aplicables: sesiones/enfoque, relación híbrida y duración de videos asíncronos. El borrador documental utiliza el título común y evita crear un segundo curso desde el botón de generación cuando ya existe un borrador.

El servidor valida la habilitación de sesiones e inicializa la configuración autorizada antes del despacho de IA. Se conserva Nexus por defecto para llamadas anteriores. Una inicialización repetida confirma la configuración idéntica y rechaza sobrescribir otra ya editada. Si falla una etapa posterior, el curso o borrador conserva su identidad para recuperación; no se presenta esta secuencia como una única transacción. La importación SCORM conserva su proceso y confirma la modalidad antes de navegar al artefacto, sin generar automáticamente sesiones.

La tipografía se resuelve también en body, donde Next define sus variables de fuente, con fallbacks válidos. La especificación y verificación están en [unificación del formulario](../../openspec/changes/unify-workshop-authoring-form/proposal.md).

## Revisión visual local

El 18 de noviembre se alinearon los componentes de impartición con los tokens `engine-*`: panel, controles, editor por secciones, salidas por audiencia y entrega al aula. La consulta y la entrega muestran esperas diferenciadas y errores recuperables. Se corrigió el texto de entrega para reflejar que Learning conserva notas y respuestas privadas con acceso autorizado. La revisión usa componentes reales y controladores de QA sin llamadas remotas; queda pendiente verificarla dentro del recorrido autenticado y con sus fuentes de Next. La evidencia coordinada vive en el reporte visual-review.md del cambio extend-live-session-preparation de Hub.

## Segunda entrega de documentos

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
