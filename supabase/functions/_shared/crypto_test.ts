import {
  decryptAes256Gcm,
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqualHex,
} from "./crypto.ts";

const encoder = new TextEncoder();

Deno.test("decryptAes256Gcm reads the Node iv:tag:ciphertext envelope", async () => {
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 32);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { iv, name: "AES-GCM", tagLength: 128 },
    key,
    encoder.encode("webhook-secret"),
  ));
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  const envelope = `${toHex(iv)}:${toHex(tag)}:${toHex(ciphertext)}`;

  assertEquals(await decryptAes256Gcm(envelope, toHex(keyBytes)), "webhook-secret");
});

Deno.test("hash helpers produce standard SHA-256 values and constant-time comparison semantics", async () => {
  const digest = await sha256Hex(encoder.encode("abc"));
  assertEquals(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const hmac = await hmacSha256Hex("key", encoder.encode("The quick brown fox jumps over the lazy dog"));
  assertEquals(hmac, "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  assert(timingSafeEqualHex(hmac.toUpperCase(), hmac));
  assert(!timingSafeEqualHex(`${hmac.slice(0, -1)}0`, hmac));
  assert(!timingSafeEqualHex("not-a-signature", hmac));
});

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error("Assertion failed");
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
