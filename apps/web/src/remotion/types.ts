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
  ASSEMBLY_TEMPLATES.SPLIT_AVATAR,
  ASSEMBLY_TEMPLATES.FULL_SLIDES,
  ASSEMBLY_TEMPLATES.AVATAR_FOCUS,
]);

/** Tipos de transición soportados entre slides/secuencias. */
export const assemblyTransitionSchema = z.enum(["fade", "slide", "none"]);
export type AssemblyTransition = z.infer<typeof assemblyTransitionSchema>;

// --- Sub-esquemas de assets resueltos --------------------------------------

/** Una slide ya resuelta a su URL pública e índice de orden. */
export const assemblySlideSchema = z.object({
  index: z.number().int().min(0),
  url: z.string().url(),
});
export type AssemblySlide = z.infer<typeof assemblySlideSchema>;

/** Un clip de B-roll resuelto, con su duración ya convertida a frames. */
export const assemblyBrollClipSchema = z.object({
  url: z.string().url(),
  durationInFrames: z.number().int().positive(),
  order: z.number().int().min(1),
});
export type AssemblyBrollClip = z.infer<typeof assemblyBrollClipSchema>;

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

  /** Música de fondo y su volumen relativo (0..1). */
  bgMusicUrl: z.string().url().optional(),
  bgMusicVolume: z.number().min(0).max(1).default(0.15),

  /** Video de avatar (talking head). */
  avatarVideoUrl: z.string().url().optional(),

  /** Slides en orden de aparición. Puede venir vacío. */
  slides: z.array(assemblySlideSchema).default([]),

  /** Clips de B-roll en orden. Puede venir vacío. */
  brollClips: z.array(assemblyBrollClipSchema).default([]),

  /** Transición entre slides/secuencias. */
  transitionType: assemblyTransitionSchema.default("fade"),
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
    slides: [],
    brollClips: [],
    transitionType: "fade",
  };
}