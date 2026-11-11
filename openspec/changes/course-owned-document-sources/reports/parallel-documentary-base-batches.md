# Rendimiento de la lectura documental de Base

La planificación local de 266 fragmentos y 23 lotes tomó una mediana de 9.53 ms en 30 repeticiones con el contador anterior. Serializar cada fragmento una vez redujo la mediana a 1.87 ms. La huella de la lista de lotes y las reservas por lote coincidió, por lo que el optimizador puede retomar las ejecuciones persistidas.

La implementación anterior hacía una llamada al proveedor por vez y consultaba avance después de cada lote. La nueva reserva concede hasta tres lotes por transacción. Los intentos comparten presupuesto, cada lote conserva su lease y los resultados de un lote permanecen confirmados aunque otro falle. Se publican los contadores al terminar cada grupo y se aprovechan lotes disponibles mientras otros esperan reintento.

| Simulación de 23 llamadas con espera de 50 ms por llamada | Una llamada simultánea | Tres llamadas simultáneas |
|---|---:|---:|
| Tiempo de lectura | 1,439 ms | 507 ms |
| Solicitudes al modelo simulado | 23 | 23 |
| Reservas de lotes | 23 | 8 |
| Consultas de avance | 24 | 9 |

La prueba usó un proveedor simulado. En producción, el tiempo por llamada incluye la red desde el worker y el procesamiento del proveedor. La conexión del navegador interviene en el inicio y las consultas de estado. El worker registra `planningMs`, `batchRunMs` de creación o recuperación de la ejecución, `readingMs` de reloj, `providerMs` y `databaseMs` acumulados, y `providerRequests`. En paralelo, los tiempos acumulados pueden superar el tiempo de reloj. El registro usa identificadores y duraciones sin incluir el contenido de las fuentes.

Pasaron 67 pruebas de fuentes, 31 de PostgreSQL aislado y la verificación de migraciones, documentación y OpenSpec. La prueba SQL focalizada también verificó que la espera por reintento no consume presupuesto.

Aplicar la migración `20261111020000_parallel_documentary_base_batches.sql` antes de desplegar. Una reversión del worker puede seguir usando la reserva individual. Medir una ejecución comparable en staging para confirmar el tiempo real y la incidencia de respuestas de límite de solicitudes del proveedor.
