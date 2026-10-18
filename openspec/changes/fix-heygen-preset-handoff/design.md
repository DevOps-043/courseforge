# Contexto y diseño

- Actor: editor autorizado de un componente de curso.
- Base: main, 64606f73; rama codex/fix-heygen-preset-handoff; checkout limpio.
- Contratos: query opcional avatarPresetId/voicePresetId; PATCH de escenas
  existente conserva avatar_preset_id/voice_preset_id por clip.
- Los identificadores del enlace son preferencias no confiables: se resuelven
  exclusivamente contra el catálogo retornado para la organización activa.
- Precedencia inicial: preferencia válida de Producción, default del catálogo,
  primer elemento. En escenas: selección explícita, selección del panel.
- La misma selección mostrada se materializa al guardar, antes de cualquiera
  de los caminos de generación. No basta con cambiar el valor del selector.
- No se mutan escenas durante la carga ni se sobrescriben ajustes propios.
- Alternativas: cambiar defaults globales afectaría otros cursos; persistir
  preferencias antes de navegar ampliaría APIs y datos sin necesidad.
- Compatibilidad: enlaces previos sin preferencias mantienen su inicialización.
- Efectos externos: ninguno durante implementación/pruebas. Se preservan
  autorización y validación existentes en servidor para guardado/generación.
- Rollback: revertir el cambio cliente; los IDs guardados siguen el contrato actual.
- Límite: la navegación no guarda por sí sola preferencias en la BD; los assets
  existentes no se regeneran por cambiar una selección.

Fuentes: ProductionStructuredAssetSections.openHeygenModule,
HeygenStudioClient.loadPresets/saveSceneClips y la ruta /heygen/scenes.
