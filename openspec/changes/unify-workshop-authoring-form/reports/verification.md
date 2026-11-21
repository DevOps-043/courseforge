# Verificación del formulario único

El 19 de noviembre se plegó el prompt de Temario bajo «Opciones avanzadas · Prompt del temario», cerrado inicialmente. Se mantienen editor, restauración, origen y versión del prompt y condiciones de generación. Un error de carga conserva un aviso visible fuera del panel para permitir recuperación. En Chrome local se comprobó el estado inicial cerrado, apertura con clic, cierre con Enter y botón de generación habilitado sin abrir la sección. No se modificó el prompt ni se inició generación en esta revisión. Captura: syllabus-advanced-prompt.jpg en las visualizaciones de la conversación.

Preparación para publicación en rama, 18 de noviembre: se repitieron las suites de impartición (41) y fuentes (72), todas aprobadas. verify:pr volvió a detenerse en los cuatro enlaces del reporte previo de Herk; adaptadores y arnés aprobaron. Se seleccionaron únicamente UI, inicialización de modalidad, integración documental del formulario y evidencia. En artifact.actions.ts se seleccionaron seis bloques propios y se conservaron fuera del índice tres bloques ajenos de recuperación documental. Lockfile, migración y continuación documental permanecen locales. La validación se hizo en el checkout compartido; CI sobre el commit aislado y piloto siguen pendientes. Esta publicación de rama no autoriza merge ni despliegue manual.

Revisión local del 18 de noviembre de 2026. Sin commits, despliegue, SQL remoto, creación de cursos ni generación pagada durante la verificación.

## Cambios

Las rutas de creación de admin, constructor y sus variantes con organización reutilizan ArtifactCreationForm. DeliveryConfigurationFields comparte el selector y los ajustes con la edición de modalidad en el curso. Las preguntas comunes se muestran una sola vez; cambiar de modalidad o alternar creación/importación conserva su estado. El borrador documental toma el mismo título y bloquea una segunda creación desde el formulario cuando ya quedó guardado.

La selección se valida en servidor y se guarda mediante el workspace y RPC existentes antes del despacho de IA. El acceso a un artefacto existente se resuelve por usuario y organización del servidor. La inicialización no concede aprobaciones y no sobrescribe un workspace editado. Un reintento con la misma identidad y otra modalidad se rechaza. Si falla la configuración después de crear el artefacto, se registra el fallo y no se despacha generación; recuperar la configuración no reanuda por sí solo una generación fallida.

SCORM espera a confirmar la configuración antes de notificar éxito y navegar. Su importación y transformación mantienen el proceso anterior. No se ensayó una importación real, carga de archivos ni la escritura del nuevo workspace sobre una base remota.

## Evidencia automática

| Comprobación | Resultado |
| --- | --- |
| npm run test:course-delivery --workspace=apps/web | 41 pruebas aprobadas; siete nuevas cubren validación, habilitación, persistencia previa al despacho, reintentos y autorización. |
| npm run test:course-sources --workspace=apps/web | 72 pruebas aprobadas; incluye borrador con modalidad y denegación antes de crear con sesiones apagadas. |
| npm run typecheck | Aprobado en el estado final. |
| ESLint dirigido | Aprobado en formulario, rutas, SCORM, configuración, inicialización y pruebas. La última comprobación del formulario, selector y pruebas nuevas pasó con --max-warnings 0. |
| OpenSpec estricto | Cambio válido. |
| verify:pr | Pasan adaptadores y arnés; se detiene en enlaces del reporte previo de Herk Edit Kit, fuera del alcance. Salida en .tmp/unified-workshop-form-gate.log. |

La primera ejecución documental tuvo dos fallos al cargar los nuevos imports de la acción de creación desde fixtures de edición histórica. Se actualizaron sus fronteras simuladas y se repitió la suite completa sin eliminar ni debilitar aserciones. Las pruebas usan dobles de base, autorización y proveedor; sus mensajes de generación no representan consumo real de IA.

## Evidencia visual

Se revisó la ruta autenticada local /pulsehub/admin/artifacts/new en Chrome. Se verificaron las tres modalidades, conservación de título/descripción, ajustes exclusivos de híbrido, videos ocultos en síncrono, validación de minutos, recuperación al cambiar a asíncrono e importación SCORM sin subir archivos. La inspección confirmó un campo de título y ningún campo adicional de título documental.

