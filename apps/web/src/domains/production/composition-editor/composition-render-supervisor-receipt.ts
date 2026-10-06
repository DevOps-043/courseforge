import {z} from "zod";

export const RENDER_SUPERVISOR_RECEIPT_POLICY = "SUPERVISOR_SIGNED_RENDER_OUTPUT_V1";
export const RENDER_SUPERVISOR_RECEIPT_LIMITS = Object.freeze({
  maximumLifetimeMilliseconds: 600_000, maximumClockSkewMilliseconds: 30_000, maximumTrustedKeys: 32,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const identifier = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Expected identity is supplied by trusted queue/revision/integrity authorities, NOT the receipt. */
export const renderSupervisorBindingSchema = z.object({
  organizationId: uuid, requestId: uuid, revisionId: uuid, productionJobId: uuid,
  executionId: uuid, attempt: z.number().int().min(1).max(5), challengeSha256: hash,
  artifactKind: z.enum(["SINGLE_CONTRACT", "EVENT_BATCH_SET"]),
  documentHash: hash, projectHash: hash, contractSha256: hash, observationSha256: hash,
  comparisonReceiptSha256: hash,
  videoSha256: hash, sizeBytes: z.number().int().positive().max(2 * 1024 ** 3),
}).strict();
export type RenderSupervisorBinding = z.output<typeof renderSupervisorBindingSchema>;

export const renderSupervisorPayloadSchema = z.object({
  policy: z.literal(RENDER_SUPERVISOR_RECEIPT_POLICY),
  scope: z.literal("SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE"),
  supervisorId: identifier, keyId: identifier, issuedAtMilliseconds: timestamp, expiresAtMilliseconds: timestamp,
  binding: renderSupervisorBindingSchema,
}).strict().superRefine((payload, context) => {
  const lifetime = payload.expiresAtMilliseconds - payload.issuedAtMilliseconds;
  if (lifetime <= 0 || lifetime > RENDER_SUPERVISOR_RECEIPT_LIMITS.maximumLifetimeMilliseconds)
    context.addIssue({code: "custom", message: "RENDER_SUPERVISOR_RECEIPT_LIFETIME_INVALID"});
});
export type RenderSupervisorPayload = z.output<typeof renderSupervisorPayloadSchema>;

export const renderSupervisorReceiptSchema = z.object({
  payload: renderSupervisorPayloadSchema,
  // Exactly 64 Ed25519 signature bytes in unpadded base64url. Decoder also checks canonical spelling.
  signature: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
