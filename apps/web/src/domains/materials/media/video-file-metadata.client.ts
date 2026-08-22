import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

export interface LocalVideoFileMetadata {
  duration: number;
  hasAudio: boolean;
  height: number;
  width: number;
}

/**
 * Reads the container tracks before upload. HTMLMediaElement exposes video
 * dimensions and duration, but it does not provide a portable audio-track
 * contract. HyperFrames needs that distinction because a synthetic <audio>
 * element pointing to a silent MP4 can fail the provider workflow.
 */
export async function inspectLocalVideoFile(file: File): Promise<LocalVideoFileMetadata> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });

  try {
    const [audioTrack, videoTrack] = await Promise.all([
      input.getPrimaryAudioTrack(),
      input.getPrimaryVideoTrack(),
    ]);
    if (!videoTrack) {
      throw new Error(`“${file.name}” no contiene una pista de video válida.`);
    }

    const [durationFromMetadata, height, width] = await Promise.all([
      input.getDurationFromMetadata(),
      videoTrack.getDisplayHeight(),
      videoTrack.getDisplayWidth(),
    ]);
    const duration = durationFromMetadata ?? await input.computeDuration([videoTrack]);

    return {
      duration: Number.isFinite(duration) && duration > 0
        ? Math.round(duration * 1_000) / 1_000
        : 0,
      hasAudio: audioTrack !== null,
      height: Number.isFinite(height) ? height : 0,
      width: Number.isFinite(width) ? width : 0,
    };
  } finally {
    input.dispose();
  }
}
