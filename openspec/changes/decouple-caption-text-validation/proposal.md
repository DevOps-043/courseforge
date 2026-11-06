# Desacoplar validación de texto de captions — F3.5.a

## Why
El schema de cues importa captionEmphasisIssues desde el servicio de efectos,
que depende del mismo contrato de cues directamente y por text-presentation.
F0.3 identifica esta componente de tres módulos como el primer grupo acotado.

## What Changes
- Extraer fronteras de grafemas y validación de énfasis a un módulo puro.
- Hacer que el schema importe ese módulo y conservar exports públicos del servicio.
- Caracterizar offsets UTF-16, grafemas compuestos, solapamientos e inmutabilidad.
- Comprobar captions, HyperFrames y reducción del grafo sin modificar ignores.

## Impact
Solo dependencias internas de captions. Sin cambios a schemas, persistencia,
formatos, hashes, presets, tiempos, preview/render, autoridad ni proveedores.
