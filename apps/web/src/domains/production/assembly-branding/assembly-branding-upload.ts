import { z } from "zod";

export const MAX_ASSEMBLY_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const ABANDONED_ASSEMBLY_UPLOAD_RETENTION_MS = 48 * 60 * 60 * 1000;

export const assemblyBrandingKindSchema = z.enum(["INTRO", "OUTRO"]);

export const assemblyBrandingSelectionSchema = z.object({
  assetId: z.string().uuid().nullable(),
  kind: assemblyBrandingKindSchema,
}).strict();

export const assemblyBrandingFinalizeSchema = z.object({
  fileSizeBytes: z.number().int().positive().max(MAX_ASSEMBLY_VIDEO_BYTES),
  kind: assemblyBrandingKindSchema,
  mimeType: z.enum(["video/mp4", "video/webm"]),
  name: z.string().trim().min(1).max(255),
  path: z.string().trim().min(1).max(500),
}).strict();

const ASSEMBLY_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

export type AssemblyVideoValidationResult =
  | { success: true }
  | { reason: "empty" | "too_large" | "unsupported_type"; success: false };

export function validateAssemblyVideoFile(file: {
  size: number;
  type: string;
}): AssemblyVideoValidationResult {
  if (!ASSEMBLY_VIDEO_MIME_TYPES.has(file.type)) {
    return { reason: "unsupported_type", success: false };
  }
  if (file.size <= 0) return { reason: "empty", success: false };
  if (file.size > MAX_ASSEMBLY_VIDEO_BYTES) {
    return { reason: "too_large", success: false };
  }
  return { success: true };
}

export function isAbandonedAssemblyUpload(input: {
  createdAt: string | null | undefined;
  isRegistered: boolean;
  nowMs: number;
}): boolean {
  if (input.isRegistered || !Number.isFinite(input.nowMs) || !input.createdAt) {
    return false;
  }
  const createdAtMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  return createdAtMs <= input.nowMs - ABANDONED_ASSEMBLY_UPLOAD_RETENTION_MS;
}

export function resolveAssemblyCleanupPage(input: {
  nowMs: number;
  pageSize: number;
  totalOrganizations: number;
}): { from: number; to: number } | null {
  if (
    !Number.isFinite(input.nowMs)
    || !Number.isInteger(input.pageSize)
    || input.pageSize <= 0
    || !Number.isInteger(input.totalOrganizations)
    || input.totalOrganizations <= 0
  ) {
    return null;
  }
  const pageCount = Math.ceil(input.totalOrganizations / input.pageSize);
  const hourIndex = Math.floor(input.nowMs / (60 * 60 * 1000));
  const pageIndex = ((hourIndex % pageCount) + pageCount) % pageCount;
  const from = pageIndex * input.pageSize;
  return {
    from,
    to: Math.min(from + input.pageSize, input.totalOrganizations) - 1,
  };
}

export function parseAssemblyBrandingStoragePath(
  path: string,
  organizationId: string,
  kind: z.infer<typeof assemblyBrandingKindSchema>,
) {
  const segments = path.split("/");
  if (
    segments.length !== 4
    || segments[0] !== "assembly-branding"
    || segments[1] !== organizationId
    || segments[2] !== kind.toLowerCase()
  ) {
    return null;
  }
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(mp4|webm)$/i.exec(
    segments[3] || "",
  );
  if (!match) return null;
  return {
    extension: match[2]!.toLowerCase() as "mp4" | "webm",
    id: match[1]!,
  };
}
