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

/** Extracts numeric timeline diagnostics without exposing composition content. */
export function summarizeCompositionTimelineBoundaryIssues(error: z.ZodError) {
  return error.issues.flatMap((issue) => {
    const params = "params" in issue && isRecord(issue.params) ? issue.params : null;
    if (params?.issueType !== "COMPOSITION_TIMELINE_BOUNDARY") return [];

    const clipId = typeof params.clipId === "string" ? params.clipId : null;
    const clipStartSeconds = readFiniteNumber(params.clipStartSeconds);
    const durationSeconds = readFiniteNumber(params.durationSeconds);
    const clipEndSeconds = readFiniteNumber(params.clipEndSeconds);
    const canvasDurationSeconds = readFiniteNumber(params.canvasDurationSeconds);
    const overflowSeconds = readFiniteNumber(params.overflowSeconds);
    if (!clipId || clipStartSeconds === null || durationSeconds === null || clipEndSeconds === null || canvasDurationSeconds === null || overflowSeconds === null) {
      return [];
    }

    return [{ canvasDurationSeconds, clipEndSeconds, clipId, clipStartSeconds, durationSeconds, overflowSeconds }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  return {
    data: {
      format: snapshot.format,
      fps: snapshot.fps,
      quality: snapshot.quality,
      resolution: snapshot.resolution,
    },
    success: true,
  };
}
