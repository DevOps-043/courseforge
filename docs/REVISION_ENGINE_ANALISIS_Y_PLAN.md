# Análisis técnico y plan progresivo — Editor del Engine

Fecha: 2026-08-17  
Estado: plan de revisión; no autoriza cambios de código.

## Propósito

Este documento complementa, sin modificar, el reporte QA de `REVISION_ENGINE.md`. Convierte cada observación en una investigación verificable y separa tres resultados posibles:

- defecto reproducido;
- comportamiento existente pero difícil de descubrir;
- hipótesis no confirmada que requiere evidencia adicional.

El criterio de decisión es `prompt_maestro.md`: preservar correctitud, seguridad, trazabilidad, mantenibilidad, QA y el menor radio de impacto.

## Línea base verificada

| Área | Implementación actual | Implicación |
| --- | --- | --- |
| Edición | Documento tipado, patches permitidos, `If-Match`, versionado y rollback del estado optimista. | No tratar el editor como HTML libre ni reemplazarlo sin justificar el riesgo. |
| Timeline | Clips, tracks, mover, duración, `clip.trim`, agregar/quitar clips, capas y audio. | “No hay corte” puede ser una brecha de UX, no de dominio. |
| Snapshot | Revisión inmutable con documento, assets, checksums y ZIP de render. | Es la fuente de verdad para paridad y auditoría. |
| Render | Aprobación + submit seguros y endpoint de polling. | El editor nativo no conserva/retoma el request de render después del submit: investigar como P0. |
| HyperFrames | Runtime HTML seekable, render determinista, Studio, `lint`, `check` y snapshots. | Adoptar contratos y QA; no incrustar Studio ni permitir fuentes arbitrarias. |

## Plan paso a paso

Cada etapa termina con evidencia, decisión y backlog actualizado. No se implementa una corrección antes de cerrar su diagnóstico.

### Paso 0 — Preparar una corrida trazable

**Objetivo:** poder correlacionar cada síntoma con su ejecución real.

- Registrar URL/ruta, usuario/rol de prueba, organización, navegador, commit/build y hora.
- Capturar `compositionId`, `draftId`, versión del documento, hash corto, `revisionId`, `production_job_id` y `render_request_id` si existen.
- Guardar pasos, resultado esperado, resultado observado, screenshot/video y errores de red/consola.
- Separar datos sensibles; no anexar URLs firmadas, tokens, HTML privado ni PII al reporte.

**Salida:** caso QA reproducible con IDs de correlación.

### Paso 1 — Triar guardado, versión y texto residual

**Objetivo:** resolver los síntomas del editor sin confundirlos.

1. Editar posición, tamaño, recorte temporal, duración y una propiedad desde inspector.
2. Confirmar transición `Guardando -> Guardado`, incremento de versión y actualización del preview.
3. Repetir con dos sesiones para provocar conflicto de `If-Match`.
4. Forzar/observar fallo temporal y verificar qué patch queda pendiente y qué muestra el botón Reintentar.
5. Buscar el texto residual en documento, respuesta API, preview compilado y datos persistidos; registrar su origen exacto.

**Decisiones esperadas:**

- Si el guardado falla: clasificar autorización, validación, conflicto, persistencia temporal o error no recuperable.
- Si falta versión: identificar la ruta/build exacta, pues la superficie actual ya la muestra.
- Si el texto proviene de IA/datos: tratarlo como validación de contenido; si viene de UI: corregir copy/traducción.

### Paso 2 — Triar duraciones, clips y usabilidad

**Objetivo:** distinguir una limitación funcional de una función no descubrible.

1. Abrir composición con varios assets y confirmar clips/tracks generados.
2. Probar `Recorte` en timeline, mover, redimensionar, reordenar, agregar/quitar y reproducir el resultado.
3. Crear clips con duración estimada y con duración editada por usuario.
4. Intentar snapshot con y sin `durationSource` verificable.
5. Observar qué señales ayudan al usuario a descubrir selección, drag, handles, inspector y autosave.

**Regla de producto:** duración estimada es advertencia accionable; sólo la falta de duración global verificable debe bloquear snapshot.

**Salida:** lista de cambios UX básicos frente a defectos funcionales confirmados.

### Paso 3 — Triar snapshot, aprobación y render

**Objetivo:** localizar exactamente dónde se rompe la cadena.

1. Congelar un documento guardado y comprobar que `revisionId`, número de revisión, versión de documento, hash y manifiesto quedan registrados.
2. Aprobar el snapshot y confirmar la transición a `READY_FOR_RENDER`.
3. Enviar render; capturar HTTP status, cuerpo seguro de respuesta, request/job IDs y estado del proveedor.
4. Recargar/cerrar y reabrir la pantalla; comprobar si el render sigue siendo visible y recuperable.
5. Consultar polling hasta estado terminal y verificar importación del vídeo final.

