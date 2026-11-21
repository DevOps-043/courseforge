# Análisis y ejecución de Materiales

Fecha: 21 de noviembre de 2026. Alcance: código local de Architect, sin despliegue ni generación pagada.

## Ruta inspeccionada

1. `ArtifactStageContent` monta Materiales y sus motores. `HybridMaterialsWorkspace` coordina la intención de inicio; cada motor conserva sus acciones y consultas.
2. Academy: `useMaterials` → `materials.actions` → dispatcher firmado → `materials-generation-background` → `generateLessonMaterials` → generación estándar/video → validación de contrato → comprobación de fuentes por componente → `commit_material_generation` → siguiente lección → reconciliación y QA.
3. Hub: comando autorizado → snapshot inmutable/reserva de run → worker bajo lease → lectura de entradas y revisión → generación de sesión → validación → comprobación de fuentes → commit transaccional → siguiente sesión/reintento → cierre de run.
4. Los consumidores de entrega y QA siguen exigiendo contenido vigente. Generado no significa aprobado ni publicado.

## Hallazgos comprobados

- Hub detenía el run al primer fallo y solo permitía reanudar cuando terminaba la llamada activa. Ahora registra el fallo por sesión y continúa ante errores de contenido, modelo o auditoría; los errores de entradas o persistencia detienen el run.
- Academy ya permitía solicitudes individuales en servidor, pero no reservaba contra el estado del padre en la misma transacción. La decisión de cerrar la tanda leía lecciones y actualizaba el padre por separado: un reintento concurrente podía quedar detrás de un cierre prematuro.
- Los fallos de un worker dirigido y su callback local podían marcar el padre como fallido aunque otros workers siguieran activos. Ahora el fallo dirigido se aplica a su lección y despierta la cola; no marca el padre indiscriminadamente.
- La finalización de una lección dirigida no despertaba la cola: si era la última activa, la conciliación podía quedar sin disparador.
- La corrección de una lección sin selección podía regenerar sus componentes válidos. La acción «Reintentar pendientes» usa ahora la selección de componentes faltantes/inválidos y la vigencia de sus recibos.
- Los errores de lectura, acción y ejecución tenían presentación global que podía ocultar resultados. Se separa el error de acción de los datos y se descartan consultas fuera de orden.
- El auditor convertía fallos técnicos en un mensaje de presupuesto de tiempo. Conserva ahora una categoría segura del fallo real.
- El manejador común y el resumen síncrono todavía agrupaban los cuatro rechazos de citas/contenido. La corrección posterior conserva `UNSUPPORTED_OUTPUT`, `SOURCE_NOT_IN_CONTEXT`, `QUOTE_NOT_IN_SOURCE` y `CLAIM_NOT_IN_OUTPUT` desde el auditor hasta el mensaje final. Los dos flujos comparten un catálogo de texto fijo; no se publican las citas ni la explicación libre del modelo.
- Hub marcaba `ready` en memoria antes de confirmar el commit. Ahora solo lo confirma tras recibir una revisión válida.

## Matriz de errores y recuperación

| Etapa | Posibles errores detectables | Comportamiento y recuperación |
|---|---|---|
| Acceso | Sesión ausente, curso ajeno, organización distinta, rol sin permiso | Acciones y API autorizan antes del acceso privilegiado. No se inicia IA. |
| Preparación | Plan/temario/fuentes no aprobados, recorrido incompatible, contexto excesivo, falta de migración | Rechazo previo o diagnóstico de preparación. Actualizar entradas o aplicar la migración correspondiente. |
| Reserva | Versión cambiada, solicitud repetida, lección activa, capacidad o iteraciones agotadas | CAS/locks; no duplicar worker. Academy admite dos lecciones activas; Hub un worker por run y cola prioritaria. |
| Despacho | Firma, indisponibilidad del worker o respuesta incierta | Registrar el fallo de alcance correcto y consultar estado. Una aceptación HTTP no acredita éxito de contenido. |
| Generación | Timeout, cuota/facturación, credenciales/modelo, caída del proveedor | Manejador común `material-generation-error.ts`: código, etapa, acción y posibilidad de reintento; nunca cuerpos privados del proveedor. |
| Contrato | JSON/esquema inválido, IDs o referencias incoherentes, tiempos/objetivos incorrectos | No aprobar contenido inválido. Conservar unidades válidas y corregir solo el alcance afectado. |
| Video | Duración fuera de contrato, narración excesiva, storyboard inválido o contrato ausente | Mantener validadores y reintentos acotados del generador existente. No confundir script/storyboard con render final. |
| Respaldo | Contenido no sustentado, fuente ajena, cita no literal, afirmación ausente, proveedor de auditoría indisponible | Distinguir rechazo de contenido de fallo técnico. No crear recibo ni guardar como válido sin comprobación. |
| Vigencia | Snapshot o recorrido cambiado, edición concurrente, cancelación, lease vencido | Detener/rechazar commits obsoletos. Actualizar y reconciliar antes de generar de nuevo. |
| Guardado | RPC falla, revisión ausente, versión/iteración sustituidas, resultado incierto | No declarar ready antes de confirmar. Consultar estado antes de repetir generación. |
| Cierre/QA | Unidades pendientes o activas, reintento recibido al finalizar | Reconciliar bajo lock. No pasar a QA mientras haya pendientes/activos. La aprobación conjunta conserva sus controles. |
| Consulta/UI | Red o consulta fallida, respuestas fuera de orden, error parcial de inicio | Conservar resultados conocidos y el otro motor. Ofrecer consulta y controles propios del destino. |

