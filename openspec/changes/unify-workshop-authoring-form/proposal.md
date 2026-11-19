## Why

La creación y la configuración de impartición usan formularios visualmente diferentes. La modalidad se elige después de crear el curso y el borrador documental vuelve a pedir título. Las rutas de admin y constructor mantienen copias divergentes.

## What Changes

- Un formulario compartido para admin y constructor, con título, descripción, público y resultados comunes.
- Selector accesible de asíncrono, síncrono e híbrido; campos específicos reutilizados en configuración posterior.
- Guardar configuración validada de impartición antes de generar o continuar un borrador/importación, sin aprobar contenido.
- Mantener identidad de organización, permisos, habilitación de sesiones y compatibilidad con cursos anteriores.

## Capabilities

### New Capabilities
- `unified-workshop-authoring`: creación común y configuración específica según modalidad.

## Impact

Architect: UI de creación, inicialización de configuración y borradores documentales. Sin cambios en Hub, Learning, secretos ni SQL remoto. No se ejecuta generación pagada como verificación.
