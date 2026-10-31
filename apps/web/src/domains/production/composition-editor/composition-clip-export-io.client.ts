import { COMPOSITION_CLIP_EXPORT_POLICY } from "./composition-clip-export-plan";
import type { CompositionClip } from "./composition-document.types";

/** Lee el medio vigente después del guardado; una cola vacía también puede contener un fallo. */
export async function prepareClipExportSource(params: {
  flush: () => Promise<boolean>;
  waitForIdle: () => Promise<void>;
  readCurrentSource: () => { clip: CompositionClip | null; sourceUrl: string | null; hasPendingChanges: boolean };
}): Promise<{ clip: CompositionClip; sourceUrl: string }> {
  if (!await params.flush()) throw new Error("Guarda los cambios pendientes antes de descargar.");
  await params.waitForIdle();
  const source = params.readCurrentSource();
  if (source.hasPendingChanges) throw new Error("Resuelve los cambios pendientes o la recuperación antes de descargar.");
  if (!source.clip || !source.sourceUrl) throw new Error("El medio seleccionado no está disponible. Renueva el preview.");
  return { clip: structuredClone(source.clip), sourceUrl: source.sourceUrl };
}

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
