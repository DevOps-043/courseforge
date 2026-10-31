# Autoguardado por acción en el editor

Estado: implementación local; verificaciones y límites en reports/implementation.md.

## Objetivo

Eliminar el paso de guardar manualmente cada ajuste editorial. Una interacción
válida debe actualizar el documento y persistirse automáticamente, con deshacer
y rehacer por acción. El usuario solicita inventario y evaluación antes de cambiar
el comportamiento de todas las herramientas.

## Alcance

Editor nativo de composición y sus controles de HTML, timeline, motion, texto,
audio, medios, presets, narrativa y entrega. La auditoría es estática sobre el
checkout actual: no acredita qué flags están habilitados en producción.
Se preservan los cambios locales anteriores de HeyGen.

## Hallazgo

Existen 13 instancias de botones de guardado en 8 componentes, varias
condicionales. Otras acciones ya guardan con savePatch. La infraestructura
versionada existe, pero hacen falta agrupación por interacción, recuperación
de la cola pendiente y coordinación de historiales antes de generalizarla.

## Resultado propuesto

- Ningún botón Guardar en las herramientas ordinarias de edición.
- Una interacción terminada genera un comando reversible, no una escritura por
  evento de ratón o tecla.
- Procesar, aprobar, publicar, renderizar y crear recursos siguen siendo
  acciones explícitas. No se disparan por autoguardado.
- HTML requiere integración de su revisión e historial propios; no se elimina
  su barrera de escritura hasta disponer de un reemplazo verificable.

Inventario, evidencia, excepciones y fases en [design.md](design.md).

## Investigación posterior de latencia

El reporte recurrente del usuario se analiza, sin cambios de producto, en el
[informe del 30 de octubre de 2026](reports/informe-latencia-editor-2026-10-30.md).
Sus causas confirmadas, experimentos, límites y recomendaciones no sustituyen
el contrato de persistencia ni afirman haber medido el despliegue real.

## Corrección autorizada del informe

La continuidad durante persistencia, granularidad del inspector, ruta literal de
texto y métricas se implementan en este mismo cambio. Arquitectura, regresiones,
verificación y límites en [corrección de latencia](reports/correccion-latencia-2026-10-30.md).
No se despliega ni se reemplaza el protocolo de revisiones HTML.
