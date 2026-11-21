## Why

La prueba híbrida dca8d686-2c8a-413f-b4a6-5b1e4b187547 falla en Plan con
INVALID_OUTPUT y 0/2 sesiones guardadas. El diagnóstico actual no distingue
minutos, referencias o vínculos del recorrido. Cambiar el modelo no corrige ese
contrato ni cambia el snapshot de una ejecución reanudada.

## What Changes

Explicitar requisitos calculados desde la agenda y el recorrido, corregir una vez
un plan inválido dentro del presupuesto y publicar motivos seguros de rechazo.
Conservar validadores, revisión de respaldo y commit con lease/revisión.

## Impact

Worker de impartición y pruebas locales. Sin migraciones, cambios remotos ni
generación pagada. La causa exacta del rechazo desplegado queda por confirmar.