**Hipótesis prioritaria:** el editor deja el estado en `rendering` porque no persiste ni vuelve a consultar el `renderRequestId`. Esto no sustituye el análisis de un 500 concreto.

**Salida:** tabla de transición real vs. transición esperada y causa clasificada de cada falla.

### Paso 4 — QA de paridad preview/render

**Objetivo:** probar que el MP4 pertenece a la revisión aprobada.

- Elegir timestamps de inicio, corte, transición, escena más compleja y final.
- Comparar preview/snapshot/render en canvas, duración, texto, capas, crop, audio y medios.
- Confirmar que el artefacto final referencia la misma revisión/hash aprobados.
- Registrar divergencias como defecto visual, defecto de assets, defecto de runtime o error de proceso.

**Salida:** checklist de paridad por composición y evidencia visual mínima.

### Paso 5 — Evaluación arquitectónica de HyperFrames

**Objetivo:** decidir capacidades a adoptar sin migración precipitada.

| Capacidad | Evaluar adopción | Restricción |
| --- | --- | --- |
| `lint` / `check` / snapshots | Sí, como gates de QA. | Deben operar sobre snapshot validado y aislado. |
| Render determinista | Sí, por el adaptador actual. | Mantener jobs, tenant y auditoría en Courseforge. |
| Studio completo | No inicialmente. | Sus componentes no son drop-in y su modelo edita fuentes. |
| Edición de HTML/JS | No. | Sólo operaciones tipadas y allow-listed. |
| Escenas semánticas | Evaluar. | Agrupar clips; no crear un segundo dominio ni MP4 por escena por defecto. |

**Decisión prevista:** conservar el editor nativo; adoptar prácticas de validación, snapshots visuales y determinismo de HyperFrames.

### Paso 6 — Convertir evidencia en implementación

Sólo después de los pasos anteriores, crear tickets separados por defecto confirmado con:

- causa raíz y alcance;
- contrato/API/modelo afectado;
- riesgo de seguridad, concurrencia y regresión;
- estrategia de rollback;
- pruebas unitarias, integración, E2E y visuales;
- métricas/logs/alertas;
- criterios de aceptación observables.

## Backlog inicial de investigación

| Prioridad | Tema | Estado actual | Criterio de cierre |
| --- | --- | --- | --- |
| P0 | Render no recuperable | Hipótesis fuerte y brecha de cliente verificada. | Job visible y recuperable tras recarga; reintento idempotente. |
| P1 | Error al guardar | Síntoma reportado; causa pendiente. | Error clasificado, patch preservado y resolución explícita. |
| P1 | Versión | Implementada; reproducibilidad pendiente. | Confirmar ruta/build afectado o cerrar como reporte desactualizado. |
| P1 | Texto residual | No localizado en fuente. | Identificar origen o cerrar con evidencia. |
| P1 | Duraciones estimadas | Advertencia existente; copy/semántica a validar. | No bloquea indebidamente y enlaza clips afectados. |
| P2 | Corte/escenas | Capacidad parcial ya existe; UX y necesidad editorial pendientes. | Matriz de casos de uso y decisión de producto. |
| P2 | Complejidad UX | Reportado. | Flujo básico probado por usuario sin asistencia. |

## Definition of Done para cada corrección futura

1. El defecto se reproduce y queda vinculado a IDs/caso QA.
2. La causa queda diferenciada de los síntomas y alternativas descartadas.
3. La solución no habilita HTML, JS, CSS o archivos arbitrarios.
4. Hay control de autorización, aislamiento por organización e idempotencia donde aplique.
5. Se prueban éxito, error, concurrencia, recarga y regresión visual.
6. Logs seguros contienen la correlación necesaria; la UI no expone secretos.
7. La documentación QA original se actualiza sólo con evidencia confirmada, conservando su historial.

## Fuentes de la revisión inicial

- `docs/prompt_maestro.md`
- `apps/web/src/domains/materials/components/HyperframesCompositionPanel.tsx`
- `apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx`
- `apps/web/src/domains/production/composition-editor/`
- `apps/web/src/domains/production/hyperframes/`
- `apps/web/src/app/api/production/hyperframes/`
- `D:/Pulse Hub/hyperframes/docs/packages/studio.mdx`
- `D:/Pulse Hub/hyperframes/docs/packages/studio-server.mdx`
- `D:/Pulse Hub/hyperframes/docs/guides/rendering.mdx`
- `D:/Pulse Hub/hyperframes/docs/guides/troubleshooting.mdx`
