## Why

Architect bloquea la publicación híbrida porque Academy ignora el recorrido y
actualiza lecciones por posición. Quitar la guarda perdería distribución y podría
reasignar progreso o publicar contenido parcial.

## What Changes

- Contrato de publicación v2 con organización, artefacto, revisión inmutable,
  identidades estables, currículo, recorrido y preparación síncrona.
- Recepción y aprobación con validación explícita, idempotencia y transacción.
- Separar recepción, aprobación y asignación de alumnos; no equiparar SENT con
  curso publicado. Sesiones sin fecha son plantillas, no reuniones programadas.
- Activación gradual: v1 sigue funcionando; v2 no entra al importador posicional.

## Capabilities

### New Capabilities

- `hybrid-publication-bridge`: contrato e importación segura del taller híbrido.

### Modified Capabilities

Ninguna en este primer incremento; el envío híbrido sigue protegido hasta completar
la aprobación atómica del receptor.

## Impact

Architect: publication, course-delivery, outbox y UI de publicación.
Academy: inbox, revisión, importación, persistencia de recorrido y preparación,
programación y permisos de curso. Hub consume Academy con los contratos existentes.
No se incluyen el fallo del protocolo del navegador ni cambios de fechas previos.
No aplicar migraciones ni desplegar como parte de las verificaciones locales.
