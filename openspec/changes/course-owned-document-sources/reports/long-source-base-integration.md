# Verificación de Base con fuentes largas

- `npm run test:course-sources --workspace=apps/web` pasó 62 pruebas. La ruta normal de extracción conserva DOCX y TXT de más de 120,000 unidades. Las pruebas de Base simulan un fallo intermedio, reanudan sin repetir el primer lote, conservan evidencia del inicio, medio y final y verifican que el manifiesto mantiene todos los fragmentos. Un caso multibyte de 250,000 unidades verifica el presupuesto del plan.
- `node --test scripts/test-course-source-migration.mjs` pasó 27 pruebas en PostgreSQL aislado. La lectura de hallazgos se rechaza para navegador, otra organización u otro curso. Los hallazgos aparecen en orden solo cuando todos los lotes están confirmados y dejan de estar disponibles al cambiar la revisión.
- `npm run db:migrations:check` pasó con 224 archivos SQL. No se aplicaron migraciones remotas.
- `npm run verify:pr` completó la compuerta. El primer intento quedó bloqueado por permisos al crear repositorios temporales de Git. La ejecución autorizada completó el arnés y la verificación de producto. `docs:check`, OpenSpec estricto y `git diff --check` también pasaron.

El proveedor de IA se simula en las pruebas. Quedan pendientes el archivo real, el costo, la latencia y la relevancia de citas con el modelo desplegado. La carga y Base son el alcance de esta entrega. Temario y Plan mantienen el presupuesto directo documentado y pueden requerir el paso 5 para continuar con el mismo conjunto de fuentes largas.
