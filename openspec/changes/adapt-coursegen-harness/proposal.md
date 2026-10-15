## Why

Coursegen distribuye contexto entre AGENTS.md, CLAUDE.md y prompts extensos sin
sincronización de skills ni estado de cambio estructurado. Necesita el flujo
portable ya documentado en SofLIA Hub, personalizado a sus dominios y verificadores.

## What Changes

- Convertir instrucciones por herramienta en routers hacia contexto canónico.
- Añadir skills del ciclo de desarrollo y de API/jobs, tenancy y video.
- Añadir OpenSpec, adaptadores deterministas y validadores con pruebas negativas.
- Integrar la compuerta de arnés con la verificación actual sin retirar sus pasos.
- Documentar procedencia, operación, línea base y límites.

## Capabilities

### New Capabilities
- `development-harness`: contexto, estado, skills, adaptadores y compuertas de desarrollo.

### Modified Capabilities

Ninguna capacidad runtime.

## Impact

Afecta documentación, scripts, dependencia de desarrollo y CI. No modifica
servicios del producto, migraciones, datos, secretos ni permisos runtime.
