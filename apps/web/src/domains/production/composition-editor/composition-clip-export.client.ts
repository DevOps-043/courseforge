import { COMPOSITION_CLIP_EXPORT_POLICY, type CompositionClipExportPlan } from "./composition-clip-export-plan";
import { readClipExportSource } from "./composition-clip-export-io.client";

/** Temporal source export; composition effects belong to the assembly renderer. */
export async function exportCompositionClip(params: {
  plan: CompositionClipExportPlan; sourceUrl: string; signal: AbortSignal; onProgress: (progress: number) => void;
}): Promise<File> {
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(COMPOSITION_CLIP_EXPORT_POLICY.timeoutMs)]);
  const response = await fetch(params.sourceUrl, { signal, cache: "no-store", credentials: "same-origin" });
  const source = await readClipExportSource(response, signal);
  const { Input, BlobSource, ALL_FORMATS, Conversion, Output, StreamTarget, Mp4OutputFormat, WavOutputFormat } = await import("mediabunny");
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  const cancel = () => { void conversion?.cancel().catch(() => undefined); input.dispose(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    if (params.plan.kind === "VIDEO" ? !video : !audio) throw new Error("El archivo no contiene la pista seleccionada.");
    const tracks = params.plan.kind === "VIDEO" ? [video, audio].filter(track => track !== null) : [audio!];
    const sourceDuration = await input.computeDuration(tracks);
    if (params.plan.end > sourceDuration + 0.001) throw new Error("El recorte excede la duración real del medio.");
    const writes: Array<{ position: number; bytes: Uint8Array<ArrayBuffer> }> = [];
    let writtenBytes = 0;
    let outputSize = 0;
    const target = new StreamTarget(new WritableStream({ write(chunk) {
      signal.throwIfAborted();
      writtenBytes += chunk.data.byteLength;
      outputSize = Math.max(outputSize, chunk.position + chunk.data.byteLength);
      if (Math.max(writtenBytes, outputSize) > COMPOSITION_CLIP_EXPORT_POLICY.maximumBytes) {
        throw new Error("El archivo exportado supera el límite de 256 MiB. Reduce la duración del clip.");
      }
      writes.push({ position: chunk.position, bytes: chunk.data.slice() });
    } }), { chunked: true, chunkSize: 1024 * 1024 });
    const output = new Output({ target, format: params.plan.kind === "VIDEO"
      ? new Mp4OutputFormat({ fastStart: "fragmented" }) : new WavOutputFormat() });
    conversion = await Conversion.init({ input, output, tracks: "primary", tags: {}, showWarnings: false,
      trim: { start: params.plan.start, end: params.plan.end },
      video: params.plan.kind === "VIDEO" ? { codec: "avc", bitrate: COMPOSITION_CLIP_EXPORT_POLICY.videoBitrate, forceTranscode: true } : { discard: true },
      audio: params.plan.kind === "VIDEO" ? { codec: "aac", bitrate: COMPOSITION_CLIP_EXPORT_POLICY.audioBitrate, forceTranscode: true }
        : { codec: "pcm-s16", sampleFormat: "s16", sampleRate: 48_000, numberOfChannels: 2, forceTranscode: true },
    });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== "discarded_by_user")) {
      throw new Error("Este navegador no puede codificar todas las pistas del clip. Prueba con un navegador compatible con WebCodecs.");
    }
    conversion.onProgress = progress => params.onProgress(Math.max(0, Math.min(1, progress)));
    await conversion.execute();
    signal.throwIfAborted();
    if (!outputSize) throw new Error("La exportación no produjo un archivo.");
    const bytes = new Uint8Array(outputSize);
    for (const write of writes) bytes.set(write.bytes, write.position);
    return new File([bytes], params.plan.fileName, { type: params.plan.mimeType });
  } finally {
    signal.removeEventListener("abort", cancel);
    await conversion?.cancel().catch(() => undefined);
    input.dispose();
  }
}
