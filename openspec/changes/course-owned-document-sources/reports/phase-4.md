# Fase 4 — integración de generación documental

Fecha: 2026-11-06. Base: `7a8879c8`, checkout principal inicialmente limpio. F4 implementada y verificada localmente. Sin subagentes, worktrees, secretos, SQL remoto, proveedores pagados, publicación ni despliegue.

## Objetivo y diagnóstico

F3 dejaba configuradas y revisadas las fuentes, pero bloqueaba generación documental. Base y Temario investigaban en web; Materiales recuperaba extractos de curación y aplicaba cuotas web. Además del contexto faltaban comprobaciones del contenido exacto, reanudaciones con versiones vigentes y protección frente a resultados tardíos de producción/publicación.

## Implementación

- Resolver documental compartido, presupuestos sin recortes y snapshots inmutables ligados a run/iteración/lección/unidad. La estructura usa selección READY; Materiales usa asociaciones de la revisión aprobada. Esta separación evita exigir un plan antes de generar Base.
- Base, Temario local/background/importado, Plan, componentes estándar y videos reciben evidencia completa. Los modos documentales omiten research inicial; el modo mixto obtiene web en curación de vacíos. Principal, modelos alternativos y correcciones conservan contexto y herramientas restringidas.
- Guion/storyboard y regeneraciones parciales conservan el mismo snapshot. Las llamadas comprueban vigencia y el tiempo restante. Un fallo de respaldo deja pendiente el componente y conserva otros resultados válidos.
- Comprobación semántica sin herramientas; validación de referencias, citas literales y afirmaciones presentes en la salida. El verificador puede usar un modelo alternativo ante errores técnicos, pero no ante una decisión desfavorable. Los recibos SQL vinculan el hash del JSON exacto, curso, etapa, lección y contexto vigente.
- Sesiones sincrónicas/híbridas consumen las mismas fuentes, con procedencia curricular y recibos por unidad. La aprobación no acepta una edición sin respaldo; los borradores de sesión se conservan.
- QA comprueba IDs de componentes con recibos actuales. Producción fija revisión, fingerprint y hash del componente en metadata del job; callbacks obsoletos no promueven assets. El outbox exige la versión documental encolada y rechaza referencias privadas antes de entregar.
- Importación histórica explícita: PDF privado del namespace del curso, o TXT derivado del texto del temario cuando no existe original. Mantiene procedencia y diagnósticos; requiere procesamiento y revisión en biblioteca.

Inventario de consumidores y contratos: [fuente canónica](../../../../docs/architecture/course-owned-document-sources.md). Migración: `supabase/migrations/20261106040000_course_source_generation.sql`. Incluye RLS/grants de backend, recibos inmutables, snapshots idempotentes, guardas de resultados exactos y reconciliación de estructura aún vigente. No crea una segunda verdad de asociaciones.

## Verificación

- Suite de fuentes: código 0; **51 pruebas de dominio/HTTP/workers y 20 PostgreSQL aisladas, 71 en total**, sin fallos ni omitidas; salida en `phase-4-sources.log`. Incluye inputs previos frente a un fingerprint nuevo, recuperación idempotente de snapshot, rechazo de otra organización, modificación de salida después del recibo, estructura sucia, citas inventadas, reubicación/eliminación de URL y callbacks antiguos. La aprobación documental propaga también la versión del temario importado que exige el consumidor histórico de Materiales. La edición histórica de Base usa recurso autorizado y whitelist de campos, conservando explícitamente la organización en la escritura. El fallo inicial de Base puede terminar sin recibo, conservando su contenido, pero esa excepción no permite modificarlo ni aprobarlo.
- Regresiones aprobadas: Materiales y recuperación, importación de temario (39 pruebas), duración/proveedores del temario, curación, sesiones (25 pruebas), HyperFrames y Remotion, incluidos reintentos de jobs históricos. Comandos, códigos y resúmenes en `phase-4-regressions.md`.
- QA real de React/CSS con APIs sintéticas, navegador headless y red externa bloqueada: política sin preselección, revisión/aprobación, recarga, CAS obsoleto, biblioteca, texto escapado, sustitución, historial, importación histórica, conciliación y purga explícita. Escritorio y móvil oscuro de 375 px sin desbordamiento. Capturas en `qa-phase4-policy/` y `qa-phase4-library/`.
- `verify:pr`: código 0, incluyendo arnés y verificaciones de producto; `phase-4-gate.log`. Después del refuerzo final de pertenencia organizacional y cambios de URL se repitieron la suite completa de fuentes, tipado y lint: código 0. Lint conserva 0 errores y ninguna diferencia con el baseline de 570 warnings. Documentación y OpenSpec estrictos aprobados.
- Auditoría documental ejecutada; contraste limitado a F4. Las afirmaciones nuevas de README/contexto se apoyan en rutas, servicios, migración y pruebas locales; no se recertifica todo el producto.

## Revisión adversarial y límites

Revisión del mismo agente, sin afirmar independencia. Se corrigieron lecturas de política que podían crear ciclos, la selección de evidencia por lección, la conservación de snapshots al reintentar, la validación literal repetida en PostgreSQL y la vinculación de callbacks a contenido/revisión. La política se coteja con la organización actual del curso antes de leer evidencia; snapshots también la verifican en SQL. Se cotejan los inputs ya cargados con el currículo vigente para no fijar datos anteriores bajo un fingerprint nuevo. Producción/publicación rechazan estructura sucia o con recibos obsoletos. Reasignar/eliminar una URL invalida revisión y contexto. El adaptador rechaza traversal literal o codificado. Los fixtures históricos declaran ausencia de configuración documental; no simulan aptitud de documentos ni alteran el baseline para pasar.

La comprobación semántica usa IA: no garantiza fidelidad factual absoluta ni sustituye a la revisión humana. Las pruebas de proveedores usan fronteras simuladas; no se ha generado un curso ni render pagado, aplicado RLS/Storage remoto o probado cookies reales. No se ejecutó build/QA productiva de CI ni prueba de carga. Los contratos de documento/motion/ZIP y proveedores se conservan.

La importación de temario histórico conserva un derivado TXT, no recupera un binario que nunca se almacenó. Un PDF histórico mayor de 15 MB o sin original requiere volver a cargar/dividir. Las cuotas y presupuestos bloquean excesos de forma visible. No se promete ejecución exactamente una vez de servicios externos; continúan los controles y la recuperación de aceptación incierta existentes.

Una edición directa no hereda el recibo del contenido original. En modos documentales se utiliza Regenerar con retroalimentación para volver a comprobar la salida; la edición de Base lo explica en la respuesta visible. No se añade una llamada pagada oculta a Guardar. Los cursos históricos mantienen su edición mediante el cliente autorizado de servidor, en lugar de depender de grants documentales al cliente de sesión.

## Activación y reversión

F5 mantiene la matriz ampliada de seguridad, formatos, concurrencia, rendimiento y regresión. F6 debe aplicar las cinco migraciones en orden, desplegar aplicación/jobs coordinadamente y ejecutar un piloto autorizado con proveedor real. El nuevo fingerprint exige revisar aprobaciones documentales anteriores; no hay backfill de suficiencia ni regeneración pagada automática.

Para contener una regresión, bloquear nuevas generaciones documentales mediante las guardas temporales de F3 y conservar snapshots, recibos y originales. No borrar historia ni habilitar el motor web para cursos exclusivos como fallback. SQL remoto, despliegue y aceptación operativa requieren su autorización correspondiente. OpenSpec permanece abierto para F5/F6 e integración objetivo.
