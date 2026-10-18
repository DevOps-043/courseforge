# Contexto y diseño

- Actor: editor autorizado de escenas de curso.
- Base: 64606f73; continuación en codex/fix-heygen-preset-handoff, preservando
  el cambio previo de presets sin mezclar su especificación.
- UI: botón y estado local de guardado; transporte cliente separado del JSX.
- Eliminación manual: conservar tombstone deleted=true en el snapshot; omitir
  un clip no equivale a borrarlo en el RPC existente. No se cambia SQL.
- Contrato PATCH: admite guion vacío como borrador. La estructura, UUIDs,
  estados y permisos actuales permanecen validados.
- Generación: admite borradores no seleccionados dentro del snapshot; exige
  guion para cada escena activa seleccionada. El servicio mantiene su preflight
  sobre escenas persistidas y los jobs usan el mismo schema.
- El transporte acepta éxito sólo con respuesta de escenas válida. Los errores
  se muestran junto al botón, incluso si la notificación toast no es visible.
- Se comprueba que el servidor confirme todos los IDs enviados. Un timeout
  informa estado no confirmado, sin reintentar ni afirmar que no persistió.
- Un guardado pendiente bloquea una segunda escritura desde la misma pantalla
  y los controles de edición, para no sustituir cambios hechos durante el envío.
- No objetivos: cambios de esquema SQL, reconciliación global de polling,
  instalación global de notificaciones, migraciones o regeneración de assets.
- Efectos externos: PATCH autorizado existente; ninguna llamada real en pruebas.
- Rollback: revertir UI/cliente/validadores; los borradores vacíos ya cumplen
  el modelo de assets existente, aunque el validador anterior no los admitía.
- QA: contratos guardar/generar, transporte exitoso y fallido, RPC con campos
  editoriales preservados, compilación, lint y revisión del mismo autor.

Fuentes: createManualSceneClip/handleSaveSceneEdits, heygen.validators,
HeygenScenesService.saveSceneClips y Providers/RootLayout sin Toaster.
