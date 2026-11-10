# Eliminar artefactos de forma atómica

El borrador documental crea registros con claves foráneas hacia el artefacto
incluso antes de recibir archivos. El borrado anterior omite esos vínculos y
envía las eliminaciones relacionadas como solicitudes independientes.

La acción conserva los roles revisores y ejecuta una sola transacción limitada
a la organización activa. Los borradores sin originales pueden eliminarse.
Las reservas, originales y dependencias protegidas producen un aviso sin
borrado parcial.
