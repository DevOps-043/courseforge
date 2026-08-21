const encoder = new TextEncoder();

export async function decryptAes256Gcm(value: string, keyHex: string): Promise<string> {
  const [ivHex, tagHex, ciphertextHex, ...extra] = value.split(":");
  if (!ivHex || !tagHex || !ciphertextHex || extra.length > 0 || keyHex.length !== 64) {
    throw new Error("Invalid encrypted secret format.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromHex(keyHex)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  // Node stores the GCM authentication tag separately and appends it after
  // ciphertext for WebCrypto-compatible decryption.
  const ciphertext = concatBytes(fromHex(ciphertextHex), fromHex(tagHex));
  const plaintext = await crypto.subtle.decrypt(
    { iv: toArrayBuffer(fromHex(ivHex)), name: "AES-GCM", tagLength: 128 },
    key,
    toArrayBuffer(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function hmacSha256Hex(secret: string, payload: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(payload))));
}

export async function sha256Hex(payload: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(payload))));
}

export function timingSafeEqualHex(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual) || actual.length !== expected.length) return false;
  const a = fromHex(actual.toLowerCase());
  const b = fromHex(expected.toLowerCase());
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) throw new Error("Invalid hexadecimal value.");
  return Uint8Array.from(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
