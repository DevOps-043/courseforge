# Diseño

La acción obtiene rol y organización de la sesión vigente y llama a
`delete_artifact_for_organization` con un UUID validado. La RPC bloquea la fila
del artefacto filtrada por organización. Si existe configuración documental,
bloquea su fila antes de comprobar reservas y originales. El bloqueo de las
filas padre coordina las inserciones que requieren sus claves foráneas.

Se eliminan las relaciones históricas en su orden de dependencia y la
configuración documental cuando puede retirarse. La fila de idempotencia pierde
el vínculo y el título, y conserva la clave para rechazar reintentos y mantener
el cómputo de la cuota diaria. La RPC
usa SECURITY DEFINER con search_path vacío y EXECUTE exclusivo del backend.
Se retira DELETE directo sobre artefactos a los roles de navegador para
impedir que las políticas históricas permisivas omitan esta frontera.
No concede DELETE de tablas documentales al backend ordinario ni accede a
Storage. Las restricciones SQL existentes revierten la operación completa si
queda una dependencia protegida. No se agregan índices ni se cambian cascadas.

Desplegar la migración antes de la aplicación. La reversión del código debe
conservar el bloqueo de eliminación antes de restaurar una versión con borrados
independientes. La función se puede retirar con DROP FUNCTION cuando no queden
consumidores. Mantener la columna nullable y el manejo de reintentos mientras
existan claves de borradores eliminados. Una eliminación confirmada requiere recuperación desde respaldo
si se necesita restaurar sus datos.
