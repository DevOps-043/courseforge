import { z } from "zod";
import type { HyperframesRenderSettings } from "./hyperframes-render-profiles";

const hyperframesCompositionIdSchema = z.string().uuid();

/** Keeps route-parameter validation separate from document validation. */
export function validateHyperframesCompositionId(value: unknown) {
  return hyperframesCompositionIdSchema.safeParse(value);
}

/** Produces useful diagnostics without logging rejected values or document data. */
export function summarizeHyperframesValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String).join("."),
  }));
}

export type HyperframesSnapshotRenderProfile = HyperframesRenderSettings;

type RequestedRenderProfile = {
  format?: "mp4" | "webm" | "mov";
  fps?: number;
  quality?: "draft" | "standard" | "high";
  resolution?: "1080p" | "4k";
};

export type HyperframesRenderProfileResolution =
  | { data: HyperframesSnapshotRenderProfile; success: true }
  | { message: string; success: false };

/** Keeps render options bound to the immutable snapshot that was approved. */
export function resolveHyperframesSnapshotRenderProfile(
  requested: RequestedRenderProfile,
  snapshot: HyperframesSnapshotRenderProfile | undefined,
): HyperframesRenderProfileResolution {
  if (!snapshot) {
    return {
      message: "Este snapshot usa un perfil de render anterior. Regenera el snapshot antes de enviarlo a HeyGen.",
      success: false,
    };
  }
  if (requested.fps !== undefined && requested.fps !== snapshot.fps) {
    return {
      message: "Los FPS solicitados no coinciden con el snapshot. Regenera el snapshot antes de renderizar.",
      success: false,
    };
  }
  if (requested.quality !== undefined && requested.quality !== snapshot.quality) {
    return {
      message: "La calidad solicitada no coincide con el snapshot. Regenera el snapshot antes de renderizar.",
      success: false,
    };
  }
  if (requested.format !== undefined && requested.format !== snapshot.format) {
    return {
      message: "El formato solicitado no coincide con el snapshot. Regenera el snapshot antes de renderizar.",
      success: false,
    };
  }
  if (requested.resolution !== undefined && requested.resolution !== snapshot.resolution) {
    return {
      message: "La resolución solicitada no coincide con el snapshot. Regenera el snapshot antes de renderizar.",
      success: false,
    };
  }
  return { data: snapshot, success: true };
}
