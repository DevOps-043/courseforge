import { z } from "zod";

export const bundleAgentMessageRoleSchema = z.enum(["USER", "ASSISTANT", "SYSTEM", "TOOL"]);

export const bundleAgentSpecSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  visualStyle: z.string().trim().min(1).max(240),
  compositionId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  durationFrames: z.number().int().min(30).max(900).default(150),
  fps: z.number().int().min(12).max(60).default(30),
  width: z.number().int().min(320).max(3840).default(1920),
  height: z.number().int().min(240).max(2160).default(1080),
  requiredAssets: z.array(z.enum(["slides", "audio", "avatar", "broll", "captions"])).max(8).default(["slides"]),
  propsSchema: z
    .object({
      type: z.literal("object"),
      required: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      properties: z.record(
        z.string(),
        z.object({
          type: z.enum(["string", "number", "integer", "boolean", "array", "object", "null"]),
          description: z.string().trim().max(240).optional(),
        }),
      ),
    })
    .default({
      type: "object",
      properties: {
        title: { type: "string", description: "Course or lesson title" },
      },
    }),
  defaultProps: z.record(z.string(), z.unknown()).default({ title: "Courseforge" }),
  changeSummary: z.string().trim().max(1000).default("Initial SofLIA generated bundle draft."),
});

export type BundleAgentMessageRole = z.infer<typeof bundleAgentMessageRoleSchema>;
export type BundleAgentSpec = z.infer<typeof bundleAgentSpecSchema>;

export interface BundleAgentAuthContext {
  admin: any;
  organizationId: string;
  userId: string;
  platformRole?: string | null;
}

export interface BundleAgentConversation {
  id: string;
  organization_id: string;
  created_by: string | null;
  template_id: string | null;
  status: string;
  title: string;
  created_at: string;
  updated_at: string;
}
