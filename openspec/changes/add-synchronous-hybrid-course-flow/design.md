# Diseño propuesto

## Contexto y evidencia

El [análisis](../../../docs/architecture/synchronous-hybrid-course-flow-analysis.md) contiene la evidencia primaria. El [plan](../../../docs/architecture/synchronous-hybrid-course-implementation-plan.md) desarrolla las entregas; la [guía operativa](../../../docs/operations/synchronous-hybrid-courses.md) y el reporte de implementación describen el código local bajo habilitación, sin despliegue.

## Decisiones

1. Conservar las etapas; agenda en Temario, sesiones en Plan y entrega en la etapa final. Sin nueva aprobación obligatoria.
2. Sesiones con identidad propia y cobertura de lecciones, sin introducirlas como lecciones ficticias ni cambiar el contrato Nexus de forma incompatible.
3. Configuración compartida de modalidad y requisitos aplicada en servidor y UI. «No requerido» no equivale a ejecución completada.
4. Un contenido estructurado por sesión alimenta las salidas. Producción formatea y sintetiza lo necesario; no redefine actividades aprobadas.
5. Reutilizar curación con entradas de necesidades sincrónicas y validación de suficiencia, no solo coincidencia temática.
6. Incorporar capacidades IA de agenda, plan y materiales sincrónicos con herencia explícita de las etapas existentes; reutilizar curación y slides. Registrar catálogo, permisos y precedencia antes de habilitar generación.
7. Fijar entradas y configuración por ejecución, guardar progreso por unidad y usar control atómico de versión en resultados y aprobación. Aprobación de Plan incluye la agenda de entrada.
8. Persistencia aditiva y entrega inicial en Engine: presentación web, guía/cuaderno HTML imprimibles y usuarios internos, confirmados por el usuario.

## Alternativas descartadas

- Pipeline separado: duplica navegación, fuentes y revisión.
- Sesiones guardadas como lecciones: rompe identidad curricular y consumidores existentes.
- Prompts como única modificación: no resuelve contratos, permisos, estados ni recuperación.
- Tres generaciones completas para los entregables: multiplica costo y contradicciones.
- Modelo independiente por cada sección: complejidad sin beneficio demostrado; usar capacidades y prompts modulares.
- Un job monolítico para todo el curso: reintentos costosos y mayor riesgo de timeout.
- Publicar sesiones mediante payload Nexus sin acuerdo receptor: soporte no demostrado.

## Datos, operaciones y consistencia

La migración agrega course_delivery_workspaces, course_delivery_versions y course_delivery_runs. Se eligió un agregado JSON acotado por curso (24 sesiones, 300 lecciones, 8 MiB), con progreso de unidades y revisiones inmutables, evitando introducir entidades curriculares relacionales ficticias. Las referencias a lecciones se validan contra el syllabus y la aprobación compara sus entradas bajo lock breve. No hay locks durante generación. La agenda conserva tiempo disponible y el plan los bloques detallados.

El contexto de organización se deriva del servidor. Una referencia de sesión, lección o fuente debe pertenecer al curso y organización autorizados. Revisar RLS y acceso service-role explícito; no confiar solo en filtros de UI.

La configuración IA se selecciona por capacidad y organización/global, con herencia declarada solo si falta configuración propia. Error de consulta no equivale a ausencia. Conservar instantánea protegida o referencia inmutable reconstructible, hash, origen, parámetros y modelo realmente utilizado. Cambio de configuración no altera una ejecución activa ni contenido aprobado.

Las salidas de participante se proyectan en servidor. Las exportaciones usan revisiones compatibles y un manifiesto verificable. No insertar respuestas privadas en HTML o archivos destinados al participante.

## Compatibilidad, habilitación y rollback

Cursos sin agregado conservan Nexus. SYNCHRONOUS_COURSES_ENABLED y su lista opcional de organizaciones se comprueban en servidor y UI. No degradar cursos sincrónicos a Nexus al deshabilitar. Falta el piloto autorizado del flujo con sesiones reales.

Rollback de aplicación: detener nuevas reservas/generaciones, ocultar creación nueva y preservar lectura compatible, revisiones y archivos. Rechazar resultados tardíos de ejecuciones canceladas. No borrar esquema ni configuración como reversión inicial.

## Decisiones pendientes

D1/D2: el usuario confirmó presentación web, documentos imprimibles y acceso interno. D3: duración editable por sesión con límites centralizados. D4: se conservan reglas Nexus. D5: entrega desde Engine; publicación de sesiones en SofLIA fuera de alcance. D6: capacidades propias con herencia, prompts editables por organización y sin editor de instrucciones temporales en esta versión. El usuario autorizó la coordinación de las dos ramas mediante un botón explícito; las pruebas no usan proveedores reales.

## Validación

Requisitos observables en la [especificación](specs/synchronous-hybrid-authoring/spec.md); seguimiento en [tareas](tasks.md). Se ejecutaron pruebas de dominio, worker simulado, PostgreSQL local en memoria y QA visual de exportaciones. Las evidencias y límites están en [implementación](reports/implementation.md); el piloto con Auth Bridge/proveedores reales queda pendiente de autorización.
