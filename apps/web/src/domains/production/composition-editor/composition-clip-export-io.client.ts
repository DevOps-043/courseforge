import { COMPOSITION_CLIP_EXPORT_POLICY } from "./composition-clip-export-plan";

/** Bounds even chunked responses whose Content-Length is absent or incorrect. */
export async function readClipExportSource(response: Response, signal: AbortSignal): Promise<Blob> {
  if (!response.ok) throw new Error("No se pudo descargar el medio. Renueva el preview y vuelve a intentarlo.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("El medio no contiene datos descargables.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    if (Number(response.headers.get("content-length")) > COMPOSITION_CLIP_EXPORT_POLICY.maximumBytes) {
      throw new Error("El archivo fuente supera el límite de 256 MiB para descarga local.");
    }
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > COMPOSITION_CLIP_EXPORT_POLICY.maximumBytes) throw new Error("El archivo fuente supera el límite de 256 MiB para descarga local.");
      chunks.push(new Uint8Array(chunk.value));
    }
    if (!bytes) throw new Error("El archivo fuente está vacío.");
    return new Blob(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
