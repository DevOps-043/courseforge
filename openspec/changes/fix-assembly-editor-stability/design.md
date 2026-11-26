# Diseño y diagnóstico

## Evidencia

- En staging el monitor muestra fallo de compilación. La ruta del preview sin puente de iframe devuelve INVALID_REQUEST: «La composición referencia assets que no pertenecen al borrador» (requestId 74397e75-7101-45a1-b788-cc90a0beb587).
- El lector editorial utiliza IDs de SLIDE_IMAGE_SET. listHyperframesSourceAssets limita sus candidatos a otros tipos, incluido SOURCE_MEDIA. initializeHyperframesDraft solo vincula candidatos y elimina el resto antes de resolver el documento, por lo que omite o retira vínculos de las imágenes editoriales.
- PostproductionAssemblyContainer depende de la identidad de academyLessonIds y materials, activa isLoading en cada consulta y sustituye el editor por un spinner. Una actualización de materiales o del snapshot equivalente desmonta el estudio e inicia otra preparación. Se confirmó ese camino en código; no se atribuye toda recarga observada a una sola causa sin el piloto.

## Cambio

El listado estabiliza el alcance por contenido de IDs, mantiene la superficie durante actualizaciones y conserva datos ante errores transitorios. Un contador descarta respuestas tardías y se invalida al desmontar. Cambiar realmente de lección sigue montando su borrador independiente.

La inicialización consulta las dependencias de imagen del documento. Solo las ausentes que pertenezcan al artefacto reconstruido para el tenant/componente se vinculan mediante upsert idempotente. Las dependencias vigentes se conservan al limpiar vínculos obsoletos, sin introducir clips de imagen duplicados. Un alias por sí solo no acredita autorización; un registro, hash o tenant inválido impide la recuperación. Preview y snapshots mantienen sus guardas propias y rechazan recursos revocados.

La recuperación se ejecuta antes de persistir el primer documento y antes de reconciliar uno existente. No reescribe fuentes editadas ni migra documentos antiguos a otro deck. No hay cambios de esquema ni SQL manual remoto. La UI de preparación ya autorizada recupera el borrador existente.

## Operación

Subida a staging autorizada por el usuario con Pedro-Echeverria01. No se publican cursos ni se generan videos. Rollback: revertir el commit; los vínculos correctos son compatibles con el esquema y no requieren borrado. La validación local no sustituye comprobar la versión desplegada y la interacción real.
