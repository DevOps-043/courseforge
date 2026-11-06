# Cierre local de fase 3 — 2026-11-06

Base `727d1338`, checkout principal inicialmente limpio. Sin subagentes, worktrees, secretos, SQL remoto, proveedores reales, publicación ni despliegue.

## Resultado

Elección de política persistida por curso, sin predeterminado documental; revisión por objetivo y tema; sugerencias léxicas no aprobadas; corrección de evidencia, contradicciones y suficiencia; aprobación por revisor con CAS. La biblioteca permite configurar antes de Base sin depender de tener un plan. La vista de Fuentes usa el recorrido documental para modos explícitos y conserva la UI anterior para cursos históricos/WEB_ONLY.

La función `sourceCoverage` comparte criterio entre UI, API y worker documental. Un manual basta si respalda todos los requisitos; mixto busca vacíos y exige revisar nuevas URLs. El modo exclusivo no crea un cliente de búsqueda ni consulta web en curación. La acción de inicio rechaza búsqueda web explícita para ese modo. El worker conserva prompts/modelo resueltos, firma y confirmación de progreso condicionada a revisión/hash/attempt. No se registran textos privados en logs.

La migración aditiva contiene RPC, historial de políticas, versiones y aprobaciones; RLS sin grants de navegador y objetos de historia sin UPDATE/DELETE para backend. Cambios de política, asociaciones y disponibilidad documental invalidan dependencias transaccionalmente; un fallo inyectado demuestra rollback de política/revisión/metadata. Las fuentes web aptas existentes pueden ser asociadas en mixto; cambios de aptitud/contenido invalidan su revisión. IDs/citas válidos no demuestran suficiencia semántica: la confirma el revisor.

Las asociaciones canónicas son referencias del conjunto inmutable en `course_source_review_versions`. La tabla de contrato F1 `course_source_assignments` no se rellena como segunda fuente; F4 debe consumir la revisión aprobada. Un registro web legado sin `lesson_id` no se convierte en evidencia general: se excluye y debe adaptarse explícitamente. Solo documentos de biblioteca pueden cubrir varias lecciones.

## Evidencia

- Suite `test:course-sources`: código 0; 39 pruebas de dominio/HTTP/worker y 13 de PostgreSQL aislado, 52 en total, sin fallos. Ver `phase-3-tests.log`.
- Suite `test:curation --workspace=apps/web`: regresión del flujo histórico, reanudaciones, cancelación y contratos. El fixture ahora devuelve ausencia explícita de configuración nueva para cursos históricos, en lugar de devolver filas de curación ante cualquier tabla desconocida.
- Worker: pruebas de cero búsqueda/cliente en exclusivo, cero búsquedas con cobertura mixta completa, búsqueda de tema faltante y rechazo de escrituras tras cancelación. No se consumió IA real.
- QA `qa:course-source-policy`: selección inicial vacía, persistencia/reapertura, propuesta sin verificar, resolución de contradicción, aprobación y rechazo de revisión obsoleta. Capturas desktop/móvil oscuro inspeccionadas; sin desbordamiento a 375px. Componentes React y CSS reales, APIs sintéticas y red externa bloqueada.
- Regresión visual `qa:course-sources`: sustitución, historial, texto escapado y conciliación siguen funcionando con el panel de política agregado.
- La respuesta de revisión se valida en cliente: un payload inválido muestra un error recuperable. La QA comprueba ese caso; el fixture de biblioteca incluye ahora el contrato de revisión completo. Las búsquedas mixtas atribuyen costos a la organización resuelta en servidor.
- Compuerta completa `verify:pr`: código 0; `phase-3-gate.log`. Tipos finales, documentación/OpenSpec y ESLint de alcance también terminaron con código 0. Se conserva baseline de lint; no se ejecutaron build/QA productiva de CI.
- `docs:audit`: código 0; se contrastaron README, contexto y contrato canónico únicamente para F3, sin recertificar el resto del producto.

## Límites e integración F4

F3 cierra configuración, revisión e invalidación; **no integra todavía los documentos en los prompts de generación**. Por ello, guardas explícitas bloquean Base/Temario/Plan/Materiales de modos documentales hasta F4, en lugar de permitir investigación web implícita o materiales sin sus fuentes. Es una restricción temporal visible. El flujo histórico sin configuración y WEB_ONLY conserva su comportamiento; no se migran ni regeneran cursos automáticamente.

En F4 sustituir estas guardas por consumo y validación del snapshot documental vigente. El adaptador de PDF manual legado y las citas de Materiales también permanecen en F4. La revisión de fuentes requiere un plan vigente, pero guardar política no requiere plan. Máximos revisables se aplican explícitamente para no congelar la UI ni recortar evidencia.

Pruebas aisladas y QA local no acreditan RLS/Storage/Auth reales desplegados. OCR, carga masiva y aceptación de producción siguen fuera de este cierre. No se certifica fidelidad factual de IA ni capacidad de miles de generaciones simultáneas. Revisión propia del mismo agente, sin afirmar independencia. OpenSpec no se archiva porque faltan F4–F6 e integración objetivo.
