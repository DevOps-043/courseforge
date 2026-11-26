# Diseño

## Confirmación documental

La primera acción lee un manifiesto con ID, nombre, tipo y estado de cada
documento. La segunda exige su huella, ligada al artefacto y a su organización.
Las dos acciones resuelven rol revisor y organización desde la sesión. La RPC
recalcula la huella con bloqueos sobre el artefacto, la configuración y los
documentos. Un cambio exige volver a revisar la lista antes de mutar datos.

Los originales usan la descarga privada vigente. Un documento histórico de
temario solo conserva el texto extraído y se puede descargar como TXT. Una
reserva sin objeto sigue visible en la lista y carece de archivo descargable.

La RPC elimina dependencias documentales en orden y reutiliza la eliminación
del pipeline. Difiere únicamente la FK del recibo de Base hasta borrar su
artefacto y vuelve a comprobarla en la misma transacción. Cualquier error
revierte tanto los datos como la cola de Storage. La cola contiene solo rutas
registradas del bucket privado y una fecha de elegibilidad. La acción no toma
rutas de la solicitud.

La limpieza reclama hasta 100 rutas por ejecución y reintenta si falla el
borrado o su acuse. La fecha de elegibilidad es el vencimiento de la reserva
más tres horas, con margen para la firma y las transferencias. Supabase emite
URLs de carga de dos horas. Netlify ejecuta `artifact-source-cleanup` cada
cinco minutos en despliegues publicados. En un branch deploy de staging con
su propia base, el operador puede ejecutar **Run now** desde Functions una vez
vencido el plazo para verificar la limpieza. El panel informa cuando la
limpieza quedó programada.
[Firma de cargas](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl) ·
[Funciones programadas](https://docs.netlify.com/build/functions/scheduled-functions/)

Aplicar `20261110010000` antes de desplegar la interfaz. Para revertir la
interfaz, conservar el ejecutor hasta vaciar las rutas pendientes y mantener
la RPC anterior. Una eliminación confirmada requiere respaldo para restaurar
los datos.

## Borrado anterior

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
