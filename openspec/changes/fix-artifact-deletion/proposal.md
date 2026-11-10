# Eliminar artefactos de forma atómica

El borrador documental crea registros con claves foráneas hacia el artefacto
incluso antes de recibir archivos. El borrado anterior omite esos vínculos y
envía las eliminaciones relacionadas como solicitudes independientes.

La acción conserva los roles revisores y exige dos pasos. El segundo presenta
los originales, reservas y documentos del temario con opción de descargar lo
que se conserva. La confirmación elimina el curso y sus registros documentales
en una transacción limitada a la organización activa. La limpieza de originales
usa una cola persistente. Una dependencia protegida revierte la transacción.
