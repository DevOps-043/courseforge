## Why

La creación y la configuración de impartición usan formularios visualmente diferentes. La modalidad se elige después de crear el curso y el borrador documental vuelve a pedir título. Las rutas de admin y constructor mantienen copias divergentes.

## What Changes

- Un formulario compartido para admin y constructor, con título, descripción, público y resultados comunes.
- Selector accesible de asíncrono, síncrono e híbrido; campos específicos reutilizados en configuración posterior.
- Guardar configuración validada de impartición antes de generar o continuar un borrador/importación, sin aprobar contenido.
- Mantener identidad de organización, permisos, habilitación de sesiones y compatibilidad con cursos anteriores.
- Definir en Temario el recorrido híbrido ordenado, con tramos asíncronos y sesiones síncronas, cobertura combinada e invalidación de planes dependientes. Refrescar aprobación y explicar requisitos de agenda.
- Separar preparación asíncrona de Academy y sesiones de Hub desde Plan hasta Publicar, con proyección por IDs, huella de distribución y bloqueo de publicación híbrida mientras el receptor no preserve recorrido e identidades.

## Capabilities

### New Capabilities
- `unified-workshop-authoring`: creación común y configuración específica según modalidad.
- `hybrid-route`: autoría y persistencia del recorrido híbrido en Architect. Su publicación para navegación en Academy se mantiene como entrega posterior.

## Impact

Architect: UI de creación, inicialización de configuración y borradores documentales. Sin cambios en Hub, Learning, secretos ni SQL remoto. No se ejecuta generación pagada como verificación.
