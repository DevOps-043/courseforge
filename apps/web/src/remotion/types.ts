/**
 * Contrato de props compartido para el ensamblado Remotion (Fase 7).
 *
 * Esta es la ÚNICA fuente de verdad de "qué necesita una composition para dibujarse".
 * Lo consumen por igual:
 *   - El `<Player>` del navegador (preview en vivo, `apps/web/src/remotion/...`).
 *   - El renderer server-side futuro (`apps/api/.../remotion-worker.service.ts`),
 *     que mapeará las URLs públicas a rutas locales solo para el CLI.
 *
 * Reglas de diseño (ver docs/PLAN_PREVIEW_REMOTION_PLAYER.md, Fase 1):
 *   - URLs PÚBLICAS, nunca rutas locales: el Player corre en el browser.
 *   - Todo asset es opcional salvo la duración: la preview debe dibujarse aunque
 *     falten assets (regla de opcionalidad: voz opcional si hay avatar).
 *   - Duración explícita en frames: el Player exige `durationInFrames` + `fps`.
 */

import { z } from "zod";
import {
  DEFAULT_TEMPLATE_RENDER_CONFIG,
  templateRenderConfigSchema,
} from "./template-config";
import { layoutOverrideManifestListSchema } from "./layout-overrides";
import { timelineOverrideManifestListSchema } from "./timeline-overrides";

// --- Constantes de composición (sin magic numbers dispersos) ---------------

/** Frames por segundo de todas las composiciones de ensamblado. */
export const ASSEMBLY_FPS = 30;

/** Resolución 16:9 Full HD usada por todas las composiciones. */
export const ASSEMBLY_WIDTH = 1920;
export const ASSEMBLY_HEIGHT = 1080;

/**
 * Duración mínima/fallback en segundos cuando ningún asset de audio o video
 * reporta su duración. Evita un `durationInFrames` igual a 0 que rompe el Player.
 */
export const ASSEMBLY_FALLBACK_DURATION_SECONDS = 10;

// --- Identificadores de plantilla / composición ----------------------------

/**
 * Slugs estables de plantilla. Coinciden 1:1 con las composiciones registradas
 * en `Root.tsx` y con el `composition_id` que la migración asigna a cada
 * plantilla sembrada en `remotion_templates`.
 */
export const ASSEMBLY_TEMPLATES = {
  ANIMATED_DECK_AVATAR: "animated-deck-avatar",
  SPLIT_AVATAR: "split-avatar",
  FULL_SLIDES: "full-slides",
  AVATAR_FOCUS: "avatar-focus",
} as const;

export type AssemblyTemplate =
  (typeof ASSEMBLY_TEMPLATES)[keyof typeof ASSEMBLY_TEMPLATES];

/** Plantilla por defecto cuando una composición no especifica `template`. */
export const DEFAULT_ASSEMBLY_TEMPLATE: AssemblyTemplate =
  ASSEMBLY_TEMPLATES.FULL_SLIDES;

export const assemblyTemplateSchema = z.enum([
  ASSEMBLY_TEMPLATES.ANIMATED_DECK_AVATAR,
  ASSEMBLY_TEMPLATES.SPLIT_AVATAR,
  ASSEMBLY_TEMPLATES.FULL_SLIDES,
  ASSEMBLY_TEMPLATES.AVATAR_FOCUS,
]);

/** Tipos de transición soportados entre slides/secuencias. */
export const assemblyTransitionSchema = z.enum(["fade", "slide", "none"]);
export type AssemblyTransition = z.infer<typeof assemblyTransitionSchema>;

// --- Sub-esquemas de assets resueltos --------------------------------------

/** Una slide ya resuelta a su URL publica o a HTML saneado. */
export const assemblySlideSchema = z.object({
  animationCount: z.number().int().min(0).default(0),
  classes: z.string().trim().optional(),
  html: z.string().optional(),
  index: z.number().int().min(0),
  kind: z.enum(["image", "html"]).default("image"),
  label: z.string().trim().optional(),
  url: z.string().url().optional(),
}).superRefine((slide, context) => {
  if (slide.kind === "image" && !slide.url) {
    context.addIssue({
      code: "custom",
      message: "Las slides de imagen requieren url.",
      path: ["url"],
    });
  }

  if (slide.kind === "html" && (!slide.html || !slide.classes)) {
    context.addIssue({
      code: "custom",
      message: "Las slides HTML requieren html y classes saneados.",
      path: ["html"],
    });
  }
});
export type AssemblySlide = z.infer<typeof assemblySlideSchema>;

/** Un clip de B-roll resuelto, con su duración ya convertida a frames. */
export const assemblyBrollClipSchema = z.object({
  url: z.string().url(),
  durationInFrames: z.number().int().positive(),
  order: z.number().int().min(1),
});
export type AssemblyBrollClip = z.infer<typeof assemblyBrollClipSchema>;

export const assemblyAvatarClipSchema = z.object({
  clipId: z.string().trim().optional(),
  url: z.string().url(),
  durationInFrames: z.number().int().positive(),
  order: z.number().int().min(1),
});
export type AssemblyAvatarClip = z.infer<typeof assemblyAvatarClipSchema>;

export const assemblyVoiceClipSchema = z.object({
  clipId: z.string().trim(),
  url: z.string().url(),
  durationInFrames: z.number().int().positive(),
  order: z.number().int().min(1),
});
export type AssemblyVoiceClip = z.infer<typeof assemblyVoiceClipSchema>;

