# Desacoplar descriptor de render controlado — F3.5.d1

## Why
La componente circular restante de QA conecta fence, materialización, referencias
y supervisor mediante tipos derivados de implementaciones. Esos tipos arrastran
la cadena de autoridad, comparación y worker hacia los mismos adaptadores.

## What Changes
- Definir ControlledRenderDescriptor en un contrato sin dependencias de QA.
- Usar el tipo de conformidad existente, sin duplicar schemas ni añadir campos.
- Dirigir los consumidores del descriptor al contrato neutral.
- Conservar firmas públicas de renderer/executor y JavaScript de implementaciones.
- Verificar suites dirigidas y componentes completas, sin ignorar import type.

## Impact
Solo tipos y dirección de dependencias; sin cambios de fence, aislamiento,
materialización, permisos, firma, lease, checkpoint, comparación o finalización.
