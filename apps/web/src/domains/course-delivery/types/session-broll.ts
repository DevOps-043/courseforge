import { z } from "zod";

export const SESSION_BROLL_MAX_BYTES = 100 * 1024 * 1024;
export const SESSION_BROLL_MAX_SECONDS = 600;
export const sessionBrollCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("INIT"), revision: z.number().int().nonnegative(), assetId: z.uuid(),
    name: z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f/\\]+$/), extension: z.enum(["mp4", "webm"]),
    size: z.number().int().positive().max(SESSION_BROLL_MAX_BYTES) }).strict(),
  z.object({ action: z.enum(["CONFIRM", "APPROVE", "ARCHIVE"]), revision: z.number().int().nonnegative(), assetId: z.uuid() }).strict(),
]);
export type SessionBrollCommand = z.infer<typeof sessionBrollCommandSchema>;
export interface SessionBroll {
  id: string; name: string; status: "PENDING" | "GENERATED" | "APPROVED";
  current: boolean; duration: number | null;
}

export function sessionBrollPath(organizationId: string, artifactId: string, sessionId: string, assetId: string, extension: "mp4" | "webm") {
  return `session-broll/${organizationId}/${artifactId}/${sessionId}/${assetId}.${extension}`;
}
