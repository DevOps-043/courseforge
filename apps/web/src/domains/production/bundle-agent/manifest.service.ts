import type { BundleAgentSpec } from "./types";
import type { BundleBlueprint } from "./blueprint.service";
import {
  TEMPLATE_LAYOUT_CONTRACT_VERSION,
  TEMPLATE_LAYOUT_COORDINATE_SPACE,
} from "../../../remotion/layout-overrides";

function getDefaultAnimationVariant(spec: BundleAgentSpec) {
  const motion = spec.creativeBrief.motionLanguage.toLowerCase();
  if (motion.includes("quick") || motion.includes("rapido") || motion.includes("dinamico")) return "kinetic";
  if (motion.includes("soft") || motion.includes("suave") || motion.includes("sobrio")) return "measured";
  return "adaptive";
}

export function buildBundleManifest(spec: BundleAgentSpec, blueprint: BundleBlueprint) {
  const selectedVariant = spec.creativeBrief.visualVariants[0];

  return {
    name: blueprint.title,
    entryPoint: "src/index.tsx",
    compositionId: blueprint.compositionId,
    exportMode: "root" as const,
    layoutContractVersion: TEMPLATE_LAYOUT_CONTRACT_VERSION,
    layoutCoordinateSpace: TEMPLATE_LAYOUT_COORDINATE_SPACE,
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
        animationVariant: { type: "string", description: "Ritmo de animacion elegido desde la direccion creativa." },
        designTokens: { type: "object", description: "Tokens visuales seguros expuestos por la direccion creativa." },
        expandMissingSupportMedia: { type: "boolean", description: "Expande slide o B-roll cuando falta el otro soporte visual." },
        layoutOverrides: { type: "array", description: "Manifiestos de ajustes visuales no destructivos del editor de layout." },
        sceneSwapOnSlideChange: { type: "boolean", description: "Intercambia izquierda/derecha al cambiar de diapositiva." },
        slides: { type: "array", description: "Slides renderizables normalizadas por SofLIA - Engine." },
        totalDurationInFrames: { type: "integer", description: "Duracion total resuelta para el render." },
        visualVariantId: { type: "string", description: "ID de variante visual declarada en creativeBrief.visualVariants." },
        voiceAudioUrl: { type: "string", description: "URL publica de la locucion principal." },
      },
    },
    defaultProps: {
      ...spec.defaultProps,
      accentColor: blueprint.accentColor,
      bgMusicVolume: typeof spec.defaultProps.bgMusicVolume === "number" ? spec.defaultProps.bgMusicVolume : 0.12,
      brollClips: Array.isArray(spec.defaultProps.brollClips) ? spec.defaultProps.brollClips : [],
      animationVariant: typeof spec.defaultProps.animationVariant === "string" ? spec.defaultProps.animationVariant : getDefaultAnimationVariant(spec),
      designTokens: {
        backgroundColor: spec.creativeBrief.colorTokens.background,
        surfaceColor: spec.creativeBrief.colorTokens.surface,
        accentColor: spec.creativeBrief.colorTokens.accent,
        textColor: spec.creativeBrief.colorTokens.text,
        mutedTextColor: spec.creativeBrief.colorTokens.muted,
        typographyDisplay: spec.creativeBrief.typographyTokens.display,
        typographyBody: spec.creativeBrief.typographyTokens.body,
      },
      expandMissingSupportMedia: typeof spec.defaultProps.expandMissingSupportMedia === "boolean" ? spec.defaultProps.expandMissingSupportMedia : false,
      layoutOverrides: Array.isArray(spec.defaultProps.layoutOverrides) ? spec.defaultProps.layoutOverrides : [],
      sceneSwapOnSlideChange: typeof spec.defaultProps.sceneSwapOnSlideChange === "boolean" ? spec.defaultProps.sceneSwapOnSlideChange : false,
      slides: Array.isArray(spec.defaultProps.slides) ? spec.defaultProps.slides : [],
      totalDurationInFrames: blueprint.fallbackDurationFrames,
      visualVariantId: typeof spec.defaultProps.visualVariantId === "string" ? spec.defaultProps.visualVariantId : selectedVariant.id,
    },
    editableLayers: blueprint.editableLayers,
    remotionVersion: "4.0.484",
  };
}
