# Diagnóstico y evidencia local

Fecha: 21 de noviembre de 2026. Cambio comprobado sobre `d024b4b4` en `codex/live-session-preparation`, integrado por fast-forward y con los conflictos de los cambios locales resueltos.

## Hallazgos

La inspección de solo lectura en Supabase Engine confirmó el índice único de componentes, los RPC de guardado y las tablas de impartición. En la muestra inicial de catorce días, seis ejecuciones híbridas de materiales de sesión tenían cero unidades confirmadas. Diecinueve lecciones de Academy estaban en `NEEDS_FIX`, sin componentes guardados. Los mensajes de respaldo y la ausencia de recibos en 28 snapshots asíncronos situaron el fallo antes de confirmar la escritura. La inspección posterior confirmó la columna de cola de reintentos. El [diagnóstico integrado](../../coordinate-material-generation/reports/rejection-and-visible-status.md) identifica rechazos `UNSUPPORTED_OUTPUT` y un fallo aparte de duración en `VIDEO_DEMO`.

La auditoría distingue el contenido factual de las decisiones didácticas y sigue exigiendo citas literales y recibos para aceptar un resultado. Una cita inexacta permite corregir la revisión del mismo resultado. Un rechazo factual permite generar una sola corrección por intento si queda presupuesto. Se exige una revisión favorable del contenido corregido antes de guardar. Las correcciones de duración reciben su instrucción medida, sin volver a incluir la instrucción de generación inicial. El API de progreso comprueba la revisión confirmada antes de entregar un estado terminal.

## Comprobaciones

| Comando | Resultado |
| --- | --- |
| `npm run test:coordinated-materials` | 64 pruebas de impartición, 32 de generación, 5 de recuperación y 6 de cola SQL aprobadas. |
| `npm run test:course-sources` | 80 pruebas TypeScript y 35 de PostgreSQL local aprobadas. El caso híbrido usa las migraciones integradas y verifica ambas escrituras, la revisión anterior y el rechazo de resultados obsoletos. |
| `npm run test:video-duration -w apps/web` | 43 pruebas de duración, validación y video, más 32 de materiales aprobadas. |
| `node --test scripts/test-course-delivery-sql.mjs` | 14 pruebas aprobadas, incluidos historial, concurrencia, roles y aprobación. |
| `npm run test:curation -w apps/web` | Aprobado. |
| `npm run qa:hybrid-materials` | Aprobado en Chrome local con flujos simulados y peticiones externas bloqueadas. |
| `npm run verify:pr` | Compuerta completa aprobada, con 0 ciclos y 0 diferencias en la línea base de lint. |

La primera compuerta tras integrar se detuvo por cinco tolerancias de lint obsoletas y luego por dos ciclos en las dependencias de impartición. Se retiraron solo las tolerancias ausentes y se eliminaron la autoimportación del handler y el ciclo de tipos entre recorrido y política. La red local de prueba utilizó la versión de Puppeteer fijada por el repositorio y PGlite en directorios temporales.

Las pruebas locales cubren las escrituras y lecturas con PostgreSQL y respuestas de IA simuladas.

## Piloto autorizado en staging

La guía sintética se extrajo en dos fragmentos. La primera reserva de Base registró cero invocaciones en Engine porque faltaba el RPC que permite tomar el trabajo. Se aplicó con autorización el SQL de `20261114010000`; el conector lo registró como `20261121184340_documentary_base_continuation`. Los cinco RPC de continuación permiten ejecución a `service_role` y la deniegan a `anon` y `authenticated`. Se añadió un reintento autenticado desde el mismo borrador para recuperar el despacho inicial cuando quedó en un despliegue anterior. En la primera recarga, la consulta de avance pidió `qa_status` en `artifacts`, columna ausente en Engine. La lectura se ajustó al esquema y filtra por organización.

El worker tomó la misma ejecución tras el reintento en staging. Los dos modelos configurados para Base fallaron antes del guardado y el borrador pasó a `ESCALATED`. Base registra el código HTTP del proveedor y las causas conocidas de acceso, esquema y espera sin copiar mensajes ni respuestas del proveedor.

En el segundo intento, `gemini-3.5-flash` y `gemini-2.5-flash` devolvieron `HTTP_402`. Engine conservó dos snapshots de fuentes de Base sin evidencia de contenido confirmado. La consulta por artefacto encontró cero temarios, ejecuciones o recibos síncronos de materiales y paquetes o componentes asíncronos. La UI identifica el bloqueo de facturación con el diagnóstico persistido. El piloto conserva los modelos configurados por la organización.

## Configuración de OpenAI para cursos

La combinación elegida es `gpt-6.1-terra` con respaldo `gpt-6.2-sol`. Las pruebas de fuentes cubren el uso de `web_search` mediante Responses y la ausencia de llamadas a Gemini cuando ambos modelos son de OpenAI. También se verificaron las suites de Temario y Curación. La prueba con el proveedor real requiere cambiar la configuración activa y seguir el borrador en staging.
