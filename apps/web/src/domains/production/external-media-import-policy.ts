import { assertPublicHttpsUrl } from "../../lib/server/public-url-policy";

export async function assertSafeExternalMediaUrl(rawUrl: string) {
  return assertPublicHttpsUrl(rawUrl);
}

export async function readResponseWithLimit(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("EXTERNAL_MEDIA_TOO_LARGE");
  }
  if (!response.body) throw new Error("El origen externo no devolvió contenido.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("EXTERNAL_MEDIA_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}
