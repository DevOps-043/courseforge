# Agrupaciones anidadas en el editor de composición

Estado: plan propuesto; sin implementación de producto ni migraciones aplicadas.
Fecha: 2026-10-29.

## Why

El editor agrupa clips, pero no permite conservar dos agrupaciones dentro de una
agrupación superior. La restricción existe en UI, schemas, servicios y consumidores
SQL de extracción narrativa. Habilitar el botón de agrupar sería insuficiente.

## What Changes

- Introducir una jerarquía editorial de grupos con un único padre directo.
- Permitir agrupar grupos hermanos, o grupos y clips libres del mismo nivel.
- Adaptar selección, navegación, movimiento, desagrupación, copia e historial.
- Mantener posiciones temporales absolutas en los clips y render derivado de ellos.
- Actualizar validadores TypeScript y SQL antes de habilitar escrituras anidadas.
- Mantener lectura de documentos planos e historial sin reescribir versiones.

## Capabilities

### New Capabilities
- `nested-composition-groups`: organización editorial jerárquica y operaciones seguras.

### Modified Capabilities
- Ninguna especificación canónica existente se modifica en esta fase de planificación.

## Impact

Dominios: composition-editor; componentes de selección y timeline; persistencia
versionada; extracción narrativa; compilación/preview como consumidores a verificar.
Se propone reutilizar la ruta de documento existente, Auth Bridge, autorización
tenant y control de concurrencia por hash. No se proponen tablas nuevas.

No objetivos: transformaciones espaciales heredadas, motion del padre, tiempos
relativos, composición audiovisual encapsulada, grupos compartidos entre documentos,
reparentado por arrastre o nuevas facultades del agente runtime.

Este cambio solo registra el plan. No publica, despliega, renderiza ni accede a
servicios externos. El despliegue y SQL remoto conservan su autorización propia.

## Contexto

- Actor: persona con permiso vigente para editar el borrador de su organización.
- Objetivo: organizar y operar conjuntos reutilizando las agrupaciones internas.
- Base: checkout local inspeccionado; no acredita estado de producción.
- Restricción: conservar cambios locales de exportación por intervalo y su documentación.
- Contratos: documento, patches, historial, extracción y validadores SQL.
- Criterios: escenarios en [spec.md](specs/nested-composition-groups/spec.md).
- Riesgos e incertidumbres: compatibilidad de lectores antiguos, funciones SQL
  efectivamente desplegadas y límites de profundidad; véase [design.md](design.md).

## Entrega

[Diseño y flujo](design.md), [fases ejecutables](tasks.md) y
[evidencia de revisión](reports/review.md).

Decisiones concretadas para comenzar implementación: [cierres técnicos](technical-closure.md).
