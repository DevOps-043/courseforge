import crypto from "node:crypto";
import { getBackgroundFunctionSecret } from "./env";

export interface SignedBackgroundPayload extends Record<string, unknown> {
  payload: string;
  signature: string;
}

export interface BackgroundPayloadEnvelope {
  issuedAt: number;
  nonce: string;
  value: Record<string, unknown>;
  version: 1;
}

const BACKGROUND_PAYLOAD_MAX_AGE_MS = 5 * 60 * 1000;
const BACKGROUND_PAYLOAD_CLOCK_SKEW_MS = 30 * 1000;

export function signBackgroundPayload(
  value: Record<string, unknown>,
): SignedBackgroundPayload {
  const envelope: BackgroundPayloadEnvelope = {
    issuedAt: Date.now(),
    nonce: crypto.randomUUID(),
    value,
    version: 1,
  };
  const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  return {
    payload,
    signature: createSignature(payload),
  };
}

export function verifyBackgroundPayload<TValue>(
  envelope: SignedBackgroundPayload,
): TValue {
  return verifyBackgroundPayloadEnvelope<TValue>(envelope).value;
}

export function verifyBackgroundPayloadEnvelope<TValue>(
  envelope: SignedBackgroundPayload,
): BackgroundPayloadEnvelope & { value: TValue } {
  const expected = Buffer.from(createSignature(envelope.payload), "hex");
  const received = Buffer.from(envelope.signature || "", "hex");
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    throw new Error("Firma de background inválida.");
  }

  const decoded = JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8"),
  ) as Partial<BackgroundPayloadEnvelope>;
  if (
    decoded.version !== 1 ||
    typeof decoded.issuedAt !== "number" ||
    typeof decoded.nonce !== "string" ||
    decoded.nonce.length < 1 ||
    typeof decoded.value !== "object" ||
    decoded.value === null
  ) {
    throw new Error("Envelope de background inválido.");
  }

  const ageMs = Date.now() - decoded.issuedAt;
  if (
    ageMs > BACKGROUND_PAYLOAD_MAX_AGE_MS ||
    ageMs < -BACKGROUND_PAYLOAD_CLOCK_SKEW_MS
  ) {
    throw new Error("Firma de background expirada.");
  }

  return decoded as BackgroundPayloadEnvelope & { value: TValue };
}

function createSignature(payload: string) {
  return crypto
    .createHmac("sha256", getBackgroundFunctionSecret())
    .update(payload)
    .digest("hex");
}
