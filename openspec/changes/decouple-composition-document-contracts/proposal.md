# Desacoplar contratos de documento, clips y fuentes — F3.5.b

## Why
El schema del documento importa el plan de captions y el módulo que mezcla
schemas de fuentes con su lectura. Ambos módulos importan el tipo completo del
documento. F0.3 identificó esta componente; F3.5.a eliminó antes el ciclo de cues.

## What Changes
- Extraer el contrato de clip y referencias tipográficas sin modificar schemas.
- Compartir primitivas de validación entre clip y documento sin duplicarlas.
- Preservar los exports actuales mediante reexports de los mismos objetos.
- Hacer que el plan use el contrato de clip y solo la lista de clips requerida.
- Caracterizar serialización, errores y planes; verificar el grupo y suites.

## Impact
Dirección de dependencias; sin migración, cambios de formatos, defaults,
validación, hashes de documentos, planes, assets, permisos o proveedores.
