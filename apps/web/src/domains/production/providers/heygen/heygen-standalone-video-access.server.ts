import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getBackgroundFunctionSecret } from "../../../../lib/server/env";

export const HEYGEN_STANDALONE_VIDEO_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const MAX_TOKEN_CHARACTERS = 2048;
const SIGNATURE_DOMAIN = "courseforge:heygen-standalone-video-access:v1:";
const videoIdSchema = z.string().min(1).max(200);
const accessSchema = z.object({
  version: z.literal(1),
  purpose: z.literal("heygen-standalone-video"),
  organizationId: z.string().uuid(),
  videoId: videoIdSchema,
  issuedAt: z.number().int().nonnegative(),
}).strict();

export class HeygenStandaloneVideoAccessUnavailableError extends Error {
  readonly code = "HEYGEN_STANDALONE_VIDEO_ACCESS_UNAVAILABLE";
  constructor() {
    super("No se pudo verificar temporalmente el acceso al vídeo. Intenta de nuevo.");
    this.name = "HeygenStandaloneVideoAccessUnavailableError";
  }
}

/** La organización procede de autoridad vigente; el comprobante no la sustituye. */
export function createHeygenStandaloneVideoAccess(organizationId: string, now: () => number = Date.now) {
  let key: string;
  try {
    if (!z.string().uuid().safeParse(organizationId).success) throw new Error("Contexto inválido.");
    key = getBackgroundFunctionSecret();
    if (typeof key !== "string" || key.length < 32) throw new Error("Firma no disponible.");
  } catch {
    throw new HeygenStandaloneVideoAccessUnavailableError();
  }
  const normalizedOrganizationId = organizationId.toLowerCase();
  const signature = (payload: string) => createHmac("sha256", key).update(SIGNATURE_DOMAIN + payload).digest();
  return {
    issue(videoId: string): string {
      if (!videoIdSchema.safeParse(videoId).success) throw new Error("El proveedor no devolvió un identificador de vídeo válido.");
      const value: z.infer<typeof accessSchema> = {
        version: 1, purpose: "heygen-standalone-video", organizationId: normalizedOrganizationId, videoId, issuedAt: now(),
      };
      const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
      return `${payload}.${signature(payload).toString("hex")}`;
    },
    verify(token: string | null, videoId: string): boolean {
      if (!token || token.length > MAX_TOKEN_CHARACTERS) return false;
      const parts = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
      if (!parts) return false;
      const [, payload, receivedSignature] = parts;
      if (!timingSafeEqual(signature(payload), Buffer.from(receivedSignature, "hex"))) return false;
      try {
        const parsed = accessSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
        if (!parsed.success) return false;
        const age = now() - parsed.data.issuedAt;
        return parsed.data.organizationId === normalizedOrganizationId && parsed.data.videoId === videoId
          && age >= -CLOCK_SKEW_MS && age <= HEYGEN_STANDALONE_VIDEO_TOKEN_MAX_AGE_MS;
      } catch {
        return false;
      }
    },
  };
}