La matriz cubre las fronteras inspeccionadas, no garantiza anticipar todos los fallos de proveedores, infraestructura o consumidores externos.

## Semántica del reintento

- Unidad síncrona: sesión. Unidad de ejecución asíncrona: lección; dentro de ella se conservan/reintentan componentes por tipo.
- Hub no interrumpe la llamada actual para atender un reintento. Lo prioriza antes de la siguiente sesión normal. Una solicitud repetida mientras está en cola no añade otra entrada.
- Academy permite que una lección fallida se reintente mientras otra sigue activa. Si hay dos activas, informa capacidad ocupada. No se añade concurrencia sin límite.
- Esta entrega no permite lanzar otro worker sobre un componente de una lección que todavía está ejecutándose. Primero debe liberarse la reserva de esa lección. Sí elimina la espera hasta terminar las demás lecciones del curso.
- Los límites existentes de iteraciones se conservan. Hub admite cuatro intentos por unidad y ejecución; los presupuestos globales pueden pausar una tanda antes de completarla.
- Reanudar ejecuciones históricas conserva su snapshot. Los mensajes genéricos antiguos no permiten reconstruir retrospectivamente el motivo del proveedor.

## Aplicación y reversión

Migración de Architect: `supabase/migrations/20261121010000_coordinated_material_retries.sql`. Precondiciones: migraciones previas de pipeline y course-delivery, tablas y roles existentes. Añade `retry_units` y funciones de reserva, consumo y finalización. RPC privadas a `service_role`; las acciones validan identidad/tenant antes de llamarlas. Los locks siguen padre→lección y workspace→run. No cambia RLS ni borra datos.

Aplicar antes de ejecutar el código nuevo. El DDL puede esperar locks sobre `course_delivery_runs`; coordinar la aplicación sin workers antiguos activos. No mezclar workers de ambas versiones durante el cambio: los anteriores no conocen la cola de reintentos. No se ejecutó SQL remoto desde esta tarea.

Para reversión, detener nuevas generaciones, dejar terminar/cancelar workers y desplegar la versión anterior. Conservar la columna y funciones nuevas hasta conciliar runs pendientes. No borrar materiales ni bajar iteraciones. El cambio no modifica el contrato de transporte a Academy o Hub.

## Límites pendientes

- La migración y el piloto con proveedores reales quedan pendientes de aplicación/autorización; las pruebas usan PostgreSQL local y motores simulados.
- Las pruebas SQL comprueban estados e intercalados representativos en PGlite, no son una prueba de carga concurrente sobre la instancia desplegada.
- Una caída completa del proceso o un despacho perdido todavía dependen de recuperación de reservas/reanudación existentes; esta entrega no añade un reconciliador programado externo.
- En Academy, generación y auditorías secuenciales comparten el presupuesto existente de doce minutos por lección. Una generación larga puede dejar poco tiempo para comprobar los últimos componentes: ahora se identifica como fallo técnico de respaldo. Esta entrega no divide una lección en jobs independientes por componente ni garantiza completar todos sus componentes en una sola invocación.
- Se conservan los controles y contratos audiovisuales y de publicación anteriores; no se generan renders cloud ni archivos finales como prueba.
