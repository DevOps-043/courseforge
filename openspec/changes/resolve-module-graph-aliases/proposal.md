# Resolver alias del grafo y rechazar referencias desconocidas — F3.5.e

## Why
Aunque ya no hay ciclos observados, el comando Madge conserva 582 avisos. F0.3
demostró que reconvierte compilerOptions parseados y pierde pathsBasePath;
ignora muchas aristas que TypeScript sí resuelve. Un resultado verde no basta.

## What Changes
- Conservar opciones parseadas y su base absoluta mediante la API de Madge.
- Mantener entradas, extensiones y análisis de tipos del gate.
- Rechazar referencias no resueltas salvo casos de bundler demostrados localmente.
- Añadir canarios reales de alias, ciclos de tipos e imports inexistentes al arnés.
- Conservar grafo y metadatos de versiones/configuración en un reporte local.

## Impact
Gate de arquitectura más completo y estricto. Sin cambios de producto,
dependencias instaladas, tsconfig web, schemas o exclusiones para ocultar ciclos.
