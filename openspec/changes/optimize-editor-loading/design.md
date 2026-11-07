# Diseño

Las etapas se cargan con imports dinámicos estables en el módulo y un indicador
accesible. El contenedor de composición no depende de los medios: se prepara
en paralelo con su sincronización. Se esperan ambos resultados antes de solicitar
el borrador; la biblioteca puede consultarse al terminar la sincronización.
No se reordenan operaciones de edición ni se conserva un borrador en caché.

La sincronización comprueba registro y metadatos de cuatro referencias por lote.
Cada lote termina antes de descargar/escribir sus medios, que siguen siendo
secuenciales para no multiplicar memoria por el tamaño de los videos. Los
errores se propagan después de resolver las comprobaciones en vuelo y no se
lanzan lotes posteriores. Se preservan filtros de organización/componente,
integridad, detección de cambios y recuperación tras colisión de unicidad.

Rollback: revertir los archivos del cambio. No requiere migraciones ni conversión
de documentos. La evidencia local no sustituye medición con sesión real.
