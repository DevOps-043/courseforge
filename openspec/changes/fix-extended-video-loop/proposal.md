# Reproducción en bucle al extender videos

## Why
Al extender un video de dos a seis segundos, el seek manual entra a los ciclos siguientes pero la reproducción continua puede quedar buscando repetidamente el último fotograma del primer ciclo.

## What Changes
- Medir el desfase de medios en bucle como distancia circular durante reproducción.
- Evitar que el precalentamiento y la recuperación de buffering fuercen una búsqueda al final del ciclo recién completado.
- Mantener búsquedas explícitas, entrada al clip y reproducción sin bucle.
- Añadir regresión del sincronizador emitido y QA sintética de extensión en vivo y tres ciclos.

## Capabilities
### New Capabilities
- `extended-video-loop`: continuidad de reproducción de videos extendidos.

## Impact
Controlador del preview interactivo; no cambia el documento, autorización, persistencia ni HTML de render del proveedor. Sin dependencias nuevas ni migraciones.