Se verificaron tema claro, tema del sistema original y viewport reducido: las tarjetas y los campos se apilan sin desbordamiento horizontal. Se restauraron el tema y tamaño originales del navegador y se retiraron los valores sintéticos del formulario al terminar. No se accionaron los botones de crear borrador o generar estructura.

La tipografía del body resolvió Inter Tight y la del título Newsreader en la página real. Los tokens se calculaban antes solo en root, aunque las variables de Next están en body; se corrigió esa resolución y se conservaron fallbacks locales. Esta comprobación cubre la página inspeccionada, no una auditoría de todas las pantallas del producto.

El servidor local estaba detenido y se inició en loopback. Primero se comprobó que las modalidades con sesiones aparecían deshabilitadas; después se habilitó SYNCHRONOUS_COURSES_ENABLED solo en ese proceso de desarrollo para revisar los campos. No se modificó .env ni configuración remota. Reiniciar sin esa bandera vuelve al comportamiento configurado por el usuario.

Las capturas unified-workshop-form-light.jpg, unified-workshop-form-dark.jpg y unified-workshop-form-narrow.jpg se conservan en la carpeta de visualizaciones de esta conversación. La ruta de constructor comparte el componente y pasó tipos; no se validó una sesión real con identidad de constructor ni se ejecutó la generación de un curso completo.

## Riesgo residual y reversión

### Ajuste posterior de ayuda contextual

Se añadieron ayudas «?» a los campos comunes, modalidad, sesiones, origen del contenido, preparación documental, ZIP SCORM, almacenamiento y duración de video. Los selectores muestran explicación general y selección actual, derivadas del mismo estado del formulario. Al editar duraciones manualmente se describe el perfil personalizado. HelpTooltip conserva el patrón de prompts, ahora con fondo opaco claro/oscuro y aria-describedby. Los botones de ayuda no quedan dentro de etiquetas ni de los botones de selección.

Verificación dirigida: tipos aprobados y ESLint sin errores en diez archivos; se conserva una advertencia preexistente react-hooks/set-state-in-effect de CloudStorageProviderSelector, en la llamada a loadConnections. Los últimos ajustes de HelpTooltip y VideoDurationPolicyFields pasaron ESLint con --max-warnings 0. OpenSpec estricto y git diff --check aprobados. No se repitieron las suites de backend por este cambio de presentación.

En Chrome autenticado se verificaron los cambios de enfoque, relación híbrida, perfil predefinido/personalizado, origen IA/SCORM y almacenamiento Google Drive/No sincronizar. No se conectaron ni desconectaron cuentas. Se comprobó acceso por teclado y asociación de la descripción; el fondo calculado de la ayuda oscura es rgb(28, 35, 41), con opacidad 1. En viewport reducido, el documento midió 433 px y la ayuda quedó entre x=57.55 y x=377.55, sin desbordamiento horizontal. Se restauró el viewport original y la modalidad síncrona encontrada al iniciar. Captura: artifact-form-help-opaque.jpg en la carpeta de visualizaciones de la conversación. No se accionaron creación, generación ni carga de archivos; no se hizo despliegue.

La creación de artefacto y workspace usa dos operaciones existentes, con la protección de revisión de save_course_delivery; no se agrega una transacción SQL. Un fallo parcial conserva el artefacto/borrador y requiere reintento o recuperación. Las tablas y RPC de impartición deben estar instalados para las modalidades con sesiones.

La revisión adversarial fue realizada por el mismo agente. Se comprobaron aislamiento del origen de organización, entradas no reconocidas, reintentos con otra modalidad y ausencia de despacho ante fallo de configuración. Las pruebas de integración con BD real y piloto continúan pendientes. Para revertir UI deben conservarse los workspaces ya creados y la compatibilidad del backend. No se tocaron los cambios previos de fuentes documentales, funciones de generación ni lockfile, salvo la integración acotada en artifact.actions.ts que preserva sus modificaciones anteriores.

La comparación SHA-256 confirmó intactos 22 archivos del trabajo preexistente, excluyendo la acción de artefactos integrada deliberadamente. Se retiraron los dos routers de agentes generados automáticamente por next dev bajo apps/web, que no estaban presentes al iniciar; se mantienen los routers canónicos del proyecto.
