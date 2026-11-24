import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import sharp from "sharp";

export class StandaloneMediaValidationError extends Error {}

export async function inspectStandaloneMedia(bytes: Uint8Array, mimeType: string) {
  if (mimeType.startsWith("image/")) {
    const image = await sharp(bytes, { limitInputPixels: 1920 * 1920 }).metadata();
    if (`image/${image.format}` !== mimeType || !image.width || !image.height) {
      throw new StandaloneMediaValidationError("El contenido no corresponde al formato de imagen.");
    }
    return { width: image.width, height: image.height, duration: null, hasAudio: false };
  }
  const media = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) });
  try {
    const detectedMime = (await media.getFormat())?.mimeType;
    if (detectedMime !== mimeType && !(mimeType === "audio/wav" && detectedMime === "audio/x-wav")) {
      throw new StandaloneMediaValidationError("El contenido no corresponde al formato indicado.");
    }
    const video = await media.getPrimaryVideoTrack();
    const audio = await media.getPrimaryAudioTrack();
    if (mimeType.startsWith("video/") ? !video : !audio || Boolean(video)) {
      throw new StandaloneMediaValidationError("El archivo no contiene las pistas esperadas.");
    }
    const duration = await media.getDurationFromMetadata() ?? await media.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new StandaloneMediaValidationError("Duración inválida.");
    return { duration, hasAudio: Boolean(audio), width: video ? await video.getDisplayWidth() : undefined,
      height: video ? await video.getDisplayHeight() : undefined };
  } finally { media.dispose(); }
}
