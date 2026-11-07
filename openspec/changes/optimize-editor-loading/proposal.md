# Optimizar la apertura de artefactos y lecciones

## Why
El editor importa todas las etapas al abrir un artefacto. La preparación de cada
lección encadena sincronización, biblioteca, composición y borrador; además,
comprueba cada archivo en registro y Storage secuencialmente.

## What Changes
- Dividir los módulos de las etapas y descargarlos cuando se usan.
- Preparar el contenedor de composición mientras se sincronizan los medios.
- Tras sincronizar, cargar biblioteca y borrador en paralelo.
- Solapar comprobaciones de metadatos con concurrencia acotada, conservando
  descargas y escrituras secuenciales y la recuperación de registros duplicados.

## Capabilities
### New Capabilities
- `editor-loading`: apertura con menos dependencias secuenciales.

## Impact
UI de artefactos, orquestación del editor y sincronización de fuentes HyperFrames.
Sin migraciones, dependencias nuevas, caché persistente, despliegue ni cambios de
autoridad, formato del documento o contrato con proveedores.
