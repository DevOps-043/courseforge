import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", {
  message: "El recurso debe usar HTTPS.",
});
const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asset_id"), asset_id: z.string().trim().min(1).max(255) }).strict(),
  z.object({ type: z.literal("url"), url: httpsUrl }).strict(),
]);
const baseOperation = {
  componentId: z.string().uuid().optional(),
  durationSeconds: z.number().positive().max(10_800).optional(),
  title: z.string().trim().min(1).max(255).optional(),
};

export const heygenPlatformActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("design_voice"),
    gender: z.enum(["female", "male"]).optional(),
    locale: z.string().trim().min(2).max(35).optional(),
    prompt: z.string().trim().min(1).max(1000),
    seed: z.number().int().nonnegative().default(0),
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("clone_voice"),
    audio: sourceSchema,
    language: z.string().trim().min(2).max(16).optional(),
    removeBackgroundNoise: z.boolean().default(true),
    voiceName: z.string().trim().min(1).max(100),
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("create_glossary"),
    name: z.string().trim().min(1).max(64),
    terms: z.array(z.object({
      pronunciation: z.string().trim().min(1).max(255),
      term: z.string().trim().min(1).max(255),
    }).strict()).max(500).default([]),
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("create_brand_kit"),
    name: z.string().trim().min(1).max(256).optional(),
    url: httpsUrl,
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("translate_video"),
    brandGlossaryId: z.string().trim().min(1).max(255).optional(),
    disableMusicTrack: z.boolean().default(false),
    enableSpeechEnhancement: z.boolean().default(true),
    inputLanguage: z.string().trim().min(2).max(80).optional(),
    mode: z.enum(["precision", "speed"]).default("speed"),
    outputLanguages: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
    speakerNum: z.number().int().min(1).max(20).optional(),
    translateAudioOnly: z.boolean().default(false),
    video: sourceSchema,
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("create_proofread"),
    brandGlossaryId: z.string().trim().min(1).max(255).optional(),
    disableMusicTrack: z.boolean().default(false),
    enableSpeechEnhancement: z.boolean().default(true),
    mode: z.enum(["precision", "speed"]).default("precision"),
    outputLanguages: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
    speakerNum: z.number().int().min(1).max(20).optional(),
    video: sourceSchema,
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("lipsync"),
    audio: sourceSchema,
    disableMusicTrack: z.boolean().default(false),
    enableSpeechEnhancement: z.boolean().default(true),
    mode: z.enum(["precision", "speed"]).default("speed"),
    video: sourceSchema,
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("ai_clipping"),
    aspectRatio: z.enum(["landscape", "portrait", "square"]).default("portrait"),
    captions: z.boolean().default(true),
    durationTypes: z.array(z.enum(["30", "60", "180", "long"])).min(1).max(4).default(["30"]),
    inputLanguage: z.string().trim().min(2).max(16).optional(),
    prompt: z.string().trim().min(1).max(500).optional(),
    video: sourceSchema,
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("remove_fillers"),
    video: sourceSchema,
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("generate_template"),
    brandGlossaryId: z.string().trim().min(1).max(255).optional(),
    caption: z.boolean().default(false),
    fps: z.union([z.literal(25), z.literal(30), z.literal(60)]).default(25),
    templateId: z.string().trim().min(1).max(255),
    variables: z.record(z.string(), z.unknown()).default({}),
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("video_agent"),
    avatarId: z.string().trim().min(1).max(255).optional(),
    brandKitId: z.string().trim().min(1).max(255).optional(),
    files: z.array(sourceSchema).max(20).default([]),
    incognitoMode: z.boolean().default(false),
    mode: z.enum(["chat", "generate"]).default("generate"),
    orientation: z.enum(["landscape", "portrait"]).optional(),
    prompt: z.string().trim().min(1).max(10_000),
    styleId: z.string().trim().min(1).max(255).optional(),
    voiceId: z.string().trim().min(1).max(255).optional(),
    ...baseOperation,
  }).strict(),
  z.object({
    action: z.literal("video_batch"),
    folderId: z.string().trim().min(1).max(255).optional(),
    videos: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
    ...baseOperation,
  }).strict(),
]);

export const heygenWorkspaceSettingsSchema = z.object({
  defaultBrandGlossaryId: z.string().trim().max(255).nullable().optional(),
  defaultBrandKitId: z.string().trim().max(255).nullable().optional(),
  defaultLocale: z.string().trim().min(2).max(35).default("es-MX"),
  liveavatarAvatarId: z.string().trim().max(255).nullable().optional(),
  liveavatarContextId: z.string().trim().max(255).nullable().optional(),
  liveavatarSandbox: z.boolean().default(true),
  monthlyBudgetUsd: z.number().nonnegative().max(1_000_000).nullable().optional(),
  perCourseBudgetUsd: z.number().nonnegative().max(1_000_000).nullable().optional(),
}).strict();

export const heygenAudioSearchSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  query: z.string().trim().min(1).max(500),
  type: z.enum(["music", "sound_effects"]).default("music"),
}).strict();

export type HeygenPlatformAction = z.infer<typeof heygenPlatformActionSchema>;
