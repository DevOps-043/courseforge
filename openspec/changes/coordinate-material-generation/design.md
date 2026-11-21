# Contexto

- Actor: autor autorizado del curso y organización activa.
- Alcance: Materiales de sesiones Hub y lecciones Academy; Agenda/Plan conservan su comportamiento.
- Base: un run con lease exclusivo y revisión de workspace en Hub; Academy guarda por lección/iteración y versión global mediante commit_material_generation.
- No objetivos: ejecutar simultáneamente dos workers sobre el mismo componente, eliminar comprobaciones de fuentes, reintentar infinitamente ni publicar.

# Decisiones

Mantener dos motores independientes y una vista coordinada. Un fallo parcial de inicio no cancela al motor que sí arrancó. Se pueden inspeccionar ambos destinos sin desmontar sus controladores. Las acciones pendientes del usuario y errores de consulta no deben ocultar el contenido confirmado.

Academy reserva una lección bajo lock de materials y después material_lessons, verifica versión y límite de iteraciones y admite hasta dos lecciones activas por curso. El claim de la tanda respeta el mismo límite. Cerrar la tanda comprueba todas las lecciones bajo el lock del padre. Cada finalización individual vuelve a despertar la cola. El reintento sin instrucciones explícitas conserva componentes válidos.

Hub conserva un solo worker por run y una cola persistida de IDs solicitados separada de units para que guardar progreso no sobrescriba solicitudes concurrentes. Cada fallo de Materiales guarda diagnóstico de unidad y permite continuar las demás; un reintento solicitado se atiende antes de la siguiente unidad normal, cuando cabe en el presupuesto. No interrumpe la llamada en curso. Las solicitudes son idempotentes mientras estén en cola y se limitan los intentos. La finalización del run revisa la cola bajo lock; si llegó una solicitud al terminar, vuelve a QUEUED y el handler la despacha. Cambios de entradas, cancelación y conflictos de persistencia detienen el run.

# Validación y recuperación

Pruebas de permisos y estados en SQL local, concurrencia e idempotencia; workers con proveedor simulado, conservación de resultados y estados parciales; UI con datos simulados sin gasto. Errores técnicos no equivalen a ausencia de fuentes. No se registran textos privados. Migración aditiva; reversión de aplicación conserva campos y no elimina contenidos.
