# Clasificar el grafo de módulos — F0.3

## Why
Los once ciclos bloquean verify:pr. El conteo de advertencias pasó de 577 en
la auditoría a 582; aún no distingue imports borrados por TypeScript de los
conservados en JavaScript. Corregir sin ese inventario aumenta el radio de impacto.

## What Changes
- Capturar el grafo con las mismas entradas, extensiones y tsconfig del gate.
- Clasificar aristas de ciclos mediante AST y emisión TypeScript aislada.
- Inventariar advertencias y consumidores y ordenar grupos para F3.5.
- Conservar comando, versiones, HEAD, hashes y límites de interpretación.

## Impact
Solo herramienta diagnóstica y evidencia; sin modificar producto, ignores,
configuración del gate ni permisos. F0.3 no cierra TD-12.
