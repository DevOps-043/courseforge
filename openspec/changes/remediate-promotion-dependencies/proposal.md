# Corregir dependencias antes de promover staging

## Why
La auditoría de producción del PR #16 detecta dos vulnerabilidades críticas y
nueve altas. El usuario autoriza resolverlas, incluida la migración de Zod de la
API y la actualización coordinada de Remotion.

## What Changes
- Actualizar Next y Zod a versiones corregidas y resolver dependencias transitivas.
- Alinear los paquetes y los bundles nuevos de Remotion en una misma versión.
- Actualizar Netlify CLI, cuya rama 23 mantiene alertas en su árbol de herramientas.
- Verificar contratos, compilación, auditoría y CI sin omitir controles.

## Capabilities
### New Capabilities
- `promotion-dependency-security`: dependencias verificadas antes de promoción.

## Impact
Manifiestos, lockfile y generación de bundles. No cambia datos, permisos,
variables remotas, migraciones ni el bloqueo de publicación híbrida. Los bundles
históricos no se reescriben ni se certifican contra servicios de render externos.
