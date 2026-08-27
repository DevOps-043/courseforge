export interface DetachedVideoAudio {
  durationSeconds: number;
  file: File;
}

const MAX_DETACHED_AUDIO_BYTES = 450 * 1024 * 1024;

/**
 * Analyzes the media container and converts only the clip's active audio window
 * to PCM WAV. The source video is never rewritten or uploaded again.
 */
export async function detachVideoAudio(params: {
  durationSeconds: number;
  fileName: string;
  onProgress?: (progress: number) => void;
  sourceOffsetSeconds: number;
  sourceUrl: string;
}): Promise<DetachedVideoAudio> {
  const response = await fetch(params.sourceUrl, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("No se pudo descargar el video para analizar sus pistas.");
  const sourceBlob = await response.blob();
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Output,
    WavOutputFormat,
  } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(sourceBlob) });

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error("El video seleccionado no contiene una pista de audio separable.");
    if (!(await audioTrack.canDecode())) {
      throw new Error("El navegador no puede decodificar el códec de audio de este video.");
    }
    const [metadataDuration, sourceChannels, sourceSampleRate] = await Promise.all([
      input.getDurationFromMetadata([audioTrack]),
      audioTrack.getNumberOfChannels(),
      audioTrack.getSampleRate(),
    ]);
    const sourceDuration = metadataDuration ?? await input.computeDuration([audioTrack]);
    const trimStart = Math.max(0, params.sourceOffsetSeconds);
    const requestedEnd = trimStart + params.durationSeconds;
    const trimEnd = Number.isFinite(sourceDuration) && sourceDuration > 0
      ? Math.min(sourceDuration, requestedEnd)
      : requestedEnd;
    if (trimEnd - trimStart < 0.05) throw new Error("El tramo seleccionado no contiene audio suficiente.");
    const numberOfChannels = Math.min(2, Math.max(1, sourceChannels || 2));
    const sampleRate = Math.min(48_000, Math.max(8_000, sourceSampleRate || 48_000));
    const estimatedOutputBytes = (trimEnd - trimStart) * numberOfChannels * sampleRate * 2;
    if (estimatedOutputBytes > MAX_DETACHED_AUDIO_BYTES) {
      throw new Error("El tramo de audio es demasiado largo para separarlo en el navegador. Recorta el clip y vuelve a intentarlo.");
    }

    const target = new BufferTarget();
    const output = new Output({ format: new WavOutputFormat(), target });
    const conversion = await Conversion.init({
      audio: { codec: "pcm-s16", numberOfChannels, sampleFormat: "s16", sampleRate },
      input,
      output,
      showWarnings: false,
      tracks: "primary",
      trim: { end: trimEnd, start: trimStart },
      video: { discard: true },
    });
    if (!conversion.isValid) {
      throw new Error("La pista de audio no se puede convertir a un formato editable.");
    }
    conversion.onProgress = (progress) => params.onProgress?.(Math.min(1, Math.max(0, progress)));
    await conversion.execute();
    if (!target.buffer || target.buffer.byteLength === 0) {
      throw new Error("El análisis terminó sin producir una pista de audio.");
    }
    const safeBaseName = params.fileName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "video";
    const durationSeconds = Math.round((trimEnd - trimStart) * 1_000) / 1_000;
    return {
      durationSeconds,
      file: new File([target.buffer], `${safeBaseName}-audio.wav`, { type: "audio/wav" }),
    };
  } finally {
    input.dispose();
  }
}
