# ADR: documento de composición como fuente única de motion

## Estado

Aceptado — 2026-08-15.

## Contexto

Courseforge persiste cada edición como una versión inmutable de `CompositionEditorDocument` en Supabase. HyperFrames Studio puede editar animaciones GSAP, pero su implementación completa asume un proyecto respaldado por archivos. Mantener JSONB y HTML/JavaScript editable como fuentes paralelas produciría conflictos, pérdida de cambios y una ruta de despliegue incompatible con el entorno serverless.

## Decisión

`courseforge-composition-v2` es la única fuente editable. Motion se almacena como datos estructurados dentro de `document.motion`; el HTML y el timeline GSAP siempre se compilan desde ese documento y nunca se vuelven a importar como estado canónico.

- Se leen documentos V1 y V2.
- Toda nueva modificación se escribe como V2.
- El historial V1 no se reescribe.
- Las operaciones manuales y del agente usan el mismo esquema validado.
- No se aceptan selectores, scripts, callbacks ni expresiones arbitrarias.
- La edición avanzada de HyperFrames deberá integrarse como componente controlado mediante un adaptador de datos, no mediante `StudioApp` y su filesystem.

## Consecuencias

El preview y el render son reproducibles a partir de una versión y hash. La integración avanzada exige mapear controles de HyperFrames al contrato Motion, pero evita dos sistemas de persistencia y permite desplegar presets antes del editor completo.

## Rollback

La UI de motion puede ocultarse sin eliminar `document.motion`. El lector y compilador V2 deben mantenerse desplegados después de que exista el primer documento V2.
