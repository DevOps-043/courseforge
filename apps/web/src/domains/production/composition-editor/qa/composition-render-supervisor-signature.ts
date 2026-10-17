import {KeyObject, sign, verify, createHash} from "node:crypto";
import {z} from "zod";
import {RENDER_SUPERVISOR_RECEIPT_POLICY, RENDER_SUPERVISOR_RECEIPT_LIMITS,
  renderSupervisorPayloadSchema, renderSupervisorReceiptSchema, renderSupervisorBindingSchema,
  type RenderSupervisorPayload} from "../composition-render-supervisor-receipt";

const signingDomain = `${RENDER_SUPERVISOR_RECEIPT_POLICY}\n`;
const signingBytes = (payload: RenderSupervisorPayload) => Buffer.from(signingDomain + JSON.stringify(payload), "utf8");
const keyIdentitySchema = z.object({
  supervisorId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  keyId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  organizationIds: z.array(z.string().uuid().transform(value => value.toLowerCase())).min(1).max(256),
  notBeforeMilliseconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  notAfterMilliseconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  revoked: z.boolean(),
}).strict();
export type TrustedRenderSupervisorKey = z.input<typeof keyIdentitySchema> & {publicKey: KeyObject};

/** Supervisor-only primitive: never pass this key to the child renderer or load it from a receipt. */
export function signRenderSupervisorReceipt(payloadInput: unknown, privateKey: KeyObject) {
  const parsed = renderSupervisorPayloadSchema.safeParse(payloadInput);
  if (!parsed.success) throw new Error("RENDER_SUPERVISOR_RECEIPT_INVALID");
  if (!(privateKey instanceof KeyObject) || privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("RENDER_SUPERVISOR_SIGNING_KEY_INVALID");
  const payload = parsed.data;
  return {payload, signature: sign(null, signingBytes(payload), privateKey).toString("base64url")};
}

/** Authenticates the issuer's statement. Does not attest that the statement describes isolated execution. */
export function verifyRenderSupervisorReceipt(input: {
  receipt: unknown; expectedBinding: unknown; trustedKeys: readonly TrustedRenderSupervisorKey[];
  nowMilliseconds: number;
}) {
  const receipt = renderSupervisorReceiptSchema.safeParse(input.receipt);
  const expected = renderSupervisorBindingSchema.safeParse(input.expectedBinding);
  if (!receipt.success || !expected.success || !Number.isSafeInteger(input.nowMilliseconds) || input.nowMilliseconds < 0)
    throw new Error("RENDER_SUPERVISOR_RECEIPT_INVALID");
  if (!Array.isArray(input.trustedKeys) || input.trustedKeys.length < 1
    || input.trustedKeys.length > RENDER_SUPERVISOR_RECEIPT_LIMITS.maximumTrustedKeys)
    throw new Error("RENDER_SUPERVISOR_TRUST_INVALID");
  const keys = input.trustedKeys.map(entry => {
    if (!entry || typeof entry !== "object") throw new Error("RENDER_SUPERVISOR_TRUST_INVALID");
    const {publicKey, ...identity} = entry;
    const parsed = keyIdentitySchema.safeParse(identity);
    if (!parsed.success || !(publicKey instanceof KeyObject) || publicKey.type !== "public"
      || publicKey.asymmetricKeyType !== "ed25519" || parsed.data.notAfterMilliseconds <= parsed.data.notBeforeMilliseconds
      || new Set(parsed.data.organizationIds).size !== parsed.data.organizationIds.length)
      throw new Error("RENDER_SUPERVISOR_TRUST_INVALID");
    return {...parsed.data, publicKey};
  });
  if (new Set(keys.map(key => `${key.supervisorId}:${key.keyId}`)).size !== keys.length)
    throw new Error("RENDER_SUPERVISOR_TRUST_INVALID");
  const {payload, signature} = receipt.data;
  const key = keys.find(entry => entry.supervisorId === payload.supervisorId && entry.keyId === payload.keyId);
  if (!key || key.revoked || !key.organizationIds.includes(expected.data.organizationId))
    throw new Error("RENDER_SUPERVISOR_ISSUER_UNAUTHORIZED");
  if (JSON.stringify(payload.binding) !== JSON.stringify(expected.data))
    throw new Error("RENDER_SUPERVISOR_BINDING_MISMATCH");
  const now = input.nowMilliseconds;
  if (payload.issuedAtMilliseconds > now + RENDER_SUPERVISOR_RECEIPT_LIMITS.maximumClockSkewMilliseconds
    || payload.expiresAtMilliseconds <= now || payload.issuedAtMilliseconds < key.notBeforeMilliseconds
    || payload.expiresAtMilliseconds > key.notAfterMilliseconds
    || now < key.notBeforeMilliseconds || now >= key.notAfterMilliseconds)
    throw new Error("RENDER_SUPERVISOR_RECEIPT_EXPIRED_INVALID");
  const bytes = Buffer.from(signature, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== signature
    || !verify(null, signingBytes(payload), key.publicKey, bytes))
    throw new Error("RENDER_SUPERVISOR_SIGNATURE_INVALID");
  return {policy: RENDER_SUPERVISOR_RECEIPT_POLICY,
    scope: payload.scope, status: "ISSUER_VERIFIED" as const, supervisorId: payload.supervisorId, keyId: payload.keyId,
    issuedAtMilliseconds: payload.issuedAtMilliseconds, expiresAtMilliseconds: payload.expiresAtMilliseconds,
    binding: payload.binding,
    receiptSha256: createHash("sha256").update(JSON.stringify(receipt.data), "utf8").digest("hex")};
}
