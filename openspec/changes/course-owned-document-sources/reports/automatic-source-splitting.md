# División automática de originales largos

- La ruta de extracción procesó TXT y DOCX sintéticos superiores a 600,000 unidades. Cada escritura transportó hasta 16 fragmentos y se verificaron orden, contenido y localizadores, incluido Unicode.
- PostgreSQL aislado publicó 1,200,000 unidades completas y rechazó un límite declarado superior, una secuencia incompleta, un lease ajeno y una organización distinta. Una segunda publicación excedió el presupuesto del curso y no guardó fragmentos visibles. Retirar la primera fuente permitió publicar la segunda. La prueba de recuperación verifica que la capacidad superior abre un intento sin reiniciar el contador.
- Un TXT de prueba formado por dos copias del documento de referencia se procesó como un solo original con Storage simulado y las RPC reales en PostgreSQL aislado. Se comprobó por hash la integridad de las 1,061,410 unidades normalizadas. El resultado quedó en `READY` con 531 fragmentos y PostgreSQL registró un plan de Base de 45 lotes.
- Un TXT sintético multibyte de 1,200,000 unidades se extrajo completo y quedó en `READY`. El plan ampliado produjo 200 lotes y los confirmó mediante PostgreSQL con respuestas de modelo simuladas. La selección incluyó una cita del último fragmento.
- `npm run test:course-sources --workspace=apps/web` pasó 63 pruebas. `node --test scripts/test-course-source-migration.mjs` pasó 29 pruebas. `npm run db:migrations:check` pasó con 227 migraciones.
- `npm run verify:pr`, OpenSpec estricto, `docs:check` y `git diff --check` terminaron con código 0.

La revisión usó procesamiento local y modelos simulados en las pruebas de Base. Quedan pendientes el proveedor real, la concurrencia entre conexiones en el entorno desplegado y el consumo de fuentes largas por alcance en Temario y Plan. Los parsers mantienen en memoria el texto normalizado y generan los fragmentos en tramos para persistirlos.

## Corrección del presupuesto del snapshot de Base

- La prueba de integración reprodujo `SOURCE_CONTEXT_BUDGET` con el archivo sintético ya publicado y la definición anterior de `snapshot_course_source_generation`. El rechazo ocurría antes de crear los lotes.
- Tras aplicar `20261110040000`, el mismo curso de 1,200,000 unidades UTF-16 con Unicode conserva el snapshot al reintentar y registra un plan de 200 lotes con progreso `ACTIVE`. Un acceso con otra organización se rechaza. El mismo manifiesto excede los límites de Temario y Plan.
- `node --test scripts/test-course-source-migration.mjs` pasó 29 pruebas. `db:migrations:check`, `docs:check`, OpenSpec estricto y `git diff --check` terminaron con código 0.
- La verificación es local en PGlite con migraciones reales. Queda pendiente reintentar el borrador en staging con el proveedor real después de aplicar la corrección.
