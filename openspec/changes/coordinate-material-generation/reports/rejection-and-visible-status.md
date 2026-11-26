# Rechazo de contenido y estado visible de Hub

Fecha: 21 de noviembre de 2026. Revisión de mensajes aportados, log local y código. No se ejecuta generación real.

## Evidencia del intento asíncrono

La lección `db152777-eb38-474c-8f48-63f8b1922809` registra rechazo de DIALOGUE, READING, EXERCISE y QUIZ por `UNSUPPORTED_OUTPUT`, con aproximadamente 497–537 segundos restantes. Ese intento no es un timeout de auditoría: el modelo respondió `supported=false` y la aplicación rechazó la salida. Esto no demuestra por sí solo que el contenido sea falso; hay que revisar su correspondencia con el contexto recibido por el auditor.

VIDEO_DEMO falló antes de completar el guion: objetivo 420 segundos; intentos de 608, 517 y 509 segundos, con 9122, 7759 y 7640 caracteres de narración. Los tres fueron rechazados por `SCRIPT_DURATION_OUT_OF_RANGE` y `EXCESSIVE_NARRATION`. Es un fallo distinto al rechazo semántico de fuentes de los otros componentes.

## Evidencia del intento síncrono

La captura muestra una ejecución terminada con error, cero de una sesiones guardadas y un intento consumido. El log del auditor registra `UNSUPPORTED_OUTPUT` con dos fuentes de contexto. Ese rechazo no indica fallo de autenticación de sesión o proveedor.

El auditor exige sustento factual/pedagógico de conceptos, pasos y respuestas. La curación web guarda extractos de hasta 6000 caracteres para HTML y 12000 para PDF; `course_source_all_material_context` los usa como texto web. Disponer de URLs válidas y utilizar todas las fuentes no garantiza cubrir todos los contenidos solicitados por el plan. La insuficiencia de extractos y un criterio de auditoría demasiado estricto son hipótesis a contrastar con contenido autorizado, no causas demostradas de este caso. No se cambian criterios para forzar una aprobación ni se exponen citas privadas en logs.

## Cambios

- Banner síncrono con título, icono, color, explicación y conteo para RUNNING, QUEUED, FAILED, COMPLETED, PAUSED y CANCELLED.
- FAILED dice «finalizada con errores» y aclara que no está generando. COMPLETED distingue generación de aprobación.
- El resumen de destinos distingue completado, error, pausa y cancelación.
- «Reanudar pendientes» se deshabilita si no quedan unidades que admitan reintento directo. El worker también conserva unidades con `retryable=false`, sin volver a gastar generación sobre ellas; las demás sesiones continúan.
- Se conserva el bloqueo de contenido sin respaldo. No cambia SQL ni transporte.

## Verificación

`test:course-delivery`: 62 pruebas aprobadas, incluida conservación de rechazos no reintentables al reanudar otras sesiones. QA de Chrome con motores simulados: los seis estados, FAILED con role=alert, reanudación bloqueada para rechazo no reintentable, temas claro/oscuro y móvil sin desbordamiento. Capturas locales en `.tmp/hybrid-materials-qa/hub-failed.png` y `hub-completed.png`. `npm run typecheck`, ESLint dirigido y `git diff --check`: aprobados. No se alteraron fuentes ni límites de validación y no se inició otra generación.
