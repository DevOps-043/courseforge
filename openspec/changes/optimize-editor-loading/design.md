# Diseño

Las etapas se cargan con imports dinámicos estables en el módulo y un indicador
accesible. El contenedor de composición no depende de los medios: se prepara
en paralelo con su sincronización. Se esperan ambos resultados antes de solicitar
el borrador; la biblioteca puede consultarse al terminar la sincronización.
No se reordenan operaciones de edición ni se conserva un borrador en caché.

La inicialización reutiliza el identificador del borrador resuelto para vincular
medios y cargar el documento. El endpoint de biblioteca consulta el registro de
medios y la biblioteca HTML en paralelo después de autorizar la solicitud.
La lista muestra un icono para cada video y carga las imágenes cerca del área
visible. La vista previa del editor solicita los medios privados que necesita
para reproducir la composición.

La recuperación histórica de escenas ya promueve los clips locales. La
sincronización inicial usa esa operación una vez en la ruta exitosa y recurre
a la recuperación local cuando falla el acceso o la consulta del proveedor.
La respuesta exitosa separa preparación, recuperación de escenas y registro
de medios mediante `Server-Timing` para diagnosticar la ruta crítica.

La sincronización comprueba registro y metadatos de cuatro referencias por lote.
Cada lote termina antes de descargar/escribir sus medios, que siguen siendo
secuenciales para no multiplicar memoria por el tamaño de los videos. Los
errores se propagan después de resolver las comprobaciones en vuelo y no se
lanzan lotes posteriores. Se preservan filtros de organización/componente,
integridad, detección de cambios y recuperación tras colisión de unicidad.

Rollback: revertir los archivos del cambio. No requiere migraciones ni conversión
de documentos. La evidencia local no sustituye medición con sesión real.
