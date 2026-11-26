# Diseño

## Contrato y persistencia

El endpoint de sesión acepta INIT, CONFIRM, APPROVE y ARCHIVE. La reserva usa UUID de carga estable y `production_assets` existente con tipo SOURCE_MEDIA, provider manual, contexto tenant/curso y metadata session_broll/session_id/source_hash. No se inventa componente Academy. La fuente de vigencia es un hash de sesión, plan, materiales y aprobación; no depende del algoritmo del deck visual. No se modifica el agregado ni las aprobaciones del curso.

INIT exige revisión vigente y materiales aprobados; verifica que el bucket existente production-render-sources sea privado. Reserva antes de firmar y comprueba pertenencia e identidad de la carga. Ruta construida exclusivamente en servidor con org/curso/sesión/asset/extensión. Firma sin upsert: repetir no sobrescribe bytes. La UI conserva el mismo UUID al reintentar. Tras recarga, una reserva pendiente permite verificar el objeto ya subido o retirarlo del listado.

CONFIRM contrasta tamaño real y descargado, inspecciona el formato, pista de video, duración y dimensiones con el inspector existente extraído a producción/media-inspection.service. Límites: 100 MiB, 10 minutos, lado mayor 1920 px. Un archivo con audio propio se permite, pero no se solicita ni genera locución y la reproducción comienza silenciada. La firma de carga no valida el formato: solo se sirve un clip después de confirmar su contenido real.

GENERATED indica revisión humana pendiente. APPROVE requiere rol revisor, pertenencia y hash vigente; no aprueba materiales ni curso. ARCHIVE es retiro reversible por administración de datos, conserva objeto y fila, y no revive ante una confirmación concurrente. No se añade un botón de restauración en esta entrega. Actualizaciones usan compare-and-set de estado y hash; aprobaciones y retiro toleran reintentos.

## Acceso y UI

Autorización de tenant/curso y pertenencia a agenda en cada operación. Sesiones y materiales deben seguir aprobados/vigentes. Si cambian, los clips aparecen como pendientes de nueva validación; su aprobación anterior se limpia al confirmar para la revisión actual. La lectura es paginada por UUID (20 elementos) y no expone rutas privadas o tokens en el listado.

La reproducción pasa por endpoint autorizado y redirige a URL privada firmada por cinco minutos; no se persiste. Una URL ya emitida puede durar hasta su expiración tras retirada o cambio de revisión. La respuesta no usa caché compartida y establece no-referrer. No se aceptan URLs remotas arbitrarias. Firma de carga: expiración de dos horas del SDK/Supabase existente; no permite sobrescritura.

La sección está en cada sesión desplegada dentro de Producción y disponible junto a todas las audiencias de autoría. No se exportan clips automáticamente a documentos de participante ni se publican. Hay carga, vacío opcional, error, reintento, verificación, revisión, aprobación y retiro. La carga va directamente a Storage con URL firmada y timeout de tres minutos/cancelación al salir; JSON de comandos limitado a 2 KiB y timeout de verificación de un minuto. Una respuesta incierta conserva el mismo UUID y permite consultar estado.

## Operación y límites

Sin cola, proveedor ni migración. Se requiere el bucket privado ya usado por producción. El inspector verifica estructura/metadatos, no decodifica todos los fotogramas ni certifica calidad pedagógica. Cargas fallidas pueden dejar reservas u objetos; retirar conserva evidencia y esta entrega no implementa limpieza automática ni cuota transaccional por sesión. La validación local no prueba Storage/RLS remoto.

Rollback: retirar componente/ruta; los recursos quedan privados en Storage y los registros se conservan. La extracción del inspector mantiene los exports del servicio standalone para compatibilidad. No cambia motion, snapshot, ZIP ni render.
