# Ensamble independiente

Esta entrada no mantiene una copia del editor. `StandaloneAssemblyStudio` crea el
contexto mínimo compatible con Producción y prepara los assets. La ruta
`assembly/[projectId]/edit` monta el mismo `PostproductionAssemblyContainer` que
usa el flujo de un curso sólo cuando existe una fuente de duración válida.

## Contrato de mantenimiento

- Los cambios funcionales del editor se hacen en `domains/materials/components`
  o `domains/production/composition-editor`; nunca se copian en este dominio.
- La entrada independiente sólo puede adaptar contexto, navegación y gestión de
  proyectos. La preparación usa `ProductionAssetCard`, compartido con Producción,
  y el editor vive en una página separada.
- Si el editor necesita un control exclusivo de contexto, se agrega mediante una
  prop opcional. Sin la prop, el comportamiento del flujo debe permanecer igual.
- Antes de integrar un cambio del editor se ejecuta
  `npm run test:hyperframes --workspace=apps/web` y se valida manualmente un
  proyecto de curso y uno independiente.

Este contrato hace que una actualización del editor o de la carga tipificada de
assets llegue a ambas entradas en el mismo cambio, sin sincronización manual de
dos implementaciones.
