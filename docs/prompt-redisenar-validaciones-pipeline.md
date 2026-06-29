# Prompt: Redisenar validaciones del pipeline de Courseforge

Actua como Staff Engineer / Principal Engineer siguiendo estrictamente `prompt_maestro.md` como fuente de verdad tecnica, arquitectonica y de calidad.

Dentro de Courseforge existe un pipeline paso a paso para crear talleres/cursos. Este pipeline esta dividido en fases sucesivas, donde cada fase debe cumplir ciertos requisitos antes de permitir avanzar a la siguiente. Actualmente, las validaciones que controlan el avance entre fases ya no funcionan de forma confiable: algunas permiten avanzar cuando no deberian, otras bloquean indebidamente el flujo, y otras parecen estar acopladas a logica antigua o incompleta.

Necesito que hagas una revision profunda y redisenio completo del sistema de validaciones entre fases.

## Objetivo principal

Rehacer desde cero las validaciones de avance entre fases del pipeline, eliminando la logica de validacion actual cuando corresponda, sin intentar parcharla ni ajustarla superficialmente.

## Alcance esperado

1. Analizar el pipeline completo de creacion de cursos y entender los requisitos reales de cada fase.
2. Identificar que condiciones minimas debe cumplir cada fase para permitir avanzar a la siguiente.
3. Definir contratos explicitos de validacion por fase, con entradas, salidas, estados permitidos, errores esperados y criterios de aprobacion.
4. Separar claramente la logica de validacion de la UI, handlers, acciones, API routes o componentes visuales.
5. Diseniar validaciones mantenibles, testeables, modulares y faciles de extender.
6. Eliminar o reemplazar las validaciones actuales que esten rotas, duplicadas, ambiguas, acopladas o inconsistentes.
7. Evitar cambios innecesarios fuera del flujo de validacion.
8. Garantizar que el nuevo sistema no rompa estados existentes, aprobaciones manuales, QA, roles, multi-tenancy ni publicacion a Soflia.

## Fases a considerar

- Fase 1: BASE / Idea Central
- Fase 2: SYLLABUS
- Fase 3: PLAN INSTRUCCIONAL
- Fase 4: CURACION
- Fase 5: MATERIALES
- Fase 6: PRODUCCION VISUAL / Slides / Video
- Publicacion a Soflia, si depende directa o indirectamente del estado del pipeline

## Criterios tecnicos obligatorios

- No reparar validaciones antiguas si su disenio ya no es confiable.
- No duplicar logica de validacion entre frontend y backend.
- No dejar reglas criticas solamente en la UI.
- No permitir avance de fase sin validacion server-side.
- No mezclar validacion de negocio con renderizado visual.
- Usar nombres claros y contratos explicitos.
- Considerar multi-tenancy mediante `organization_id` donde aplique.
- Respetar Auth Bridge y el uso de `profiles` en lugar de referencias directas a `auth.users`.
- Mantener compatibilidad razonable con datos existentes.
- Registrar errores de validacion de forma util, sin exponer informacion sensible.
- Anadir pruebas automatizadas donde exista riesgo de regresion.

## Antes de implementar, entrega

1. Entendimiento del objetivo.
2. Diagnostico tecnico del flujo actual.
3. Mapa de validaciones actuales detectadas.
4. Propuesta de nuevo modelo de validacion por fase.
5. Riesgos de migracion o compatibilidad.
6. Plan de implementacion por pasos.

Luego implementa el redisenio con el menor radio de impacto posible.

## La implementacion debe incluir, cuando aplique

- Servicios o modulos dedicados de validacion por fase.
- Tipos o schemas claros para los resultados de validacion.
- Mensajes de error accionables.
- Estados permitidos y transiciones validas.
- Pruebas unitarias para cada fase.
- Pruebas de integracion o flujo para los casos criticos.
- Actualizacion minima de la UI para consumir el nuevo contrato, sin duplicar reglas.
- Documentacion breve del nuevo contrato de validacion.

## Casos que deben quedar cubiertos

- Una fase incompleta no debe permitir avanzar.
- Una fase aprobada correctamente debe permitir avanzar.
- Un estado invalido debe devolver un error claro.
- Un usuario sin permisos no debe poder forzar avance.
- Un artefacto de otra organizacion no debe poder validarse o avanzar.
- Datos parciales, nulos o legacy deben manejarse de forma explicita.
- Las aprobaciones manuales de QA deben respetarse cuando la fase lo requiera.
- Los background jobs no deben dejar el pipeline en estados inconsistentes.

## Formato de respuesta requerido

1. Entendimiento del objetivo
2. Diagnostico tecnico
3. Plan de implementacion
4. Implementacion propuesta
5. Riesgos y validaciones
6. Mejoras adicionales recomendadas

No cierres la tarea diciendo solamente "ya quedo". Explica que se cambio, que no se toco, que riesgos quedan y que pruebas se ejecutaron.

---

## Version corta para usar directo

Rehacer completamente el sistema de validaciones que controla el avance entre fases del pipeline de creacion de cursos en Courseforge, usando `prompt_maestro.md` como fuente de verdad. No quiero parches sobre las validaciones actuales: primero analiza el flujo real de cada fase, define contratos claros de validacion y luego reemplaza la logica existente por un disenio modular, server-side, testeable y mantenible.

Debes cubrir BASE, SYLLABUS, PLAN INSTRUCCIONAL, CURACION, MATERIALES, PRODUCCION VISUAL y cualquier dependencia con publicacion a Soflia. Las validaciones deben respetar estados, QA manual, permisos, multi-tenancy con `organization_id`, Auth Bridge con `profiles`, datos legacy y background jobs.

Antes de implementar, entrega diagnostico, mapa de validaciones actuales, propuesta de nuevo modelo y plan por pasos. Luego implementa con bajo radio de impacto, pruebas automatizadas y documentacion breve del contrato nuevo.
