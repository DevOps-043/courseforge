import { z } from "zod";

/** Isomorphic policy: no filesystem, codec process, or worker dependency. */

export const EXPORTED_COLOR_TAG_POLICY = "sdr-rec709-tags-v1" as const;
export type ExportedColorTagPolicyId = typeof EXPORTED_COLOR_TAG_POLICY;
const tagSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).nullable();
export const exportedColorTagsSchema = z.object({
  matrix: tagSchema,
  primaries: tagSchema,
  transfer: tagSchema,
  range: tagSchema,
}).strict();
export type ExportedColorTags = z.infer<typeof exportedColorTagsSchema>;
const colorTagReportShape = z.object({
  method: z.literal("FFPROBE_VIDEO_STREAM_COLOR_TAGS_V1"),
  scope: z.literal("ENCODED_STREAM_TAGS_NOT_PIXEL_CONVERSION_OR_DISPLAY_PROFILE"),
  policy: z.literal(EXPORTED_COLOR_TAG_POLICY).nullable(),
  tags: exportedColorTagsSchema,
  status: z.enum(["MEASURED_POLICY_NOT_SET", "TAGS_MATCH", "INCOMPLETE", "FAIL"]),
  missing: z.array(z.enum(["matrix", "primaries", "transfer", "range"])).max(4),
  mismatched: z.array(z.enum(["matrix", "primaries", "transfer", "range"])).max(4),
}).strict();
export type ExportedColorTagReport = z.infer<typeof colorTagReportShape>;

export function resolveExportedColorTagPolicyId(value: string | undefined): ExportedColorTagPolicyId | undefined {
  if (value !== undefined && value !== EXPORTED_COLOR_TAG_POLICY) throw new Error("EXPORTED_COLOR_TAG_POLICY_INVALID");
  return value;
}

/** These are encoded stream declarations, not proof of a correctly converted image. */
export function readExportedColorTags(stream: Record<string, unknown>): ExportedColorTags {
  const parsed = exportedColorTagsSchema.safeParse({matrix: stream.color_space ?? null,
    primaries: stream.color_primaries ?? null, transfer: stream.color_transfer ?? null, range: stream.color_range ?? null});
  if (!parsed.success) throw new Error("EXPORTED_COLOR_TAG_MEASUREMENT_INVALID");
  return parsed.data;
}

export function evaluateExportedColorTags(tags: ExportedColorTags, policy?: ExportedColorTagPolicyId): ExportedColorTagReport {
  resolveExportedColorTagPolicyId(policy);
  const checkedTags = exportedColorTagsSchema.parse(tags);
  const missing: ExportedColorTagReport["missing"] = [];
  const mismatched: ExportedColorTagReport["mismatched"] = [];
  if (policy) for (const key of ["matrix", "primaries", "transfer", "range"] as const) {
    const value = checkedTags[key];
    if (value === null || value === "unknown" || value === "unspecified" || value === "reserved") missing.push(key);
    else if (key === "range" ? value !== "tv" && value !== "pc" : value !== "bt709") mismatched.push(key);
  }
  return {
    method: "FFPROBE_VIDEO_STREAM_COLOR_TAGS_V1",
    scope: "ENCODED_STREAM_TAGS_NOT_PIXEL_CONVERSION_OR_DISPLAY_PROFILE",
    policy: policy ?? null,
    tags: checkedTags,
    status: !policy ? "MEASURED_POLICY_NOT_SET" : mismatched.length ? "FAIL" : missing.length ? "INCOMPLETE" : "TAGS_MATCH",
    missing,
    mismatched,
  };
}

export const exportedColorTagReportSchema = colorTagReportShape.superRefine((report, context) => {
  const expected = evaluateExportedColorTags(report.tags, report.policy ?? undefined);
  if (report.status !== expected.status || JSON.stringify(report.missing) !== JSON.stringify(expected.missing)
    || JSON.stringify(report.mismatched) !== JSON.stringify(expected.mismatched)) {
    context.addIssue({code: "custom", message: "EXPORTED_COLOR_TAG_REPORT_INVALID"});
  }
});
