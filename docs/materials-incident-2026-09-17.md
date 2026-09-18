# Materiales pendientes sin generación — 17 de septiembre de 2026

## Ajuste posterior autorizado: máximo de 8:30

El usuario solicitó ampliar a 510 segundos el máximo de los videos del curso. Se mantuvo el objetivo de 420 segundos. Cambiar solo `maximumDurationSeconds` no bastaba: otra validación rechazaba guiones por encima del objetivo +5% (441 segundos).

La política admite ahora un margen superior opcional `targetOverrunSeconds`. Si no existe, conserva el comportamiento anterior. Este curso utiliza 90 segundos de margen, limitado siempre por el máximo absoluto. El límite inferior se conserva. La narración puede tener hasta 7,650 caracteres editoriales, con objetivo de 6,300. Las instrucciones técnicas, los errores y las validaciones de caracteres y tiempo respetan ese margen.

Se actualizaron y verificaron la política del artefacto y los 20 contratos de video del plan remoto, conservando una copia local previa en `.tmp/incident-backups`. Las escrituras compararon el timestamp leído para evitar sobrescribir cambios concurrentes. No se modificaron componentes generados ni se reiniciaron trabajos en curso.

Pasaron las pruebas de duración, generación y validación, incluido aceptar los 6,875 y 7,452 caracteres de los intentos reportados, aceptar 8:30 y rechazar 8:31. El build con TypeScript pasó, con las cuatro advertencias previas. El código debe desplegarse para que el servidor reconozca el nuevo margen; las lecciones fallidas requieren reintento después del despliegue.

## Evidencia de la incidencia

Consulta de solo lectura del artefacto `66630878-4017-402b-ad46-4f10cc56f61d`:

- Materiales `5dabc9cb-cd08-48b4-a9a7-fbb78a21fada`, creados a las 16:11:53 UTC, estado `PHASE3_NEEDS_FIX`, versión 2 y `qa_decision: null`.
- Se crearon 20 registros de lección entre las 16:11:55 y las 16:12:01 UTC. Todos conservan `iteration_count: 0`; no hay componentes guardados.
- El padre se actualizó a las 16:27:50 UTC. La versión y el intervalo son compatibles con la recuperación por vencimiento de 15 minutos implementada en `reset_material_generation`.
- Una validación posterior de la primera lección (16:32:18 UTC) marcó componentes ausentes. No fue un intento de generación.
- No hay eventos del pipeline para este artefacto. No se dispone de los logs de esa invocación de Netlify para atribuir con certeza el fallo histórico.

La interrupción ocurrió entre la inicialización de lecciones y la primera toma de trabajo, antes de llamar al proveedor de IA. La evidencia disponible no permite atribuirla a créditos, al modelo ni al contenido.

## Fallo reproducido y corrección

`shouldDispatchBackgroundInProcess` interpretaba `NODE_ENV !== production` y `NETLIFY !== true` como desarrollo. Con ambas variables ausentes, `triggerNextLesson` devolvía éxito después de programar un temporizador local, sin enviar el siguiente trabajo por HTTP. En una función desplegada, ese temporizador puede perderse al finalizar la invocación. Un segundo fallback repetía esa conducta ante errores de red.

Netlify [documenta las variables disponibles durante la ejecución de funciones](https://docs.netlify.com/build/functions/environment-variables/): las variables del build no se deben asumir presentes en runtime. Este defecto es compatible con la incidencia; falta el log histórico para confirmar los valores de entorno de aquella ejecución.

Ahora la ejecución en proceso exige `NODE_ENV === development`. Se elimina el fallback duplicado ante errores HTTP y la versión del trabajo es un argumento obligatorio del encadenamiento. Los entornos no identificados como desarrollo conservan la protección persistente contra replay.

La interfaz ofrece **Reanudar generación** incluso cuando todas las lecciones están pendientes o la inicialización no creó ninguna. Usa la acción y la transacción existentes, con control de versión, sin lanzar un lote de reintentos individuales concurrentes. La transacción conserva lecciones generadas/aprobables y componentes guardados. Se añade el contador de pendientes, se evita validar lecciones vacías y se impide habilitar QA para una lista vacía.

Los fallos del envío inicial, de la ejecución local y del worker utilizan una sola función para guardar un diagnóstico seguro y actualizar únicamente la versión activa. La interfaz muestra ese diagnóstico; para incidencias anteriores sin motivo guardado muestra un mensaje de recuperación sin inventar una causa.

No se añaden dependencias, tablas, migraciones ni una segunda infraestructura de trabajos. Las consultas de diagnóstico no modificaron el curso remoto. La corrección necesita desplegarse antes de reanudarlo.

## Regresión

- `test:materials-generation`: envío HTTP con variables de build ausentes, payload firmado con versión, propagación de HTTP 503 y fallo de red, persistencia acotada a la ejecución activa y conservación de resultados parciales.
- `test:security-boundaries`: el entorno ambiguo nunca habilita ejecución local ni omite protección contra replay; se mantiene el comportamiento de desarrollo explícito.
- Resultado: 18 pruebas de materiales aprobadas; suite completa de seguridad aprobada; lint, comprobación TypeScript incorporada al build y build de producción aprobados; `git diff --check` sin errores.
- El build conserva cuatro advertencias previas de acceso dinámico al filesystem en servicios de plantillas/producción ajenos al cambio. No se ejecutó una nueva generación remota ni un recorrido autenticado de navegador.