export const assemblyTimelineSegmentSchema = z.object({
  id: z.string(),
  trackKind: z.enum(["avatar", "slides", "broll"]),
  layerId: z.string().optional(),
  label: z.string(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
  sourceUrl: z.string().url().optional(),
  sourceStartFrame: z.number().int().min(0).optional(),
  sourceEndFrame: z.number().int().positive().optional(),
  loopMode: z.enum(["loop", "freeze", "none"]).default("loop"),
});
export type AssemblyTimelineSegment = z.infer<typeof assemblyTimelineSegmentSchema>;

// --- Contrato principal -----------------------------------------------------

/**
 * Props que recibe cualquier composition de ensamblado. Debe ser 100%
 * serializable a JSON (Remotion las pasa como `inputProps` / `--input-data`).
 */
export const assemblyInputPropsSchema = z.object({
  /** Qué layout/composición renderizar. */
  template: assemblyTemplateSchema.default(DEFAULT_ASSEMBLY_TEMPLATE),

  /** FPS de la composición (debe coincidir con la `<Composition fps>`). */
  fps: z.number().int().positive().default(ASSEMBLY_FPS),

  /** Duración total ya resuelta en frames. Único campo no opcional de "datos". */
  totalDurationInFrames: z.number().int().positive(),

  /** Locución principal (opcional si hay avatar con voz nativa). */
  voiceAudioUrl: z.string().url().optional(),

  /** Locuciones por escena, validadas 1:1 contra avatarClips. */
  voiceClips: z.array(assemblyVoiceClipSchema).default([]),

  /** Música de fondo y su volumen relativo (0..1). */
  bgMusicUrl: z.string().url().optional(),
  bgMusicVolume: z.number().min(0).max(1).default(0.15),

  /** Video de avatar (talking head). */
  avatarVideoUrl: z.string().url().optional(),

  /** Clips de avatar en secuencia. Puede venir vacio. */
  avatarClips: z.array(assemblyAvatarClipSchema).default([]),

  /** Slides en orden de aparición. Puede venir vacío. */
  slides: z.array(assemblySlideSchema).default([]),

  /** CSS saneado y aislado para slides HTML animadas. */
  deckCss: z.string().default(""),

  /** Google Fonts permitidas para el deck HTML. */
  deckFonts: z
    .array(
      z.object({
        family: z.string().trim().min(1),
        href: z.string().url(),
      }),
    )
    .default([]),

  /** Clips de B-roll en orden. Puede venir vacío. */
  brollClips: z.array(assemblyBrollClipSchema).default([]),

  /** Transición entre slides/secuencias. */
  transitionType: assemblyTransitionSchema.default("fade"),

  /** Configuracion visual validada de la plantilla dinamica. */
  templateConfig: templateRenderConfigSchema.default(
    DEFAULT_TEMPLATE_RENDER_CONFIG,
  ),

  /** Ajustes visuales no destructivos aplicados por el editor de layout. */
  layoutOverrides: layoutOverrideManifestListSchema,

  /** Ajustes temporales no destructivos aplicados por el editor de timeline. */
  timelineOverrides: timelineOverrideManifestListSchema,
});

/**
 * Forma de SALIDA (post-parseo): los campos con `.default()` ya están resueltos,
 * por eso son requeridos aquí. Es el tipo que reciben las composiciones.
 */
export type AssemblyInputProps = z.infer<typeof assemblyInputPropsSchema>;

/**
 * Forma de ENTRADA (pre-parseo): lo que un llamador puede pasar antes de aplicar
 * defaults. Útil para los callers que construyen props parciales.
 */
export type AssemblyInputPropsInput = z.input<typeof assemblyInputPropsSchema>;

/**
 * Valida y normaliza props crudas aplicando defaults. Lanza si son inválidas
 * (fail-fast): preferimos un error claro a una preview rota silenciosamente.
 */
export function parseAssemblyInputProps(raw: unknown): AssemblyInputProps {
  return assemblyInputPropsSchema.parse(raw);
}

/** Variante no-lanzante para flujos de UI que prefieren degradar con gracia. */
export function safeParseAssemblyInputProps(raw: unknown) {
  return assemblyInputPropsSchema.safeParse(raw);
}

/** Duración fallback expresada en frames (FPS x segundos fallback). */
export const ASSEMBLY_FALLBACK_DURATION_FRAMES =
  ASSEMBLY_FPS * ASSEMBLY_FALLBACK_DURATION_SECONDS;

/**
 * Props base válidas (sin assets) para una plantilla. Sirven como `defaultProps`
 * de las `<Composition>` en Remotion Studio y como baseline del Player.
 */
export function createDefaultAssemblyProps(
  template: AssemblyTemplate = DEFAULT_ASSEMBLY_TEMPLATE,
): AssemblyInputProps {
  return {
    template,
    fps: ASSEMBLY_FPS,
    totalDurationInFrames: ASSEMBLY_FALLBACK_DURATION_FRAMES,
    bgMusicVolume: 0.15,
    voiceClips: [],
    avatarClips: [],
    slides: [],
    deckCss: "",
    deckFonts: [],
    brollClips: [],
    transitionType: "fade",
    templateConfig: DEFAULT_TEMPLATE_RENDER_CONFIG,
    layoutOverrides: [],
    timelineOverrides: [],
  };
}
