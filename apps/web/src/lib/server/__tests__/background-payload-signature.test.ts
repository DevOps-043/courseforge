import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.BACKGROUND_FUNCTION_SECRET = "test-background-signature-secret-long-enough";

test("round-trips a signed background payload and rejects tampering", async () => {
  const { signBackgroundPayload, verifyBackgroundPayload } = await import(
    "../background-payload-signature"
  );
  const signed = signBackgroundPayload({ artifactId: "artifact-1" });
  assert.deepEqual(
    verifyBackgroundPayload<{ artifactId: string }>(signed),
    { artifactId: "artifact-1" },
  );

  assert.throws(
    () => verifyBackgroundPayload({
      ...signed,
      signature: `${signed.signature[0] === "0" ? "1" : "0"}${signed.signature.slice(1)}`,
    }),
    /Firma de background inválida/,
  );
});

test("rejects expired signed payloads", async () => {
  const { verifyBackgroundPayload } = await import(
    "../background-payload-signature"
  );
  const payload = Buffer.from(JSON.stringify({
    issuedAt: Date.now() - (6 * 60 * 1000),
    nonce: crypto.randomUUID(),
    value: { artifactId: "artifact-1" },
    version: 1,
  }), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.BACKGROUND_FUNCTION_SECRET!)
    .update(payload)
    .digest("hex");

  assert.throws(
    () => verifyBackgroundPayload({ payload, signature }),
    /Firma de background expirada/,
  );
});
