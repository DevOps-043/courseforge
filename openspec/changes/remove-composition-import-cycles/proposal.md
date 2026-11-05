## Why
La entrega síncrona está implementada y su esquema ya fue aplicado; verify:pr de Engine se detiene en once ciclos de importación del compositor, anteriores a esa entrega. Para preparar un despliegue verificable hay que retirar las dependencias invertidas sin omitir el análisis de arquitectura ni alterar el comportamiento audiovisual.

## What Changes
- Separar validación Unicode, contratos de fuentes y planificación pura de captions de los módulos que dependen del documento completo.
- Definir el descriptor del render en una frontera de tipos independiente del supervisor y sus adaptadores.
- Llevar el tipo de autorización HTTP al contrato compartido por controlador y adaptador narrativo.
- Conservar exports públicos, mensajes, validaciones, límites, autoridad y salida del render.

## Capabilities
### New Capabilities
- `composition-import-boundaries`: dependencias acíclicas con compatibilidad funcional.
### Modified Capabilities
Ninguna capacidad de producto cambia su comportamiento.

## Impact
Módulos TypeScript del compositor y documentación/evidencia. Sin migraciones, cambios de configuración, nuevas dependencias, llamadas a proveedores, publicación ni despliegue. Se conservan las comprobaciones existentes de madge, lint y tipos.
