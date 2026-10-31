# Más espacio para el monitor y zoom ajustable

## Why
El monitor queda pequeño con biblioteca/inspector abiertos. El marco tiene un tope de 58rem, la timeline reserva 12rem y el zoom sólo admite 75–175%.

## What Changes
- Zoom 25–400%, controles finos, presets y ajuste completo al 100%.
- Más espacio vertical inicial y menor ancho reservado a laterales.
- Ampliar monitor dentro del editor ocultando temporalmente laterales, con restauración de distribución y pantalla completa independiente.
- Marco usa todo el stage y mantiene fit/áreas seguras coherentes.

## Capabilities
### New Capabilities
- `monitor-space-zoom`: navegación y distribución del monitor.

## Impact
UI, geometría del preview y protocolo del iframe. No cambia layout/documento, render final, assets ni permisos.
