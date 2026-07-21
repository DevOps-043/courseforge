import type { BundleAgentSpec } from "./types";
import type { BundleBlueprint } from "./blueprint.service";

export function buildBundleManifest(spec: BundleAgentSpec, blueprint: BundleBlueprint) {
  return {
    name: blueprint.title,
    entryPoint: "src/index.tsx",
    compositionId: blueprint.compositionId,
    exportMode: "root" as const,
    defaultDurationFrames: blueprint.fallbackDurationFrames,
    fps: blueprint.fps,
    width: blueprint.width,
    height: blueprint.height,
    propsSchema: {
      ...spec.propsSchema,
      type: "object" as const,
      properties: {
        ...(spec.propsSchema.properties || {}),
        accentColor: { type: "string", description: "Color de acento opcional." },
        avatarVideoUrl: { type: "string", description: "URL publica del video de avatar/talking head." },
        bgMusicUrl: { type: "string", description: "URL publica de musica de fondo." },
        bgMusicVolume: { type: "number", description: "Volumen relativo de musica de fondo entre 0 y 1." },
        brollClips: { type: "array", description: "Clips B-roll normalizados por SofLIA - Engine." },
        layoutOverrides: { type: "array", description: "Manifiestos de ajustes visuales no destructivos del editor de layout." },
        slides: { type: "array", description: "Slides renderizables normalizadas por SofLIA - Engine." },
        totalDurationInFrames: { type: "integer", description: "Duracion total resuelta para el render." },
        voiceAudioUrl: { type: "string", description: "URL publica de la locucion principal." },
      },
    },
    defaultProps: {
      ...spec.defaultProps,
      accentColor: blueprint.accentColor,
      bgMusicVolume: typeof spec.defaultProps.bgMusicVolume === "number" ? spec.defaultProps.bgMusicVolume : 0.12,
      brollClips: Array.isArray(spec.defaultProps.brollClips) ? spec.defaultProps.brollClips : [],
      layoutOverrides: Array.isArray(spec.defaultProps.layoutOverrides) ? spec.defaultProps.layoutOverrides : [],
      slides: Array.isArray(spec.defaultProps.slides) ? spec.defaultProps.slides : [],
      totalDurationInFrames: blueprint.fallbackDurationFrames,
    },
    editableLayers: blueprint.editableLayers,
    remotionVersion: "4.0.484",
  };
}
