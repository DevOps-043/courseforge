# Evidencia — 2026-11-23

## Diagnóstico verificado

Consulta Supabase de solo lectura al proyecto SofLIA - Engine, limitada al documento del curso proporcionado: revisión 9, veinte lecciones en un tramo asíncrono y las mismas cubiertas por dos sesiones. No se modificaron filas ni se copiaron credenciales. La consulta confirmó además los tres puntos de la diapositiva 7; se incorporaron como fixture de regresión sin notas privadas. La nueva partición pasa QA con los mismos puntos. No es necesario reescribir contenido para resolver ese fallo concreto.

El usuario aclaró que quiere una solución general para futuros talleres. No se cambió la asignación de este taller. Se añadió el editor explícito de destinos sobre el contrato de agenda/recorrido existente. B-rolls de sesiones confirmados como apoyos opcionales; su superficie de carga/generación no se implementó en este cambio y sigue pendiente como ampliación.

## Ejecuciones

- `npm run test:session-decks`: 86 pruebas del dominio aprobadas; incluye partición exacta de staging, preservación de palabras/referencias, rechazo real, asignación por destino y guarda previa al despacho de video. Comprobaciones adicionales de API, estados de deck y revisión integrada: código 0. Archivos locales: `.tmp/hybrid-production-tests-final2.log`.
- `node scripts/test-hybrid-assignment-ui.cjs`: código 0; render real con tres destinos, resumen, selector de sesiones/tramo y bloqueo al guardar. La fixture local es ficticia. El script produce una vista reproducible para revisión, no aplica cambios al curso.
- `npm run verify:pr`: código 0, «Compuerta completada», con TEMP/TMP del proceso en `.tmp/hybrid-production-process-temp`. Incluye 86 pruebas del dominio, tipos, arquitectura, migraciones locales y seguridad. La compuerta de lint reportó 0 errores, 558 warnings existentes y 0 diferencias con baseline. Se completó antes de los últimos controles de búsqueda/filtro, verificados además con ESLint y tipos dirigidos.
- `npm run test:remotion -w apps/web` y `npm run test:hyperframes -w apps/web`: códigos 0.
- `npm run docs:check`, `npm run openspec:validate` y `git diff --check`: sin errores en la ejecución local. Los avisos LF/CRLF no son conflictos de merge.
- Revisión visual nativa en Chrome de la salida SSR del editor: opciones compartida, solo Hub y solo Academy legibles en ventana estrecha, con las sesiones y el tramo junto al tema. No acredita hidratación o persistencia desplegada. Las operaciones de asignación y rechazo de destinos ausentes están cubiertas por tests del helper real.

## Revisión adversarial del mismo agente

- El destino se deriva de agenda y recorrido; no se crea una segunda fuente de verdad. Cambiar una selección actualiza solo el borrador hasta guardar por el servidor existente, con concurrencia, invalidación y validación completas.
- Un tema compartido no se vuelve síncrono exclusivo por aparecer en la agenda. Los recursos previos se conservan; el filtrado visual adicional no sustituye los controles server-side.
- Sin snapshot no se montan las superficies de video bajo Nexus predeterminado. Los cambios de alcance remontan las superficies para retirar selecciones montadas previamente. Ensamble también filtra componentes huérfanos de sus lecciones visibles.
- La producción de video comprueba el contexto después de autorización y antes de credenciales/despacho; los servicios de worker conservan la comprobación. No se desactivan autenticación, tenancy, respaldo de fuentes o QA.
- El mínimo de explicación se comparte con QA sin alterar su valor de 60. La partición usa la misma normalización y devuelve el rechazo original cuando no existe distribución válida. Se incrementa la versión para no reutilizar el asset fallido v1.
- No hay migración, despliegue, generación pagada, commit, push, cambio de permisos ni edición del curso remoto. No se ejecutó build ni prueba cloud.

## Pendiente después de desplegar

Probar autoría hidratada: cambiar un tema de compartido a solo Hub en un taller de prueba nuevo, guardar, revalidar dependencias y comprobar que no aparezca como video en Producción/Ensamble. Producir de nuevo el deck de sesión con conversor v2 y comprobar su QA persistido. La carga/generación de clips opcionales de Hub continúa pendiente; no confundir su ausencia con un requisito de video final.
