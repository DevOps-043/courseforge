# Rechazo de generación del temario

19 de noviembre de 2026. Investigación mediante el log local de Next y el correlationId de la solicitud, sin reutilizar cookies ni credenciales compartidas.

La investigación previa terminó correctamente. La generación devolvió ocho módulos para cinco objetivos y 22.6 horas de duración estimada, frente al máximo de 12 horas de COURSE_CONFIG. runAllValidations rechazó el resultado y POST devolvió un error interno genérico. La causa de esta solicitud no es el trigger documental corregido anteriormente.

El constructor compartido del prompt añade las restricciones del validador después de la plantilla configurable: un módulo por objetivo, rango existente de lecciones y presupuesto de duración. Aplica tanto a la ruta local como al worker, que utilizan el mismo constructor. El servidor mantiene su validación; las instrucciones al modelo no garantizan que se cumpla el contrato.

La ruta local distingue SyllabusOutputValidationError y devuelve PROVIDER_ERROR con HTTP 502 y los checks fallidos, sin exponer errores arbitrarios de infraestructura. Conserva el rollback de reserva anterior. No se añaden reintentos automáticos ni se debilitan los límites. El worker conserva su gestión de errores y recibe las restricciones compartidas.

Se agrega regresión para la plantilla que solicita más módulos que objetivos. No se inicia otra generación pagada en esta revisión. El resultado válido de una nueva ejecución con IA queda pendiente; no se afirma que el cambio garantice generación exitosa. Sin cambios de base de datos, secretos ni configuración del modelo.

Verificación: compilación dirigida de tsconfig.syllabus-duration-test.json y ocho pruebas de syllabus-generation-request.schema aprobadas; git diff --check sin errores. Las primeras ejecuciones de tipos y lint dentro del sandbox se interrumpieron por falta de respuesta. El reintento fuera del sandbox de npm run typecheck seguido de ESLint dirigido terminó con código 0; ESLint advirtió que no encontró pages al ejecutarse desde la raíz del monorepo. No se cambió ninguna regla ni se excluyeron archivos. No se crearon commits ni se publicó el ajuste.
