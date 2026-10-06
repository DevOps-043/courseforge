import {z} from "zod";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const hyperframesPlanSchema = z.object({
  accentColor: z.string().regex(HEX_COLOR),
  durationSeconds: z.number().int().min(3).max(120),
  subtitle: z.string().trim().min(1).max(220),
  title: z.string().trim().min(1).max(100),
}).strict();

export type HyperframesPlan = z.infer<typeof hyperframesPlanSchema>;
