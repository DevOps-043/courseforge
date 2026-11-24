# Diagnóstico y solución

El cliente reportó INTERNAL_ERROR al preparar proyecto de edición, request
8cd87592-7175-421e-b4f3-a4be544aee4a, sin log interno disponible. La ruta corresponde
a POST compositions/[compositionId]/draft de HyperFrames. Consulta de solo lectura
del curso proporcionado confirmó un borrador ACTIVE sin documentos y cinco assets
vinculados. La especificación guardada supera schema/hash; el artefacto reproducido
con los cinco registros exactos coincide en hash, veinte slides y 82 campos.

La reproducción local de la secuencia posterior falló en presentationSource con
ANIMATED_DECK_VALIDATION_FAILED y cinco URLs de imágenes rechazadas. Esa función
llamaba al preprocesador con su lista permitida vacía, aun después de verificar
las imágenes. No depende de fuentes personalizadas ni del nuevo flujo B-roll.
Sin el log original no se afirma que sea el único posible error de esa petición;
sí se reprodujo un fallo determinista del camino con los datos actuales.

La corrección calcula las URLs permitidas únicamente después de verificar el
registro tenant/componente de cada imagen, ruta, checksum, schema y hashes del
spec/artefacto. Se pasan solo esas URLs exactas al preprocesador. No hay allowlist
por dominio, fallback permisivo ni red adicional. Los campos editables continúan
usando identificadores del registro y sus grants independientes.

La proyección transforma un rechazo del preprocesador en error editorial seguro.
La ruta clasifica indisponibilidad como 503 reintentable y fallo de integridad o
fuentes como 422 no reintentable automáticamente, con reason y correlación. No se
devuelven URLs ni detalles internos del proveedor.

Reproducción después del cambio: reader verificado, 21 escenas narrativas,
documento inicial construido y veinte clips en courseforge-composition-v2. No se
insertó el documento en la base remota ni se inició un render. El borrador sin
documento puede reintentarse tras desplegar: se recupera su identidad existente.

Rollback: revertir el lector y clasificación HTTP sin borrar archivos, borradores
o documentos. El artefacto, hashes, motion y contratos persistidos no cambian.
