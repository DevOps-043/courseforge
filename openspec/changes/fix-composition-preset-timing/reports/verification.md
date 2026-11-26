# Verificación local

- Antes del cambio, un destino de 10,02 s a 30 fps y un preset `STACK`
  produjeron un clip de 10,0333 s. El esquema rechazó el documento por exceder el canvas.
- `npm run test:hyperframes --workspace=apps/web` terminó con código 0.
  Pasaron 707 pruebas. Las nuevas regresiones cubren `SEQUENCE` y `STACK`
  en el destino fraccionario y dos clips superpuestos en un único frame.
- `npm run docs:check` verificó 396 documentos. `npm run openspec:validate`
  validó 57 elementos. Ambos comandos terminaron con código 0.
- `npm run verify:pr` completó la compuerta del arnés y del producto.
  Lint informó 0 errores y 0 diferencias con la línea base. El arnés registró
  38 pruebas aprobadas y una omitida.

La comprobación del fallo usó una composición sintética. Queda pendiente
contrastar el resultado con un preset afectado en una sesión autenticada.

Tras acotar el diseño asistido a conflictos temporales de las reglas guardadas,
se repitieron `docs:check` (396 documentos) y `openspec:validate` (57 elementos)
con código 0. Esta revisión fue documental.
