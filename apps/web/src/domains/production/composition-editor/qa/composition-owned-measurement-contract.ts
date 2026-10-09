import {isAbsolute, resolve} from "node:path";
import {z} from "zod";

export const OWNED_MEASUREMENT_POLICY = Object.freeze({
  id: "WINDOWS_OWNED_MEASUREMENT_SPOOL_V1",
  maximumRequestBytes: 64 * 1024,
  maximumReceiptBytes: 4096,
  maximumTextBytes: 64 * 1024 * 1024,
  maximumPcmBytes: 512 * 1024 * 1024,
  maximumStderrBytes: 1024 * 1024,
  maximumTimeoutMilliseconds: 600_000,
  requestFile: "measurement-request.json",
  receiptFile: "measurement-result.json",
  stdoutFile: "measurement-stdout.bin",
  stderrFile: "measurement-stderr.bin",
} as const);
const absolutePath = z.string().min(1).max(4096).refine(path => isAbsolute(path)
  && resolve(path) === path && !path.includes("\0"));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const fileDigest = z.object({sha256, sizeBytes: z.number().int().nonnegative()
  .max(OWNED_MEASUREMENT_POLICY.maximumPcmBytes)}).strict();

/** Host code only. Neither documents nor job payloads may choose binary paths or argv. */
export const ownedMeasurementRequestSchema = z.object({
  policy: z.literal(OWNED_MEASUREMENT_POLICY.id), executionId: z.string().uuid(), operationId: z.string().uuid(),
  binary: absolutePath, binarySha256: sha256,
  arguments: z.array(z.string().max(8192).refine(argument => !argument.includes("\0"))).max(64),
  mode: z.enum(["UTF8", "PCM"]),
  maximumStdoutBytes: z.number().int().positive().max(OWNED_MEASUREMENT_POLICY.maximumPcmBytes),
  maximumStderrBytes: z.number().int().positive().max(OWNED_MEASUREMENT_POLICY.maximumTextBytes),
  timeoutMilliseconds: z.number().int().min(1000).max(OWNED_MEASUREMENT_POLICY.maximumTimeoutMilliseconds),
}).strict().superRefine((request, context) => {
  if (request.mode === "UTF8" && request.maximumStdoutBytes > OWNED_MEASUREMENT_POLICY.maximumTextBytes
    || request.mode === "PCM" && request.maximumStderrBytes > OWNED_MEASUREMENT_POLICY.maximumStderrBytes)
    context.addIssue({code: "custom", message: "MEASUREMENT_BYTE_LIMIT_INVALID"});
});
export const ownedMeasurementReferenceSchema = z.object({path: absolutePath, sha256,
  sizeBytes: z.number().int().positive().max(OWNED_MEASUREMENT_POLICY.maximumRequestBytes)}).strict();
export const ownedMeasurementReceiptSchema = z.object({policy: z.literal(OWNED_MEASUREMENT_POLICY.id),
  executionId: z.string().uuid(), operationId: z.string().uuid(), requestSha256: sha256,
  scope: z.literal("LOCAL_PROCESS_OUTPUT_NOT_CONFORMANCE_OR_ATTESTATION"),
  stdout: fileDigest, stderr: fileDigest,
}).strict();
export type OwnedMeasurementRequest = z.infer<typeof ownedMeasurementRequestSchema>;
export type OwnedMeasurementReference = z.infer<typeof ownedMeasurementReferenceSchema>;

export function encodeOwnedMeasurementReference(value: OwnedMeasurementReference) {
  return Buffer.from(JSON.stringify(ownedMeasurementReferenceSchema.parse(value))).toString("base64url");
}
export function decodeOwnedMeasurementReference(encoded: string) {
  if (typeof encoded !== "string" || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_REFERENCE_INVALID");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) throw new Error("CONTROLLED_RENDER_MEASUREMENT_REFERENCE_INVALID");
  return ownedMeasurementReferenceSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
}
