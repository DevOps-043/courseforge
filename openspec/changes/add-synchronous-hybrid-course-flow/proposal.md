# Autoría sincrónica e híbrida dentro del flujo existente

Estado: implementación local bajo habilitación; pendiente de piloto e integración. Fecha: 2026-10-26.

## Why

Engine organiza planes y materiales por lección Nexus. Se necesita preparar sesiones y recursos del facilitador reutilizando currículo, fuentes y producción sin añadir etapas ni aprobaciones. La generación nueva debe usar modelos configurables y prompts editables por organización.

## What Changes

- Configuración de modalidad y política de requisitos compartida por servidor, UI y jobs.
- Agenda integrada en Temario y planes por sesión dentro de Plan, con aprobación única de la etapa.
- Configuración de IA por capacidad, herencia explícita y trazabilidad fijada por ejecución.
- Curación compartida y contenido por sesión para presentación, guía y cuaderno.
- Entrega por audiencia en la etapa final y Ensamble no requerido sin audiovisual.
- Persistencia aditiva, control de revisiones y recuperación por unidad.

El [plan de implementación](../../../docs/architecture/synchronous-hybrid-course-implementation-plan.md) define entregas E0 a E7 y decisiones previas. No son pasos del producto.

## Capabilities

### New Capabilities

- `synchronous-hybrid-authoring`: autoría de sesiones, configuración de generación y entrega coordinada con Nexus.

## Impact

Dominios artifacts, syllabus, plan, curation, materials, production y publication; Configuración; estados compartidos y jobs Netlify. La migración aditiva y el código están escritos localmente, sin SQL remoto ni despliegue. Evidencia y límites en el reporte de implementación.

El [análisis](../../../docs/architecture/synchronous-hybrid-course-flow-analysis.md) conserva evidencia primaria; el [diseño](design.md) fija fronteras y alternativas. Destino inicial recomendado: entrega en Engine, pendiente de formatos y acceso. No se presupone soporte receptor de SofLIA para sesiones.

## No objetivos

Calendario, videollamada, asistencia, recepción de tareas, calificaciones, certificación del facilitador, publicación sincrónica externa y cambios incidentales de reglas Nexus. La solicitud posterior autorizó implementación y coordinación de ramas al pulsar el botón; no autoriza SQL remoto, pruebas pagadas, publicación ni despliegue.
