# Validación local — 2026-11-23

## Alcance entregado

Carga manual, validación real de MP4/WebM, listado paginado, reproducción privada,
aprobación de apoyo y retiro sin borrado en las sesiones de Producción. La ausencia
de clips no añade requisitos a la aprobación ni entrega del curso. No se genera
contenido con proveedores ni se publica automáticamente en destinos externos.

## Pruebas

- `npm run test:session-brolls`: 93 pruebas del dominio aprobadas, nueve estados SSR
  del componente B-roll y cinco estados de revisión integrada. Incluye cargas y
  confirmaciones idempotentes, aprobación humana con permisos, rechazo de sesiones
  ajenas, colisión de identificador, tamaño real distinto, bucket público, ruta
  manipulada, obsolescencia, retiro concurrente y cambio de revisión durante inspección.
- El inspector real acepta una fixture MP4 de 2239 bytes, un segundo de imagen negra
  de 64 × 64 sin audio, y rechaza formato declarado incorrectamente y bytes falsos.
  La fixture fue generada con FFmpeg local y tiene procedencia documentada en su
  directorio. No requiere FFmpeg para ejecutar CI. Las pruebas del servicio usan
  Storage/repositorio simulados; no acreditan RLS ni upload remoto.
- `npm run test:remotion -w apps/web` y `npm run test:hyperframes -w apps/web`: códigos 0.
- ESLint de la compuerta general: 0 errores, 558 warnings existentes, sin diferencias
  con baseline. Los primeros errores de tipos por imports obsoletos tras mover el
  inspector se corrigieron retirando esos imports; se conserva el export standalone.
- La revisión visual manual no se pudo completar: el inventario de CUA no tiene
  Chrome abierto y el acceso a pestañas no está disponible en este chat. Se generó
  `.tmp/session-broll-visual.html` desde el componente real para revisión posterior;
  usa datos ficticios y no descarga/reproduce recursos externos. SSR valida estados,
  controles, rol revisor, ausencia opcional y reproducción silenciada, no hidratación.

## Revisión adversarial del mismo agente

- Cada acceso autoriza tenant, curso, sesión y aprobación vigente, sin aceptar rutas,
  URLs de medios o componentes Academy del payload. Una colisión de UUID no obtiene
  una firma de carga si la fila no pertenece a ese contexto y archivo.
- La firma solo permite crear un objeto privado nuevo, sin sobrescritura. CONFIRM
  verifica tamaño desde Storage y Blob, formato/pistas y límites reales antes de
  habilitar reproducción. La duración se redondea a segundos enteros para respetar
  la columna existente; el límite se aplica al valor real antes de redondear.
- Una inspección usa una instantánea de fila: compare-and-set impide revivir una
  retirada concurrente. La prueba simula respuestas DB independientes, no referencias
  mutables compartidas en memoria. Cambiar materiales limpia aprobación del clip al
  validar de nuevo, sin cambiar aprobación del curso.
- La reproducción no persiste URLs firmadas; cada apertura vuelve a autorizar y a
  comprobar bucket privado. Una URL ya emitida dura hasta cinco minutos aunque se
  retire el apoyo; la UI permite cerrar y abrir para renovar. No se exponen rutas
  privadas en el listado ni se registra el token.
- Reintentos conservan UUID y hay recuperación tras recarga de reservas pendientes.
  La carga tiene timeout y cancelación al desmontar; un resultado incierto no se
  interpreta como fallo definitivo ni habilita sobrescribir el objeto.
- Se preservaron los cambios previos del recorrido y la paginación. No se editaron
  secretos, permisos ni schemas; no hubo commit, push, despliegue, SQL remoto,
  generación pagada o modificaciones del curso de staging.

## Pendiente de piloto

Después de despliegue autorizado: cargar un clip propio en una sesión aprobada,
verificar, reproducir, aprobar con revisor, recargar y retirar. Comprobar rechazo
entre organizaciones y después de cambiar materiales. Validar CORS, firma, límites
del entorno de Functions y persistencia real de Storage. Esta entrega no incluye
limpieza automática de cargas incompletas, cuotas transaccionales por sesión ni
generación con IA; los archivos retirados se conservan.

`npm run verify:pr` finalizó con código 0 y «Compuerta completada», incluyendo las
93 pruebas del dominio y los tipos del código nuevo. Se ejecutó con TEMP/TMP del
proceso bajo `.tmp/session-broll-process-temp`. `npm run docs:check` y
`npm run openspec:validate` también terminaron con código 0. `git diff --check`
detectó una línea vacía adicional al final del servicio extraído; se retiró sin
cambiar comportamiento.
