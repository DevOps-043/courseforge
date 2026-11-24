# Validación y operación

Fecha: 2026-11-24, America/Mexico_City.

## SQL aplicado con autorización

El usuario autorizó expresamente la migración `20261124150000_fix_api_rate_limit_clock.sql` y la prueba `supabase/tests/api-rate-limit-clock.sql` sobre SofLIA Engine, compartida con producción. Se ejecutaron mediante el SQL Editor de Supabase. Resultado observado: «Success. No rows returned». La migración termina con COMMIT; el bloque de regresión posterior termina con ROLLBACK. La prueba comprueba primera/segunda petición, bloqueo al superar cuota, aislamiento de claves, renovación de ventana y permisos. No se borraron ni reiniciaron contadores reales, ni se aplicó otra migración.

Los registros previos mostraban error 42804 por asignar timetz a window_started_at timestamptz. Después del arreglo, la consulta inicial del editor pasó a 200 y mostró ausencia de revisión activa. El POST siguiente devolvió 409; no se repitió automáticamente.

## Segundo defecto reproducido

Documento actual del borrador 8b526a02-8bcc-4702-88a0-f233adc3aafb: versión 1, 20 clips, duración 100, origen slides, FPS 25, cero campos vinculados. Las guardas locales de render y tipografía pasaron. El pin guardado empieza por 687ff4fd y el JSON recibido produce 21d7595f. Reconstruir únicamente visualPlan y wordTimestamps undefined en escenas narrativas reproduce exactamente el pin guardado. La corrección conserva las identidades de JSON existente y añade recuperación exacta por nueva versión/CAS, sin reescribir historia.

## Pruebas

- `npm run test:slide-fields`: 88 aprobadas, cero fallos. Incluye herramienta sin efectos al abrir, estado preparado sin disclosure, acceso desde menú, error correlacionado seguro, journal vacío antes de envío fallido, identidad JSON y recuperación exacta por CAS.
- Guardia de migraciones: 236 archivos SQL, aprobada.
- `npm run verify:pr` sobre el cambio completo: código 0, compuerta completada. Lint: cero errores, 558 advertencias existentes y cero diferencias con baseline. Incluye tipos, arquitectura, migraciones, seguridad y pruebas establecidas.
- La primera suite HyperFrames detectó una aserción estructural del montaje anterior. Se actualizó para verificar la cadena NativeCompositionPreview → CompositionSlideEditingTools → centro de recuperación conservando las aserciones de ownership y no adopción histórica. Reejecución completa: 713 pruebas aprobadas, cero fallos.
- `npm run docs:check`: 497 documentos, enlaces locales aprobados.
- `npx openspec validate repair-slide-field-tools --strict --no-interactive`: aprobado.
- `git diff --check`: sin errores.

Durante desarrollo hubo mocks incompletos (proceso/configuración y clase de error) en pruebas nuevas. Se completaron las fronteras simuladas sin retirar aserciones; las 88 dirigidas corresponden a la ejecución posterior.

## Revisión adversarial y límites

Revisión realizada por el mismo agente. La recuperación solo se invoca desde inicialización explícita de un deck generado, fuera de modo manual, sin campos vinculados y ante coincidencia exacta con la firma conocida. Usa el RPC de append/CAS y auditoría SYSTEM; no acepta un hash distinto ni sobrescribe revisiones. Preview, anclaje, bindings, grants, rate limiting, locks y verificación de recibos permanecen activos. No hay reintento automático de POST incierto. La herramienta usa EngineDialog con foco, Escape y cierre bloqueado durante trabajo activo.

No se generó HeyGen, avatar, locución ni video final. La inspección remota usó la sesión ya abierta y no leyó credenciales. Una bandera booleana no secreta se consultó sin modificarla. Una intercepción temporal de respuesta HTTP fue retirada sin cambiar el contenido de la respuesta.

El acceso al navegador local quedó deshabilitado al retomar; el usuario indicó que lo habilitará. Pendiente validar la interfaz desplegada y completar la preparación real tras subir el código. Los datos de reproducción del curso y logs permanecen ignorados bajo .tmp; no se publican.
