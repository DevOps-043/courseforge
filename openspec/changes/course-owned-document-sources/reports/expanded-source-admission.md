# Ampliación de admisión y recuperación documental

- El extractor y PostgreSQL aplican un máximo de 600,000 unidades UTF-16 por original. La prueba SQL publicó 600,000 unidades íntegras, incluida una sección final con Unicode, y rechazó 600,001 y un conjunto incompleto. Verificó aislamiento, lease y publicación idempotente.
- El TXT de referencia se procesó con el worker de dominio, Storage simulado y las RPC reales en PostgreSQL aislado. Se simuló una versión agotada por `TEXT_LIMIT`. El cuarto intento dejó un solo original en `READY`. El hash del texto persistido coincidió con el de las 530,704 unidades normalizadas. Se guardaron 266 fragmentos y PostgreSQL aceptó su plan de Base de 23 lotes. Un proveedor simulado confirmó los 23 lotes con citas literales comprobadas por SQL, incluida una del último fragmento.
- `npm run test:course-sources --workspace=apps/web` pasó 63 pruebas. `node --test scripts/test-course-source-migration.mjs` pasó 29 pruebas. `npm run db:migrations:check` pasó con 226 archivos SQL.
- `npm run verify:pr`, OpenSpec estricto y la comprobación de enlaces de documentación terminaron con código 0.

La prueba con el TXT real no llamó a un proveedor ni redactó Base. El límite de admisión se evaluó por archivo. El presupuesto de generación para conjuntos de archivos y los límites de contexto de Temario y Plan siguen siendo independientes. Aplicar la migración antes del despliegue y reprocesar la versión existente desde la biblioteca.
