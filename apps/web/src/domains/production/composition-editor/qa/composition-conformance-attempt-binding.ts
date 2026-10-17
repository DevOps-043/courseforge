import {createHash} from "node:crypto";
import {z} from "zod";

export const CONFORMANCE_ATTEMPT_BINDING_POLICY = "CLAIM_BOUND_REPORT_NOT_RENDER_ATTESTATION_V1";
const claimIdentitySchema = z.object({id: z.string().uuid(), attempts: z.number().int().min(1).max(5),
  lease_token: z.string().uuid()});
export const conformanceAttemptBindingSchema = z.object({
  policy: z.literal(CONFORMANCE_ATTEMPT_BINDING_POLICY), jobId: z.string().uuid().transform(value => value.toLowerCase()),
  attempt: z.number().int().min(1).max(5), leaseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Correlation only, not a signature. Never persist the bearer lease token in a report. */
export function bindConformanceReportToAttempt(claim: z.input<typeof claimIdentitySchema>): z.output<typeof conformanceAttemptBindingSchema> {
  const identity = claimIdentitySchema.parse(claim);
  return {policy: CONFORMANCE_ATTEMPT_BINDING_POLICY, jobId: identity.id.toLowerCase(),
    attempt: identity.attempts, leaseFingerprint: createHash("sha256")
      .update(`${CONFORMANCE_ATTEMPT_BINDING_POLICY}:${identity.lease_token.toLowerCase()}`, "utf8").digest("hex")};
}

export function assertConformanceAttemptBinding(binding: unknown, claim: z.input<typeof claimIdentitySchema>) {
  const observed = conformanceAttemptBindingSchema.safeParse(binding);
  const expected = bindConformanceReportToAttempt(claim);
  if (!observed.success || observed.data.jobId.toLowerCase() !== expected.jobId
    || observed.data.attempt !== expected.attempt || observed.data.leaseFingerprint !== expected.leaseFingerprint)
    throw new Error("CONFORMANCE_JOB_ATTEMPT_BINDING_INVALID");
}
