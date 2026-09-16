Actúa como Staff Engineer / Principal Engineer y Software Architect. Usa como fuente de verdad obligatoria `docs/prompt_maestro.md` y el contexto real del repositorio antes de emitir conclusiones.

## Objetivo de esta fase

Realizar exclusivamente el levantamiento y análisis técnico-funcional necesario para definir un sistema de plantillas/presets dinámicos de edición de video asistido por IA.

No implementes código, no modifiques archivos y no elabores todavía el plan de implementación definitivo. Esta fase debe producir la información y las decisiones necesarias para poder crear ese plan con bajo riesgo.

## Contexto del problema

Actualmente el sistema permite:

- Edición manual de videos.
- Ediciones puntuales asistidas por un agente de IA.

Sin embargo, el flujo principal esperado no consiste en editar un video completo desde cero, ni manualmente ni con IA. El producto debe permitir crear, reutilizar y adaptar plantillas o presets de edición.

Una plantilla debe poder crearse de dos formas:

1. Mediante instrucciones del usuario a la IA sobre la estructura visual y narrativa deseada.
2. A partir de una edición manual existente, donde la IA detecte su patrón y lo transforme en un preset reutilizable.

Ejemplo: una edición manual contiene un avatar, 5 diapositivas y B-rolls colocados bajo determinadas reglas de secuencia, duración, transiciones y composición. La IA debe extraer un patrón parametrizable para que el mismo preset funcione dinámicamente con 15 diapositivas —o con otra cantidad de assets— preservando la intención visual original.

Incluye propuestas de plantillas iniciales que el sistema pueda ofrecer como ejemplos, siempre que sean coherentes con la arquitectura y el producto existente.

También debe analizarse la compatibilidad con snapshots/versiones de edición: al aplicar una plantilla sobre una edición que tiene un snapshot anterior, el usuario debe poder recuperar su estado previo completo, sin perder cambios manuales ni activos asociados.

## Alcance de investigación

Inspecciona el repositorio y documenta:

- Arquitectura actual del editor de video, timeline, assets, composiciones, IA y persistencia.
- Modelo actual de snapshots, versionado, historial, undo/redo y restauración, si existe.
- Entidades, APIs, servicios, eventos, colas y almacenamiento implicados.
- Formatos o contratos actuales para assets: avatar, diapositivas, B-roll, audio, subtítulos, transiciones y metadatos.
- Límites técnicos actuales que afectarían presets dinámicos.
- Dependencias o integraciones existentes relevantes.
- Riesgos de compatibilidad hacia atrás, concurrencia, integridad de datos y recuperación ante fallos.
- Puntos donde la IA debe inferir patrones y puntos donde debe operar con reglas deterministas.

## Preguntas que debes responder

1. ¿Cuál es el modelo de dominio mínimo para representar una plantilla dinámica?
2. ¿Qué partes de una edición deben convertirse en variables, reglas, slots, restricciones o decisiones explícitas?
3. ¿Cómo se detectaría y validaría un patrón a partir de una edición manual?
4. ¿Cómo se adaptaría una plantilla ante cantidades variables de assets sin generar timelines inválidos?
5. ¿Qué estrategia de snapshots/versionado permite aplicar, previsualizar, confirmar, revertir y recuperar una plantilla con seguridad?
6. ¿Qué conflictos pueden aparecer entre cambios manuales, presets aplicados y restauraciones?
7. ¿Qué operaciones deben ser transaccionales, idempotentes o asíncronas?
8. ¿Qué controles de autorización, auditoría, validación y observabilidad serán necesarios?
9. ¿Qué decisiones requieren definición de producto antes de implementar?
10. ¿Qué alternativas arquitectónicas existen y cuál recomendarías preliminarmente, con sus trade-offs?

## Entregable requerido

Entrega un documento de descubrimiento, en español, con estas secciones:

1. Entendimiento del caso de uso y supuestos explícitos.
2. Inventario de componentes existentes relevantes, incluyendo archivos y flujos encontrados.
3. Modelo conceptual propuesto para presets dinámicos.
4. Flujo de creación de presets:
   - desde instrucciones;
   - desde una edición manual.
5. Flujo de aplicación, previsualización, confirmación, rollback y restauración mediante snapshots.
6. Casos límite, conflictos y riesgos técnicos.
7. Requisitos funcionales y no funcionales.
8. Preguntas abiertas priorizadas:
   - bloqueantes;
   - importantes;
   - deseables.
9. Recomendación arquitectónica preliminar, sin implementar.
10. Criterios de aceptación y pruebas que deberá cubrir el futuro plan.

## Reglas de trabajo

- Distingue con claridad entre hechos observados en el repositorio, inferencias y decisiones pendientes.
- No inventes detalles del sistema: si falta información, regístrala como pregunta abierta.
- Prioriza compatibilidad hacia atrás, reversibilidad, integridad de datos, seguridad, mantenibilidad y trazabilidad.
- Considera que aplicar un preset debe ser no destructivo hasta que el usuario lo confirme.
- Todo cambio de edición debe poder auditarse y, cuando corresponda, revertirse.
- Detente al completar el documento de descubrimiento. El plan de implementación se elaborará en una fase posterior.