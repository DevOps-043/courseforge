# Avance de Base en el detalle del curso

El mensaje «Se guardaron 16 de 23 lotes» proviene de la salida del lector de lotes cuando deja trabajo pendiente. Los lotes ya confirmados quedan guardados. El GET de la biblioteca con `limit=50` lista documentos. La confirmación del trabajo activo se consulta por el estado del artefacto.

El worker registra lectura, redacción y verificación en los metadatos que consume la consulta de estado existente. La lectura publica un contador cuando cambia. La escritura SQL conserva las otras claves y exige curso, organización, estado activo y ejecución. Si una escritura de avance falla, el worker registra un diagnóstico sin texto de las fuentes. El límite de detección de trabajos vencidos usa la hora de inicio cuando hay progreso registrado.

El detalle consulta una vez por intervalo sin solicitudes solapadas. El indicador muestra el último contador y distingue un fallo de consulta de un estado terminal. Al terminar, muestra el contenido o la opción de reintentar. La lectura conserva los lotes confirmados al reintentar con la misma revisión, propósito y modelo.

Validación local con 65 pruebas de fuentes, la suite de 30 pruebas en PostgreSQL aislado y la compuerta `verify:pr`. Las pruebas simulan la lectura de 16 de 23 lotes, la pausa y la reanudación, verifican las fases publicadas y comprueban que la escritura rechaza otra organización, una ejecución anterior y el rol de navegador. La representación de la UI cubre estados activos, detenidos y completados. Tras incorporar la hora real de inicio del worker se repitió la prueba SQL de progreso, comparando instantes con independencia de la zona horaria.

Aplicar `20261111010000_documentary_base_progress.sql` antes del despliegue. La comprobación en staging requiere iniciar Base con una sesión autorizada y confirmar que se muestran el avance y el resultado sin recargar.
