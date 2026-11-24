# Diseño

## Diagnóstico

En el taller dca8d686-2c8a-413f-b4a6-5b1e4b187547 la comprobación inicial devuelve 503. Las funciones de anclaje están instaladas y la bandera de servidor está activa para branch deploys. Supabase registra cuatro POST a consume_api_rate_limit con 400 y eventos PostgreSQL 42804 en los mismos instantes (08:14, 08:19, 08:25 y 08:26 del 24 de noviembre). El error identifica window_started_at: requiere timestamp with time zone y recibe time with time zone.

La migración original declara current_time, pero las expresiones SQL resuelven CURRENT_TIME como la palabra reservada. La migración incremental cambia únicamente esa referencia a v_now, manteniendo firma, tabla, ventanas, límites y grants. No se borran ni reinician contadores. Los callers editoriales fallan cerrados cuando falla esa dependencia; no corresponde atribuirlo al contrato de las slides.

## Interfaz y recuperación

El menú Herramientas del monitor abre Campos de diapositivas en EngineDialog, reutilizando foco, Escape y cierre accesible. Se elimina el centro de preparación de la superficie superior. Dentro de la herramienta, la preparación de todo el deck deja de ser desplegable. Recuperaciones, recibos históricos y acciones existentes se conservan y siguen visibles al abrir herramientas independientemente de banderas de escritura. Abrir/cerrar no prepara ni consulta automáticamente. Un trabajo activo impide cerrar el diálogo; los journals persistidos conservan la recuperación ante interrupción.

Los errores previos al envío del lote conservan status y requestId seguro. El cliente no muestra cuerpos ni detalles de proveedor y no sugiere recalcular duración ante un 503. Un error después de enviar el lote sigue siendo un resultado incierto y exige consultar el recibo; no se repite el POST.

Una vez corregido SQL, GET pasó de 503 a 200. El siguiente POST devolvió 409. Se comprobó que el borrador ya tenía duración 100, origen slides y 25 FPS; recalcular no lo cambió. Las guardas de render y fuentes también pasaron localmente. No era un defecto de duración.

El JSON devuelto tenía hash canónico 21d7595f… pero pin guardado 687ff4fd…. Se reprodujo exactamente el pin antiguo al reintroducir visualPlan y wordTimestamps como undefined en las escenas narrativas. El algoritmo anterior incluía esas claves en el digest aunque JSONB las descartara. La serialización canónica ahora sigue JSON para undefined, conservando las identidades de documentos JSON existentes. La inicialización explícita de decks generados reconoce solo esa firma histórica exacta y crea una nueva versión por el RPC/CAS normal, con auditoría. Nunca reescribe historia ni acepta pins arbitrarios, documentos ya vinculados o una inconsistencia distinta. Las lecturas no reparan ni escriben datos.

La herramienta ofrece el mismo comando de recálculo del timeline únicamente cuando falte realmente el metadato de origen, sin ordenar clips ni etiquetar la duración como manual para eludir el contrato. No se permite preparar automáticamente en un efecto ni se relaja la guarda del snapshot.

## Datos y autorización

Instancia propietaria: SofLIA Engine (emsjctbdevufloxntjll), compartida con producción. Se siguen las rutas propias de Courseforge: supabase/migrations y supabase/tests. El usuario autorizó explícitamente aplicar 20261124150000_fix_api_rate_limit_clock.sql y ejecutar api-rate-limit-clock.sql. Este último valida límite, renovación de ventana, aislamiento de claves y permisos; termina con ROLLBACK. No se cambian tablas, RLS ni datos de cursos.

## Verificación y reversión

Pruebas dirigidas de anclaje, coordinador, host y herramientas; suite HyperFrames, guardia de migraciones y verify:pr. El piloto debe demostrar que se supera el requisito previo y se preparan los campos reales, sin render cloud. La corrección SQL no depende del nuevo cliente. Ante una regresión visual puede revertirse el commit de interfaz conservando el reloj corregido; restaurar CURRENT_TIME reintroduciría el fallo. No se desactiva rate limiting como mitigación.
