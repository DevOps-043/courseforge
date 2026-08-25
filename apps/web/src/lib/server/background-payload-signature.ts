import crypto from "node:crypto";
import { getCourseforgeJwtSecret } from "@/lib/server/env";

export interface SignedBackgroundPayload extends Record<string, unknown> {
  payload: string;
  signature: string;
}

export function signBackgroundPayload(
  value: Record<string, unknown>,
): SignedBackgroundPayload {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return {
    payload,
    signature: createSignature(payload),
  };
}

export function verifyBackgroundPayload<TValue>(
  envelope: SignedBackgroundPayload,
): TValue {
  const expected = Buffer.from(createSignature(envelope.payload), "hex");
  const received = Buffer.from(envelope.signature || "", "hex");
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    throw new Error("Firma de background inválida.");
  }

  return JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8"),
  ) as TValue;
}

function createSignature(payload: string) {
  return crypto
    .createHmac("sha256", getCourseforgeJwtSecret())
    .update(payload)
    .digest("hex");
}
