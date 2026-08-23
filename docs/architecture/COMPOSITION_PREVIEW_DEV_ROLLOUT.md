# Rollout DEV — sincronización incremental del preview

## Alcance

Este rollout habilita `NEXT_PUBLIC_COMPOSITION_PREVIEW_SYNC_V2_ENABLED=true` solamente durante `next dev`. El render HyperFrames canónico, la persistencia OCC y el fallback por reconstrucción completa permanecen sin cambios.

La configuración local vive en `apps/web/.env.development.local`, archivo ignorado por Git. No debe copiarse a QA o producción hasta completar esta matriz.

## Gates automatizados

```bash
npm run test:composition-preview-sync --workspace=apps/web
npm run test:hyperframes --workspace=apps/web
npm run qa:composition-preview-runtime --workspace=apps/web
```

El último comando requiere Chrome, Chromium o Edge. En CI puede definirse `CHROME_PATH`.

## Matriz manual autenticada

Ejecutar sobre un draft no crítico con el preview listo:

| Caso | Acción | Resultado esperado |
| --- | --- | --- |
| Geometría consecutiva | Mover y redimensionar 10 veces | El canvas responde sin pausa ni reload visible; persiste la última posición |
| Crop | Ajustar los cuatro bordes | El frame y el documento guardado convergen sin perder el playhead |
| Media fit | Alternar `CONTAIN` / `COVER` | Conserva la proporción y no recrea el iframe |
| Visibilidad | Ocultar y mostrar durante reproducción | El audio/medio respeta visibilidad y la reproducción conserva el tiempo |
| Volumen B-roll | Cambiar volumen varias veces | El audio cambia sin reconstruir el preview y persiste el último valor |
| Fallback | Modificar timing, track o estructura | Se pausa y reconstruye el iframe canónico conservando el playhead |
| Ráfaga | Ejecutar 20 cambios visuales seguidos | La cola no descarta comandos y el estado final coincide con la última edición |
| Conflicto | Editar el mismo draft desde otra sesión | OCC rechaza la versión obsoleta y el preview rehidrata la versión del servidor |

## Telemetría y criterios

Revisar los batches enviados a `preview-metrics`:

- `runtime_visual_patch_ms`: objetivo menor o igual a 50 ms.
- `save_roundtrip_ms`: objetivo menor o igual a 800 ms; no debe bloquear el ACK visual.
- `edit_to_visual_update_ms`: debe aproximarse al ACK del runtime, no al guardado.
- `iframe_reload_ms`: no debe aparecer para `clip.layout`, `clip.crop`, `clip.media-fit`, `clip.visibility` o `clip.volume` compatibles.
- `runtimeOutcome`: el camino normal debe ser `APPLIED`.

Detener el rollout si ocurre cualquiera de estos casos:

- `TIMEOUT`, `RUNTIME_ERROR` o `VERSION_MISMATCH` repetido en un flujo de una sola sesión.
- Diferencia observable entre documento persistido y preview después de quedar en reposo.
- Pérdida de comandos, retroceso visual o cambio del playhead durante patches visuales.
- Reloads repetidos por `SAVE_RECOVERY` en operaciones clasificadas `LIVE_DOM`.

## Rollback

Eliminar `apps/web/.env.development.local` o establecer el flag en `false`, y reiniciar `next dev`. El sistema vuelve al flujo canónico de pausa, guardado y reconstrucción completa sin migraciones ni cambios de datos.

