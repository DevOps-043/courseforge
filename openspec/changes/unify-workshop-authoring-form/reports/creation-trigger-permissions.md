# Bloqueo al crear un artefacto desde navegador

## Reprueba autenticada después de aplicar SQL

El usuario informó haber aplicado el SQL y autorizó repetir la creación. El 19 de noviembre se creó desde localhost el curso «Prueba local · Comunicación Asertiva en Entornos Remotos», ID 238c635b-1dab-4997-ab6c-2c2fc85eb080. Se seleccionó Híbrido, 90 minutos, enfoque equilibrado, taller complementario y No sincronizar con Drive. La aplicación generó tres nombres, cinco objetivos y descripción; Base apareció APPROVED y permitió continuar a Estructura. Tras recargar la ficha se verificó persistencia de la modalidad y preferencias. No reapareció el error de permisos. No se ejecutó SQL desde el agente.

La primera carga de impartición mostró signal timed out mientras Next compilaba; tras recargar y esperar el panel mostró Híbrido correctamente, sin errores nuevos en consola. Esta recuperación no demuestra resuelto el timeout. La prueba cubre creación y Base del híbrido, no las fases posteriores ni la entrega a Learning/Hub ni una creación síncrona independiente. El curso de prueba se conservó. Captura local: hybrid-creation-after-sql.jpg en visualizaciones de la conversación.

Fecha: 19 de noviembre de 2026. Corrección local preparada; SQL remoto no ejecutado.

La prueba autenticada en localhost seleccionó síncrono e híbrido y comprobó los límites de duración. Al crear el híbrido, la inserción en artifacts devolvió permission denied for table course_source_settings, antes del despacho de IA.

La guarda guard_course_source_structure_generation es SECURITY INVOKER y consulta tablas documentales privadas incluso cuando el artefacto nuevo todavía no tiene configuración documental. Su trigger se ejecuta en INSERT/UPDATE de artifacts, syllabus e instructional_plans. El usuario autenticado puede tener permiso sobre el curso sin tener acceso a esas tablas privadas.

La migración incremental 20261119010000_course_source_structure_trigger_permissions.sql cambia exclusivamente esa función a SECURITY DEFINER, conserva search_path vacío y revoca invocación pública. Debe aplicarla un propietario de migraciones confiable; verificar previamente que el propietario actual de la función sea el esperado. No concede SELECT al navegador, no cambia RLS y conserva todas las guardas documentales. El trigger no es una RPC de lectura ni devuelve información documental al usuario. La autorización de escritura continúa en las políticas de las tablas de origen.

Verificación ejecutada: node --test scripts/test-course-source-trigger-permissions.mjs, aprobada en PGlite aislado. Reproduce el error antes de aplicar la migración, permite crear después, prueba reejecución idempotente, mantiene prohibida la lectura de la tabla privada, rechaza un propietario ajeno por RLS y conserva SOURCE_REVIEW_REQUIRED para generación documental sin revisión. Usa el cuerpo real de la función de F4 y las nuevas sentencias SQL; no valida el despliegue remoto ni todos los triggers del pipeline.

Aplicación pendiente en la base Supabase utilizada por Architect local, después de las migraciones documentales F3/F4. No confundir localhost con una base de datos local: no se inspeccionaron credenciales ni se ejecutó SQL remoto. Tras aplicarla, repetir la creación desde el formulario y verificar la generación. Para revertir, restaurar SECURITY INVOKER: reaparece el bloqueo original, sin pérdida de datos. No hay commit ni push de esta corrección en esta revisión.
